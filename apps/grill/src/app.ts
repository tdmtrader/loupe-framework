// The grill app: an agent asks, a human answers, both through verbs over two
// loupe-owned jsonl streams in one directory. Stateless — the files are the
// state; kill and restart freely.
import { mkdirSync, watch, type FSWatcher } from 'node:fs';
import { z } from 'zod';
import { defineApp, type LoupeAppServer } from '@loupe/serve';
import type { JsonObject, VerbResult, WrittenRecord } from '@loupe/protocol';
import { appendOwned } from './streams.ts';
import { deriveBoard, foldQuestions } from './derive.ts';
import { ANSWER_CHOICES, zOption, type Answer, type Question, type Retraction, type Withdrawal } from './records.ts';

export const APP_VERSION = '0.1.0';

const err = (code: string, message: string): VerbResult => ({ ok: false, error: { code, message } });
const wrote = (stream: string, record: JsonObject): VerbResult => ({
  ok: true,
  seq: 0,
  records: [{ stream, record } satisfies WrittenRecord],
});

export function createGrillApp(grillDir: string): LoupeAppServer {
  // The directory is created, the files are not: a missing stream is an
  // empty stream (readJsonl) and the first append creates it.
  mkdirSync(grillDir, { recursive: true });
  return defineApp({
    name: 'grill',
    version: APP_VERSION,
    // The agent dispatches `question.ask` over loopback and signs as itself;
    // the screen's client sends no header and every human answer is stamped
    // with the app's configured actor.
    actors: 'header',
    store: { grillDir },
    projections: {
      board: { derive: (s) => deriveBoard(s.grillDir) },
    },
    verbs: {
      'question.ask': {
        description: 'ask the human a question (appends questions.jsonl) — with a recommendation and optional options to pick from',
        params: z.strictObject({
          id: z.string().min(1),
          round: z.number().int(),
          title: z.string().min(1),
          body: z.string(),
          recommendation: z.string(),
          options: z.array(zOption).optional(),
        }),
        records: [{ stream: 'questions.jsonl' }],
        execute: (p, ctx, s) => {
          if (foldQuestions(s.grillDir).has(p.id)) {
            return err('duplicate_question', `a question with id ${p.id} was already asked — ids are asked once, withdrawn or not`);
          }
          const ids = new Set<string>();
          for (const o of p.options ?? []) {
            if (ids.has(o.id)) return err('duplicate_option', `option id ${o.id} appears twice on ${p.id}`);
            ids.add(o.id);
          }
          const record = {
            id: p.id,
            round: p.round,
            title: p.title,
            body: p.body,
            recommendation: p.recommendation,
            options: p.options ?? [],
            actor: ctx.actor,
            at: ctx.at,
          } satisfies Question;
          appendOwned(s.grillDir, 'questions.jsonl', record);
          return wrote('questions.jsonl', record);
        },
      },
      'question.withdraw': {
        description: 'withdraw a question (appends a withdrawal line to questions.jsonl) — it leaves the board; its answer, if any, stays in the log',
        params: z.strictObject({ id: z.string().min(1) }),
        records: [{ stream: 'questions.jsonl' }],
        execute: (p, ctx, s) => {
          const row = foldQuestions(s.grillDir).get(p.id);
          if (row === undefined) return err('unknown_question', `no question with id ${p.id}`);
          if (row.withdrawn) return err('question_withdrawn', `${p.id} is already withdrawn`);
          const record = { id: p.id, withdrawn: true, actor: ctx.actor, at: ctx.at } satisfies Withdrawal;
          appendOwned(s.grillDir, 'questions.jsonl', record);
          return wrote('questions.jsonl', record);
        },
      },
      'question.answer': {
        description: 'answer a question (appends answers.jsonl): take the recommendation, pick an option, or give your own — the latest answer stands',
        params: z.strictObject({
          question_id: z.string().min(1),
          choice: z.enum(ANSWER_CHOICES),
          // NULLABLE: the screen binds these straight from the ui doc and a
          // press with no option selected serves null, not absence.
          option_id: z.string().nullable().optional(),
          note: z.string().nullable().optional(),
        }),
        records: [{ stream: 'answers.jsonl' }],
        execute: (p, ctx, s) => {
          const row = foldQuestions(s.grillDir).get(p.question_id);
          if (row === undefined) return err('unknown_question', `no question with id ${p.question_id}`);
          if (row.withdrawn) return err('question_withdrawn', `${p.question_id} was withdrawn — there is nothing to answer`);
          let optionId: string | null = null;
          if (p.choice === 'option') {
            if (p.option_id === null || p.option_id === undefined || p.option_id === '') {
              return err('option_required', `choice "option" names which one — ${p.question_id} offers ${row.question.options.map((o) => o.id).join(', ') || 'no options'}`);
            }
            if (!row.question.options.some((o) => o.id === p.option_id)) {
              return err('unknown_option', `${p.question_id} offers no option ${p.option_id}`);
            }
            optionId = p.option_id;
          }
          const note = (p.note ?? '').trim();
          if (p.choice === 'other' && note === '') {
            return err('note_required', 'answering with your own answer needs the answer — the note is empty');
          }
          const record = {
            question_id: p.question_id,
            choice: p.choice,
            option_id: optionId,
            note,
            actor: ctx.actor,
            at: ctx.at,
          } satisfies Answer;
          appendOwned(s.grillDir, 'answers.jsonl', record);
          return wrote('answers.jsonl', record);
        },
      },
      'question.retract': {
        description: 'retract the standing answer (appends a retraction to answers.jsonl) — undo is itself a record; the question is open again',
        params: z.strictObject({ question_id: z.string().min(1) }),
        records: [{ stream: 'answers.jsonl' }],
        execute: (p, ctx, s) => {
          const row = foldQuestions(s.grillDir).get(p.question_id);
          if (row === undefined) return err('unknown_question', `no question with id ${p.question_id}`);
          if (row.answer === null) return err('nothing_to_retract', `${p.question_id} has no standing answer`);
          const record = { question_id: p.question_id, retracted: true, actor: ctx.actor, at: ctx.at } satisfies Retraction;
          appendOwned(s.grillDir, 'answers.jsonl', record);
          return wrote('answers.jsonl', record);
        },
      },
    },
  });
}

/**
 * Watch the grill dir (debounced) and re-derive + push, so a question the
 * agent wrote from another process repaints the open screen. Returns a stop
 * function.
 */
export function watchGrill(app: LoupeAppServer, grillDir: string, debounceMs = 150): () => void {
  let timer: NodeJS.Timeout | null = null;
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(grillDir, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        app.touch();
      }, debounceMs);
    });
  } catch {
    // A missing dir just means no live repaint; polling clients still work.
  }
  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}

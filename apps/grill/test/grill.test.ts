// Grill app tests over a FIXTURE directory (never the live grill dir): the
// ask -> answer -> retract fold, the OWNED_STREAMS write boundary, the
// board's phrases and order, the header-actor opt-in, and the fs.watch
// repaint.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zAppDescriptor, zProjectionEnvelope, zRecordsEnvelope, zVerbError, zVerbOk } from '@loupe/protocol';
import type { LoupeAppServer } from '@loupe/serve';
import { createGrillApp, watchGrill } from '../src/app.ts';
import { answerPhrase, deriveBoard, foldQuestions, summaryPhrase } from '../src/derive.ts';
import { appendOwned, OWNED_STREAMS } from '../src/streams.ts';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'loupe-grill-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function start(dir: string): Promise<{ app: LoupeAppServer; base: string }> {
  const app = createGrillApp(dir);
  await app.listen(0);
  cleanups.push(() => app.close());
  return { app, base: `http://127.0.0.1:${app.port()}` };
}

async function dispatch(base: string, verb: string, params: unknown, actor?: string): Promise<Response> {
  return fetch(`${base}/loupe/verbs/${encodeURIComponent(verb)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(actor === undefined ? {} : { 'x-loupe-actor': actor }) },
    body: JSON.stringify({ params }),
  });
}

interface BoardQuestion {
  id: string;
  index: string;
  round: number;
  roundLabel: string;
  roundFirst: boolean;
  phase: string;
  answerPhrase: string | null;
  answerNote: string | null;
  answeredBy: string | null;
  bodyBlocks: Array<{ kind: string }>;
  recommendationBlocks: Array<{ kind: string }>;
}
interface Board {
  summary: string;
  rounds: Array<{ n: number; label: string; openCount: number; phrase: string }>;
  questions: BoardQuestion[];
}

async function board(base: string): Promise<Board> {
  const res = await fetch(`${base}/loupe/state/board`);
  return zProjectionEnvelope.parse(await res.json()).state as unknown as Board;
}

const ask = (id: string, round: number, extra: Record<string, unknown> = {}) => ({
  id,
  round,
  title: `title ${id}`,
  body: `# ${id}\n\nA body with \`code\` in it.`,
  recommendation: 'Keep **it**.',
  options: [
    { id: 'a', label: 'drop it' },
    { id: 'b', label: 'rename it' },
  ],
  ...extra,
});

describe('ask -> answer -> retract', () => {
  it('folds the latest answer per question and reads a retraction as no answer', async () => {
    const dir = makeDir();
    const { base } = await start(dir);

    const asked = await dispatch(base, 'question.ask', ask('q1', 1), 'Fable');
    expect(asked.status).toBe(200);
    const okAsked = zVerbOk.parse(await asked.json());
    expect(okAsked.records[0]).toMatchObject({ stream: 'questions.jsonl', record: { id: 'q1', actor: 'Fable' } });

    // Duplicate ids are refused, withdrawn or not.
    const dup = await dispatch(base, 'question.ask', ask('q1', 2));
    expect(dup.status).toBe(400);
    expect(zVerbError.parse(await dup.json()).error.code).toBe('duplicate_question');

    let b = await board(base);
    expect(b.questions[0]).toMatchObject({ id: 'q1', phase: 'open', answerPhrase: null, index: 'Q1', roundLabel: 'round 1' });
    expect(b.summary).toBe('0 of 1 answered · round 1 open');

    const answered = await dispatch(base, 'question.answer', { question_id: 'q1', choice: 'option', option_id: 'b', note: '' });
    expect(answered.status).toBe(200);
    expect(zVerbOk.parse(await answered.json()).records[0]).toMatchObject({
      stream: 'answers.jsonl',
      record: { question_id: 'q1', choice: 'option', option_id: 'b', actor: 'grill' },
    });
    b = await board(base);
    expect(b.questions[0]).toMatchObject({ phase: 'answered', answerPhrase: 'answered: option (rename it)', answerNote: null, answeredBy: 'grill' });
    expect(b.summary).toBe('1 of 1 answered · nothing open');

    // A second answer supersedes the first: latest wins.
    await dispatch(base, 'question.answer', { question_id: 'q1', choice: 'other', note: 'neither — split it' });
    b = await board(base);
    expect(b.questions[0]).toMatchObject({ phase: 'answered', answerPhrase: 'answered with a note', answerNote: 'neither — split it' });

    const retracted = await dispatch(base, 'question.retract', { question_id: 'q1' });
    expect(retracted.status).toBe(200);
    expect(zVerbOk.parse(await retracted.json()).records[0]).toMatchObject({ stream: 'answers.jsonl', record: { question_id: 'q1', retracted: true } });
    b = await board(base);
    expect(b.questions[0]).toMatchObject({ phase: 'open', answerPhrase: null, answerNote: null, answeredBy: null });

    // Nothing stands, so a second retract is refused; the log is append-only.
    const again = await dispatch(base, 'question.retract', { question_id: 'q1' });
    expect(zVerbError.parse(await again.json()).error.code).toBe('nothing_to_retract');
    expect(readFileSync(join(dir, 'answers.jsonl'), 'utf8').trim().split('\n')).toHaveLength(3);

    // And answering again after the retraction stands.
    await dispatch(base, 'question.answer', { question_id: 'q1', choice: 'recommended' });
    expect((await board(base)).questions[0]!.answerPhrase).toBe('answered: went with the recommendation');
  });

  it('refuses unknown questions, unknown options, an empty own answer, and answers on withdrawn questions', async () => {
    const dir = makeDir();
    const { base } = await start(dir);
    await dispatch(base, 'question.ask', ask('q1', 1));

    const unknown = await dispatch(base, 'question.answer', { question_id: 'nope', choice: 'recommended' });
    expect(zVerbError.parse(await unknown.json()).error.code).toBe('unknown_question');
    const badOption = await dispatch(base, 'question.answer', { question_id: 'q1', choice: 'option', option_id: 'z' });
    expect(zVerbError.parse(await badOption.json()).error.code).toBe('unknown_option');
    const noOption = await dispatch(base, 'question.answer', { question_id: 'q1', choice: 'option', option_id: null });
    expect(zVerbError.parse(await noOption.json()).error.code).toBe('option_required');
    const emptyOther = await dispatch(base, 'question.answer', { question_id: 'q1', choice: 'other', note: '  ' });
    expect(zVerbError.parse(await emptyOther.json()).error.code).toBe('note_required');

    const withdrawn = await dispatch(base, 'question.withdraw', { id: 'q1' }, 'Fable');
    expect(zVerbOk.parse(await withdrawn.json()).records[0]).toMatchObject({ stream: 'questions.jsonl', record: { id: 'q1', withdrawn: true, actor: 'Fable' } });
    const late = await dispatch(base, 'question.answer', { question_id: 'q1', choice: 'recommended' });
    expect(zVerbError.parse(await late.json()).error.code).toBe('question_withdrawn');
    const twice = await dispatch(base, 'question.withdraw', { id: 'q1' });
    expect(zVerbError.parse(await twice.json()).error.code).toBe('question_withdrawn');

    // Withdrawn questions leave the board; the id stays taken.
    const b = await board(base);
    expect(b.questions).toEqual([]);
    expect(b.summary).toBe('no questions yet');
    expect(foldQuestions(dir).get('q1')?.withdrawn).toBe(true);
  });

  it('serves round asc then ask order, round headers on the first row, and parsed prose blocks', async () => {
    const dir = makeDir();
    const { base } = await start(dir);
    await dispatch(base, 'question.ask', ask('r2a', 2));
    await dispatch(base, 'question.ask', ask('r1a', 1));
    await dispatch(base, 'question.ask', ask('r1b', 1, { options: [] }));
    await dispatch(base, 'question.answer', { question_id: 'r1a', choice: 'recommended', note: 'fine' });

    const b = await board(base);
    expect(b.questions.map((q) => [q.id, q.index, q.roundFirst])).toEqual([
      ['r1a', 'Q1', true],
      ['r1b', 'Q2', false],
      ['r2a', 'Q3', true],
    ]);
    expect(b.rounds).toEqual([
      { n: 1, label: 'round 1', openCount: 1, phrase: '1 of 2 questions open' },
      { n: 2, label: 'round 2', openCount: 1, phrase: '1 of 1 question open' },
    ]);
    expect(b.summary).toBe('1 of 3 answered · rounds 1, 2 open');
    expect(b.questions[0]!.answerNote).toBe('fine');
    expect(b.questions[0]!.bodyBlocks.map((x) => x.kind)).toEqual(['heading', 'para']);
    expect(b.questions[0]!.recommendationBlocks.map((x) => x.kind)).toEqual(['para']);
  });

  it('composes the phrases', () => {
    const options = [{ id: 'a', label: 'drop it' }];
    const floor = { question_id: 'q', actor: 'x', at: '2026-01-01T00:00:00Z', note: '' };
    expect(answerPhrase(null, options)).toBeNull();
    expect(answerPhrase({ ...floor, choice: 'recommended' }, options)).toBe('answered: went with the recommendation');
    expect(answerPhrase({ ...floor, choice: 'option', option_id: 'a' }, options)).toBe('answered: option (drop it)');
    expect(answerPhrase({ ...floor, choice: 'other', note: 'x' }, options)).toBe('answered with a note');
    expect(summaryPhrase(0, 0, [])).toBe('no questions yet');
    expect(summaryPhrase(5, 3, [2])).toBe('3 of 5 answered · round 2 open');
    expect(summaryPhrase(5, 5, [])).toBe('5 of 5 answered · nothing open');
  });
});

describe('the write boundary and the wire', () => {
  it('appendOwned refuses anything off OWNED_STREAMS before any handle exists', () => {
    const dir = makeDir();
    expect(OWNED_STREAMS).toEqual(['questions.jsonl', 'answers.jsonl']);
    expect(() => appendOwned(dir, 'review-verdict.jsonl', { actor: 'x', at: 'y' })).toThrow(/non-owned/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('creates a missing directory, publishes the descriptor with records, and answers the poll twin', async () => {
    const dir = join(makeDir(), 'nested', 'grill');
    expect(existsSync(dir)).toBe(false);
    const { base } = await start(dir);
    expect(existsSync(dir)).toBe(true);

    const descriptor = zAppDescriptor.parse(await (await fetch(`${base}/loupe/app`)).json());
    expect(descriptor.app.name).toBe('grill');
    expect(descriptor.verbs.map((v) => v.name).sort()).toEqual(['question.answer', 'question.ask', 'question.retract', 'question.withdraw']);
    expect(descriptor.verbs.find((v) => v.name === 'question.answer')?.records).toEqual([{ stream: 'answers.jsonl' }]);

    await dispatch(base, 'question.ask', ask('q1', 1), 'Fable');
    await dispatch(base, 'question.answer', { question_id: 'q1', choice: 'recommended' });
    const polled = zRecordsEnvelope.parse(await (await fetch(`${base}/loupe/records/answers.jsonl?after=0`)).json());
    expect(polled.records).toHaveLength(1);
    expect(polled.records[0]!.record).toMatchObject({ question_id: 'q1', choice: 'recommended' });
    // The persisted line is the same write the wire carried.
    expect(JSON.parse(readFileSync(join(dir, 'questions.jsonl'), 'utf8').trim())).toMatchObject({ id: 'q1', actor: 'Fable' });
  });

  it('repaints on fs.watch when another process appends a question', async () => {
    const dir = makeDir();
    const { app, base } = await start(dir);
    const stop = watchGrill(app, dir, 20);
    cleanups.push(stop);
    const before = zProjectionEnvelope.parse(await (await fetch(`${base}/loupe/state/board`)).json());
    writeFileSync(
      join(dir, 'questions.jsonl'),
      `${JSON.stringify({ ...ask('q9', 1), actor: 'Fable', at: '2026-09-18T00:00:00Z' })}\n`,
    );
    await new Promise((r) => setTimeout(r, 300));
    const after = zProjectionEnvelope.parse(await (await fetch(`${base}/loupe/state/board`)).json());
    expect(after.seq).toBeGreaterThan(before.seq);
    expect((after.state as unknown as Board).questions.map((q) => q.id)).toEqual(['q9']);
    expect(deriveBoard(dir)).toEqual(after.state);
  });
});

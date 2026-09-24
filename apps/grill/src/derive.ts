// The `board` projection: a pure fold over questions.jsonl + answers.jsonl.
// Every number is a sentence composed here; the fabrial has no arithmetic.
import { foldLatest, type Json } from '@loupe/protocol';
import { toJson, parseDoc } from '@loupe/serve';
import { readJsonl } from './streams.ts';
import { FOLD_KEYS, zAnswer, zQuestion, zRetraction, zWithdrawal, type Answer, type Option, type Question } from './records.ts';

export type Phase = 'open' | 'answered' | 'withdrawn';

/** One question as the fold sees it, before it becomes a served row. */
export interface FoldedQuestion {
  question: Question;
  /** File position of the ask, for ask order within a round. */
  order: number;
  withdrawn: boolean;
  /** The standing answer, or null when none stands (never answered, or retracted). */
  answer: Answer | null;
}

/** Ask records by id, withdrawal folded in. Every id asked, withdrawn or not. */
export function foldQuestions(grillDir: string): Map<string, FoldedQuestion> {
  const out = new Map<string, FoldedQuestion>();
  const lines = readJsonl(grillDir, 'questions.jsonl');
  lines.forEach((line, order) => {
    const asked = zQuestion.safeParse(line);
    if (asked.success) {
      // Duplicate ids are refused at the verb; a second ask line for an id
      // that slipped in by hand is ignored, never a silent overwrite.
      if (!out.has(asked.data.id)) out.set(asked.data.id, { question: asked.data, order, withdrawn: false, answer: null });
      return;
    }
    const withdrawn = zWithdrawal.safeParse(line);
    if (withdrawn.success) {
      const row = out.get(withdrawn.data.id);
      if (row !== undefined) row.withdrawn = true;
    }
  });
  const standing = foldLatest(readJsonl(grillDir, 'answers.jsonl'), FOLD_KEYS);
  for (const [id, row] of out) {
    const latest = standing[id];
    if (latest === undefined) continue;
    if (zRetraction.safeParse(latest).success) continue;
    const answer = zAnswer.safeParse(latest);
    if (answer.success) row.answer = answer.data;
  }
  return out;
}

/** The standing answer for one question, or null. */
export function standingAnswer(grillDir: string, questionId: string): Answer | null {
  return foldQuestions(grillDir).get(questionId)?.answer ?? null;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The sentence a standing answer reads as, or null when none stands. */
export function answerPhrase(answer: Answer | null, options: Option[]): string | null {
  if (answer === null) return null;
  if (answer.choice === 'recommended') return 'answered: went with the recommendation';
  if (answer.choice === 'option') {
    const label = options.find((o) => o.id === answer.option_id)?.label ?? answer.option_id ?? '?';
    return `answered: option (${label})`;
  }
  return 'answered with a note';
}

/** The summary sentence for the footer. */
export function summaryPhrase(total: number, answered: number, openRounds: number[]): string {
  if (total === 0) return 'no questions yet';
  const head = `${answered} of ${total} answered`;
  if (openRounds.length === 0) return `${head} · nothing open`;
  if (openRounds.length === 1) return `${head} · round ${openRounds[0]} open`;
  return `${head} · rounds ${openRounds.join(', ')} open`;
}

export function deriveBoard(grillDir: string): Json {
  const folded = [...foldQuestions(grillDir).values()]
    .filter((r) => !r.withdrawn)
    .sort((a, b) => a.question.round - b.question.round || a.order - b.order);

  const byRound = new Map<number, FoldedQuestion[]>();
  for (const row of folded) {
    const list = byRound.get(row.question.round) ?? [];
    list.push(row);
    byRound.set(row.question.round, list);
  }
  const rounds = [...byRound.entries()].map(([n, rows]) => {
    const openCount = rows.filter((r) => r.answer === null).length;
    return {
      n,
      label: `round ${n}`,
      openCount,
      phrase: openCount === 0 ? `all ${plural(rows.length, 'question')} answered` : `${openCount} of ${plural(rows.length, 'question')} open`,
    };
  });
  const roundPhrase = new Map(rounds.map((r) => [r.n, r.phrase]));

  let lastRound: number | null = null;
  const questions = folded.map((row, i) => {
    const q = row.question;
    const roundFirst = q.round !== lastRound;
    lastRound = q.round;
    const phase: Phase = row.answer === null ? 'open' : 'answered';
    return {
      id: q.id,
      round: q.round,
      roundLabel: `round ${q.round}`,
      roundPhrase: roundPhrase.get(q.round) ?? '',
      // The rail draws the round header on the first row of each round.
      roundFirst,
      index: `Q${i + 1}`,
      title: q.title,
      bodyBlocks: parseDoc(q.body).blocks,
      recommendation: q.recommendation,
      recommendationBlocks: parseDoc(q.recommendation).blocks,
      options: q.options,
      phase,
      answerPhrase: answerPhrase(row.answer, q.options),
      answerNote: row.answer === null || row.answer.note === '' ? null : row.answer.note,
      answeredBy: row.answer?.actor ?? null,
      answeredAt: row.answer?.at ?? null,
      askedBy: q.actor,
      askedAt: q.at,
    };
  });

  const answered = questions.filter((q) => q.phase === 'answered').length;
  const openRounds = rounds.filter((r) => r.openCount > 0).map((r) => r.n);
  return toJson({
    summary: summaryPhrase(questions.length, answered, openRounds),
    rounds,
    questions: questions as unknown as Json,
  });
}

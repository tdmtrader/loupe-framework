// The grill app's DOMAIN record shapes (r3f1): "question" and "answer" are
// words about grilling — an agent stress-testing a plan by asking a human —
// so they live here, built on the protocol's append-record floor.
import { z } from 'zod';
import { zRecordFloor } from '@loupe/protocol';

/** The fold identity across answers.jsonl (`FoldKeys.id`). */
export const FOLD_KEYS = { id: 'question_id', at: 'at', actor: 'actor' } as const;

/** One selectable option an agent offers beside its recommendation. */
export const zOption = z.strictObject({ id: z.string().min(1), label: z.string().min(1) });
export type Option = z.infer<typeof zOption>;

/**
 * A question record (questions.jsonl): what the agent asked, in which round,
 * with its own recommendation and any options. `body` and `recommendation`
 * are markdown; the projection parses them into ProseDoc blocks.
 */
export const zQuestion = zRecordFloor.extend({
  id: z.string(),
  round: z.number(),
  title: z.string(),
  body: z.string(),
  recommendation: z.string(),
  options: z.array(zOption),
});
export type Question = z.infer<typeof zQuestion>;

/**
 * A withdrawal record (questions.jsonl): the agent no longer wants an answer.
 * An append-only log never deletes, so withdrawing is a second line under the
 * same id; the fold reads it as "not on the board".
 */
export const zWithdrawal = zRecordFloor.extend({
  id: z.string(),
  withdrawn: z.literal(true),
});
export type Withdrawal = z.infer<typeof zWithdrawal>;

/** How a human answered: took the recommendation, picked an option, or wrote their own. */
export const ANSWER_CHOICES = ['recommended', 'option', 'other'] as const;
export type AnswerChoice = (typeof ANSWER_CHOICES)[number];

/** An answer record (answers.jsonl). Latest per question wins (`foldLatest`). */
export const zAnswer = zRecordFloor.extend({
  question_id: z.string(),
  choice: z.enum(ANSWER_CHOICES),
  option_id: z.string().nullable().optional(),
  note: z.string(),
});
export type Answer = z.infer<typeof zAnswer>;

/** A retraction record (answers.jsonl): undo is itself a record. */
export const zRetraction = zRecordFloor.extend({
  question_id: z.string(),
  retracted: z.literal(true),
});
export type Retraction = z.infer<typeof zRetraction>;

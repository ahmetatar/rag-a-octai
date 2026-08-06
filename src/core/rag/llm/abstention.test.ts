import { describe, expect, it } from 'vitest';
import { ABSTENTION_MESSAGE, isAbstention, NO_ANSWER_SENTINEL, presentAnswer } from './abstention';

describe('isAbstention', () => {
  it('detects the bare sentinel', () => {
    expect(isAbstention(NO_ANSWER_SENTINEL)).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(isAbstention(`\n  ${NO_ANSWER_SENTINEL}\n`)).toBe(true);
  });

  // Small models like to decorate a one-word answer; the decoration should not change the
  // measured behaviour.
  it('tolerates the markdown small models add', () => {
    expect(isAbstention('**NO_ANSWER**')).toBe(true);
    expect(isAbstention('> NO_ANSWER')).toBe(true);
    expect(isAbstention('"NO_ANSWER."')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isAbstention('no_answer')).toBe(true);
  });

  // Both variants below came out of the same local qwen3 model on consecutive runs, and both
  // are correct refusals. Scoring either as an answer would invent the exact hallucination
  // this metric exists to detect.
  it('tolerates an echoed answer label', () => {
    expect(isAbstention('Answer: NO_ANSWER')).toBe(true);
    expect(isAbstention('Answer:\n**NO_ANSWER**')).toBe(true);
  });

  it('tolerates a wrapper tag around the sentinel', () => {
    expect(isAbstention('<answer>NO_ANSWER</answer>')).toBe(true);
    expect(isAbstention('<response>\n  NO_ANSWER\n</response>')).toBe(true);
  });

  it('is false for a real answer', () => {
    expect(isAbstention('Jupiter is the largest planet.')).toBe(false);
  });

  // A model that genuinely answers may quote the instruction it was given; only a LEADING
  // sentinel counts, otherwise a real answer would be miscounted as a refusal.
  it('is false when the sentinel is merely mentioned inside an answer', () => {
    expect(isAbstention('You told me to reply NO_ANSWER, but the context does cover this.')).toBe(false);
  });

  it('is false for empty output', () => {
    expect(isAbstention('')).toBe(false);
  });
});

describe('presentAnswer', () => {
  it('replaces the sentinel with a human-readable message', () => {
    expect(presentAnswer(NO_ANSWER_SENTINEL)).toBe(ABSTENTION_MESSAGE);
  });

  it('leaves a real answer untouched', () => {
    expect(presentAnswer('Jupiter is the largest planet.')).toBe('Jupiter is the largest planet.');
  });

  // The sentinel is an internal protocol token; a client should never see it.
  it('never leaks the sentinel to a caller', () => {
    expect(presentAnswer('**NO_ANSWER**')).not.toContain(NO_ANSWER_SENTINEL);
  });
});

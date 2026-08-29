import { Ollama } from 'ollama';
import { logger } from '@infrastructure/logging';
import { resilientCall } from '../resilient-call';
import { ExpectedKeyword } from './metrics';

/**
 * An LLM judge's verdict on one generated answer.
 */
export interface JudgeVerdict {
  /** Whether the judge considers the answer factually correct against the expected facts. */
  correct: boolean;
  /** The judge's one-line justification, kept for the report — not scored. */
  reasoning: string;
}

/**
 * Optional LLM-judge layer for the eval harness (`EVAL_JUDGE=true`).
 *
 * {@link groundedness} is a deterministic trigram-overlap proxy: it rewards an answer that
 * reuses the source's wording and punishes one that paraphrases correctly, so it cannot tell
 * "right answer, own words" from "wrong answer, fluent paraphrase" apart. A judge model reads
 * the question, the expected facts, and the answer, and gives the absolute verdict the proxy
 * cannot: is this actually correct. It is deliberately layered ON TOP of, not instead of, the
 * deterministic metrics — an LLM judge is itself non-deterministic and must never gate a
 * build (see {@link GATEABLE_METRICS}); it is reported for human review.
 *
 * Only scores cases that declare `expectedKeywords` — without an answer key there is nothing
 * for the judge to check the answer against.
 */
export class LlmJudge {
  private readonly ollama: Ollama;

  constructor(private readonly model: string, host: string) {
    this.ollama = new Ollama({ host });
  }

  /**
   * Judges one generated answer against the case's expected facts.
   * @param question The question that was asked.
   * @param answer The model's generated answer.
   * @param expectedKeywords The facts the answer was expected to contain.
   * @returns The verdict, or `undefined` when the answer failed to parse — a failed judge call
   * must not silently read as "incorrect".
   */
  async judge(question: string, answer: string, expectedKeywords: ExpectedKeyword[]): Promise<JudgeVerdict | undefined> {
    const expectedFacts = expectedKeywords
      .map((keyword) => (Array.isArray(keyword) ? keyword[0] : keyword))
      .join('; ');

    try {
      const response = await resilientCall('ollama.judge', () =>
        this.ollama.chat({
          model: this.model,
          format: 'json',
          messages: [
            {
              role: 'system',
              content:
                'You are a strict grader for a question-answering system. You are given a ' +
                'question, the facts a correct answer must contain, and a candidate answer. ' +
                'Judge only whether the candidate answer is factually consistent with the ' +
                'expected facts and actually answers the question — ignore style, wording and ' +
                'completeness beyond the listed facts. Respond with JSON only, of the exact ' +
                'shape {"correct": boolean, "reasoning": string}, where "reasoning" is one ' +
                'short sentence.',
            },
            {
              role: 'user',
              content: `Question: ${question}\n\nExpected facts: ${expectedFacts}\n\nCandidate answer: ${answer}`,
            },
          ],
        })
      );

      const parsed = JSON.parse(response.message.content) as { correct?: unknown; reasoning?: unknown };
      if (typeof parsed.correct !== 'boolean') {
        throw new Error(`judge response missing a boolean "correct" field: ${response.message.content}`);
      }

      return { correct: parsed.correct, reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '' };
    } catch (error) {
      logger.warn(`LLM judge failed, leaving the case unjudged: ${error instanceof Error ? error.message : error}`);
      return undefined;
    }
  }
}

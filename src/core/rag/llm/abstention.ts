/**
 * Abstention: the machine-readable signal a model emits when the retrieved context does not
 * contain the answer.
 *
 * A RAG system's most important failure mode is answering from parametric memory when
 * retrieval found nothing — the answer looks fluent and is unsourced. To measure that, the
 * evaluation harness has to tell "refused" apart from "answered", and free-form prose ("I'm
 * afraid I don't have enough information...") cannot be classified reliably across models or
 * languages. So the model is instructed to emit a fixed sentinel instead, and every consumer
 * goes through this module rather than matching the string itself.
 *
 * The sentinel is an INTERNAL protocol token: it is stripped before an answer reaches an API
 * client, who sees {@link ABSTENTION_MESSAGE} instead plus an explicit `abstained` flag.
 */

/** The exact token a model emits when the context cannot answer the question. */
export const NO_ANSWER_SENTINEL = 'NO_ANSWER';

/** What a client sees in place of the sentinel. */
export const ABSTENTION_MESSAGE =
  'I could not find an answer to this question in the available documents.';

/**
 * The instruction given to the model, shared by the system prompt and the no-context prompt
 * so the two can never drift apart.
 */
export const ABSTENTION_INSTRUCTION =
  `If the context does not contain the information needed to answer, reply with exactly ` +
  `${NO_ANSWER_SENTINEL} and nothing else. Do not answer from your own knowledge, and do not ` +
  `guess.`;

/**
 * Whether an answer is an abstention.
 *
 * Matched at the START of the trimmed answer rather than anywhere in it: a model that
 * genuinely answers may well mention the token (for instance when quoting these very
 * instructions), while a model that abstains leads with it. Leading markdown/quote
 * punctuation is tolerated because small models like to decorate.
 *
 * @param answer The raw generated answer.
 * @returns True when the model declined to answer.
 */
export function isAbstention(answer: string): boolean {
  return SENTINEL_PREFIX.test(normalise(answer));
}

/**
 * Replaces the sentinel with a human-readable message, leaving non-abstention answers
 * untouched. Callers that need to know WHETHER the model abstained should use
 * {@link isAbstention} on the raw answer before calling this.
 *
 * @param answer The raw generated answer.
 * @returns The answer as it should be shown to a client.
 */
export function presentAnswer(answer: string): string {
  return isAbstention(answer) ? ABSTENTION_MESSAGE : answer;
}

/** The sentinel at the very start of normalised output. */
const SENTINEL_PREFIX = new RegExp(`^${NO_ANSWER_SENTINEL}\\b`, 'i');

/**
 * Strips the scaffolding models wrap a one-word reply in, so the check tests the reply itself.
 *
 * Matching the raw string is unreliable: a local qwen3 run produced `Answer: NO_ANSWER` on one
 * pass (the prompt ends with `Answer:`, so the model continued the pattern) and
 * `<answer>NO_ANSWER</answer>` on the next. Each variant is a correct refusal, and each would
 * otherwise be scored as a hallucinated answer — the single worst way for this metric to be
 * wrong, since it invents the exact failure it exists to detect.
 *
 * Only leading scaffolding is removed. A model that genuinely answers and happens to mention
 * the token later must not be read as abstaining.
 *
 * @param answer The raw generated answer.
 * @returns The answer with wrapper tags, decoration and an echoed label removed from the front.
 */
function normalise(answer: string): string {
  return answer
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(DECORATION, '')
    .replace(/^(?:answer|response)\s*:\s*/i, '')
    .replace(DECORATION, '');
}

/** Leading whitespace, markdown emphasis, quotes and list/quote markers. */
const DECORATION = /^[\s>*_"'`#\-.]+/;

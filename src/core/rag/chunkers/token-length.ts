import { getEncoding, Tiktoken } from 'js-tiktoken';

/**
 * Lazily built, process-wide tiktoken encoder. Building it parses the full BPE rank table, so
 * it is created once and reused rather than per chunker instance or per call.
 */
let encoder: Tiktoken | undefined;

/**
 * Counts the tokens `text` would take, as a length function for
 * `RecursiveCharacterTextSplitter`'s `lengthFunction` option — measuring `chunkSize`/`overlap`
 * in tokens instead of characters.
 *
 * Uses `cl100k_base` (GPT-3.5/4's tokenizer) as a general-purpose approximation. This project's
 * generation models (Ollama/GGUF) each have their own tokenizer, and none is a pure-JS,
 * dependency-free fit for a chunker that must run synchronously per split; cl100k_base is the
 * de-facto standard proxy for "roughly how many tokens is this", which is what a chunk-size
 * BUDGET needs — it does not need to match token-for-token.
 *
 * @param text The text to measure.
 * @returns The token count.
 */
export function tokenLength(text: string): number {
  if (!encoder) {
    encoder = getEncoding('cl100k_base');
  }

  return encoder.encode(text).length;
}

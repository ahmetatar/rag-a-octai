import { Document } from '../file-handlers';

/**
 * Interface representing a prompt for the language model.
 */
export interface PromptContext {
  question: string;
  maxTokens?: number;
  sources?: Document[];
}

/**
 * Token counts for one generation call, when the backend reports them. Used to derive
 * cost and to track generation spend in the eval harness — not every runner can supply
 * this (a local llama.cpp session may not), so callers must treat it as optional.
 */
export interface TokenUsage {
  /** Tokens consumed by the prompt (system + context + question). */
  promptTokens: number;
  /** Tokens produced by the model in its reply. */
  completionTokens: number;
}

/**
 * The result of one generation call: the text plus, when available, how many tokens it cost.
 */
export interface GenerationResult {
  text: string;
  usage?: TokenUsage;
}

/**
 * Abstract class representing a language model.
 */
export abstract class LangModelBase {
  /**
   * Generate a response based on the given prompt.
   * @param promptCtx - The prompt containing text, question, and optional parameters.
   * @returns A promise that resolves to the generated text and, when the backend reports it,
   * the token usage.
   */
  abstract generateResponse(promptCtx: PromptContext): Promise<GenerationResult>;

  /**
   * Builds the context block from the retrieved documents.
   *
   * Each document is wrapped in a `<document index="N">` tag so the model sees a clear,
   * enumerable boundary for every source (and can still cite it by index). Delimiter tokens
   * occurring INSIDE a document are neutralised first — otherwise a malicious document could
   * embed its own `</document>`/`</context>` to break out of the data section and have the
   * text after it read as instructions. This is the core prompt-injection defence: the model
   * is told (in the system prompt) that everything here is untrusted data, and the tagging
   * makes that boundary unforgeable.
   *
   * @param promptCtx - The prompt containing the retrieved documents and the question.
   * @returns {string} The constructed context string, empty when there are no documents.
   */
  protected buildContext(promptCtx: PromptContext): string {
    if (!promptCtx.sources?.length) {
      return '';
    }

    const contextParts = promptCtx.sources.map(
      (doc, idx) => `<document index="${idx + 1}">\n${neutraliseDelimiters(doc.content)}\n</document>`
    );
    return contextParts.join('\n\n');
  }
}

/**
 * Neutralises any context/document delimiter tags a document's own text contains, so the
 * document cannot forge a boundary (e.g. a stray `</context>`) to escape the data section
 * and inject instructions. The tag's angle brackets are stripped, leaving the words as inert
 * text rather than removing content outright.
 *
 * @param content The raw document content.
 * @returns The content with any delimiter tags defanged.
 */
function neutraliseDelimiters(content: string): string {
  return content.replace(/<\/?(?:context|document)\b[^>]*>/gi, (tag) => tag.replace(/[<>]/g, ''));
}

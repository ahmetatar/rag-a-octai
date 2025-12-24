import { Document } from '@infrastructure/file-handlers';

/**
 * Interface representing a prompt for the language model.
 */
export interface PromptContext {
  question: string;
  maxTokens?: number;
  sources?: Document[];
}

/**
 * Abstract class representing a language model.
 */
export abstract class LangModelBase {
  /**
   * Generate a response based on the given prompt.
   * @param promptCtx - The prompt containing text, question, and optional parameters.
   * @returns {Promise<string>} A promise that resolves to the generated response string.
   */
  abstract generateResponse(promptCtx: PromptContext): Promise<string>;

  /**
   * Build context string from an array of documents.
   * @param promptCtx - The prompt containing context and question.
   * @returns {string} The constructed context string.
   */
  protected buildContext(promptCtx: PromptContext): string {
    if (!promptCtx.sources?.length) {
      return '';
    }

    const contextParts = promptCtx.sources.map((doc, idx) => `[${idx + 1}] ${doc.content}`);
    return contextParts.join('\n\n');
  }
}

import { ChatRequest, Ollama } from 'ollama';
import { LangModelBase, PromptContext } from './model-base';

/**
 * Implementation of LangModel for Ollama LLM manager.
 * Uses Ollama's chat API to generate responses based on provided prompts and context.
 * @extends LangModelBase
 * @category Infrastructure/LangModels
 * @see {@link https://ollama.com/docs Ollama Documentation}
 * @example
 * ```typescript
 * import { OllamaLangModel } from '@infrastructure/lang-models/ollama-model';
 *
 * const ollamaModel = new OllamaLangModel('llama2', 'http://localhost:11434');
 * const promptCtx = {
 *   question: 'What is the capital of France?',
 *   contextSources: ['France is a country in Europe. The capital of France is Paris.'],
 * };
 *
 * const response = await ollamaModel.generateResponse(promptCtx);
 * console.log(response); // Outputs: Paris
 * ```
 */
export class OllamaLangModel extends LangModelBase {
  private readonly ollama: Ollama;

  constructor(private model: string, private host: string) {
    super();
    this.ollama = new Ollama({ host: this.host });
  }

  /** @inheritdoc */
  async generateResponse(promptCtx: PromptContext): Promise<string> {
    const prompt = this.buildPrompt(promptCtx);
    const response = await this.ollama.chat(prompt);
    return response.message.content;
  }

  /**
   * Builds the prompt string with context and question.
   * @param promptCtx The prompt containing context and question.
   * @returns The formatted prompt string.
   */
  private buildPrompt(promptCtx: PromptContext) {
    const context = this.buildContext(promptCtx);
    const content = this.buildContent(context, promptCtx.question);
    const promptTemplate = {
      model: this.model,
      messages: [
        {
          role: 'system',
          content:
            "You are a helpful assistant. Use the following context to answer the question. If the context doesn't contain relevant information, say so politely.",
        },
        { role: 'user', content },
      ],
    };

    return promptTemplate;
  }

  /**
   * Builds the content string for the prompt.
   * @param context The context string.
   * @param question The question string.
   * @returns The formatted content string.
   */
  private buildContent(context: string, question: string): string {
    if (!context) {
      return `Question: ${question}\n\nYou don't have any relevant information to answer this question. Please say so politely.`;
    }
    return `Context: ${context}\n\nQuestion: ${question}\n\nAnswer:`;
  }
}

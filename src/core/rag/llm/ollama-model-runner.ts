import { ChatRequest, Ollama } from 'ollama';
import { LangModelBase, PromptContext } from './model-base';
import { resilientCall } from '../resilient-call';

/**
 * Implementation of LangModel for Ollama LLM manager.
 * Uses Ollama's chat API to generate responses based on provided prompts and context.
 * @extends LangModelBase
 * @see {@link https://ollama.com/docs Ollama Documentation}
 */
export class OllamaLangModelRunner extends LangModelBase {
  private readonly ollama: Ollama;

  constructor(private model: string, private host: string) {
    super();
    this.ollama = new Ollama({ host: this.host });
  }

  /** @inheritdoc */
  async generateResponse(promptCtx: PromptContext): Promise<string> {
    const prompt = this.buildPrompt(promptCtx);
    const response = await resilientCall('ollama.chat', () => this.ollama.chat(prompt));
    return response.message.content;
  }

  /**
   * Builds the prompt string with context and question.
   * @param promptCtx The prompt containing context and question.
   * @returns The formatted prompt string.
   */
  private buildPrompt(promptCtx: PromptContext): ChatRequest & { stream?: false } {
    const context = this.buildContext(promptCtx);
    const content = this.buildContent(context, promptCtx.question);
    const promptTemplate: ChatRequest & { stream?: false } = {
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

    // Ollama caps generation through `num_predict`; without it the configured token
    // limit is silently ignored and the model generates until it decides to stop.
    if (promptCtx.maxTokens !== undefined) {
      promptTemplate.options = { num_predict: promptCtx.maxTokens };
    }

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

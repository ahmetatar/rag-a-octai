import { LlamaChatSession } from 'node-llama-cpp';
import { LangModelBase, PromptContext } from './model-base';

/**
 * Implementation of LangModel for Llama LLM manager.
 * Uses llama.cpp API to generate responses based on provided prompts and context.
 * @extends LangModelBase
 * @see {@link https://node-llama-cpp.withcat.ai/ node-llama-cpp Documentation}
 */
export class LlamaLangModelRunner extends LangModelBase {
  private chatSession: LlamaChatSession;

  private constructor(chatSession: LlamaChatSession) {
    super();
    this.chatSession = chatSession;
  }

  /**
   * Factory method to create an instance of LlamaLangModelRunner.
   * @param modelPath The file path to the Llama model.
   * @returns An instance of LlamaLangModelRunner.
   */
  static async create(modelPath: string): Promise<LlamaLangModelRunner> {
    const { getLlama, LlamaLogLevel } = await import('node-llama-cpp');

    const llama = await getLlama({ logLevel: LlamaLogLevel.error });
    const model = await llama.loadModel({ modelPath });
    const context = await model.createContext();
    const session = new LlamaChatSession({ contextSequence: context.getSequence() });
    
    return new LlamaLangModelRunner(session);
  }

  /** @inheritdoc */
  async generateResponse(promptCtx: PromptContext): Promise<string> {
    throw new Error('Method not implemented.');
  }
}

import { GoogleGenAI } from '@google/genai';
import { BaseEmbedding } from './base-embedding';

/**
 * Gemini embedding implementation.
 * @category Infrastructure/Embedding
 * @extends BaseEmbedding
 * @example
 * ```typescript
 * import { GeminiEmbedding } from 'your-module-path';
 * 
 * const embedding = new GeminiEmbedding();
 * const vectors = await embedding.embed(['Your text here']);
 * ```
 */
export class GeminiEmbedding extends BaseEmbedding {
  private readonly ai = new GoogleGenAI({});

  /** @inheritdoc */
  async embed(texts: string[]): Promise<number[][]> {
    const response = await this.ai.models.embedContent({
      model: process.env.EMBEDDING_MODEL || 'gemini-1.5-embed-text-001',
      contents: texts,
      config: {
        taskType: 'RETRIEVAL_DOCUMENT',
      },
    });

    if (!response.embeddings) {
      throw new Error('Failed to generate embeddings');
    }

    const embeddings = response.embeddings.map((e) => e.values as number[]);
    return embeddings;
  }
}

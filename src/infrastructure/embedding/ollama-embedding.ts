import { Ollama } from 'ollama';
import { BaseEmbedding } from './base-embedding';
import logger from '@infrastructure/logging/default-logger';

/**
 * Embedding class that uses Ollama's embedding service.
 */
export class OllamaEmbedding extends BaseEmbedding {
  private readonly ollama: Ollama;

  constructor(private model: string, private host: string) {
    super();
    this.ollama = new Ollama({ host: this.host });
  }

  /** @inheritdoc */
  async embed(texts: string[]): Promise<number[][]> {
    const response = await this.ollama.embed({
      model: this.model,
      input: texts,
    });
    const dimensions = response.embeddings[0]?.length || 0;
    logger.info(`Ollama embedding generated ${response.embeddings.length} embeddings with dimension ${dimensions}.`);

    return response.embeddings.map((e) => e as number[]);
  }
}

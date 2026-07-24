import { describe, expect, it } from 'vitest';
import { LlamaTextEmbedder } from './llama-embedding';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Builds an embedder around a stub context. The real constructor is private because
 * instances are meant to come from `create()`, which would load a GGUF model.
 * @param delaysByText How long embedding each text takes, in milliseconds.
 */
function embedderWithDelays(delaysByText: Record<string, number>) {
  const embeddingContext = {
    getEmbeddingFor: async (text: string) => {
      await sleep(delaysByText[text]);
      return { vector: new Float32Array([text.charCodeAt(0)]) };
    },
  };

  return new (LlamaTextEmbedder as unknown as new (context: unknown) => LlamaTextEmbedder)(embeddingContext);
}

describe('LlamaTextEmbedder', () => {
  it('returns embeddings in input order even when they finish out of order', async () => {
    // 'a' finishes last, 'c' first: collecting results as they complete would return c,b,a
    // and pair every chunk with another chunk's vector.
    const embedder = embedderWithDelays({ a: 40, b: 20, c: 1 });

    const vectors = await embedder.embed(['a', 'b', 'c']);

    expect(vectors.map(([code]) => String.fromCharCode(code))).toEqual(['a', 'b', 'c']);
  });

  it('accepts a single string', async () => {
    const embedder = embedderWithDelays({ a: 1 });

    const vectors = await embedder.embed('a');

    expect(vectors).toHaveLength(1);
  });

  it('returns one vector per input', async () => {
    const embedder = embedderWithDelays({ a: 5, b: 5, c: 5 });

    const vectors = await embedder.embed(['a', 'b', 'c']);

    expect(vectors).toHaveLength(3);
  });
});

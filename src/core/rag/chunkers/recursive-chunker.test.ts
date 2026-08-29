import { describe, expect, it } from 'vitest';
import { RecursiveChunker } from './recursive-chunker';
import { tokenLength } from './token-length';

describe('RecursiveChunker', () => {
  it('defaults to measuring chunkSize/overlap in characters', async () => {
    const chunker = new RecursiveChunker({ chunkSize: 20, overlap: 0 });
    const text = 'a'.repeat(50);

    const chunks = await chunker.chunk(text);

    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(20);
    }
  });

  it('measures chunkSize/overlap in tokens when unit is "tokens"', async () => {
    // Repeated words tokenize far more compactly than they read in characters, so a
    // token-budget chunker fits noticeably more TEXT per chunk than a character-budget one
    // would for the same nominal chunkSize — that difference is what this test checks for.
    const chunker = new RecursiveChunker({ chunkSize: 20, overlap: 0, unit: 'tokens' });
    const text = Array(60).fill('hello world').join(' ');

    const chunks = await chunker.chunk(text);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(tokenLength(chunk.content)).toBeLessThanOrEqual(20);
    }
    // A character-budget chunker at the same nominal size would need far more chunks to cover
    // the same text, since "hello world " is 12 characters but only ~2-3 tokens.
    const characterChunker = new RecursiveChunker({ chunkSize: 20, overlap: 0 });
    const characterChunks = await characterChunker.chunk(text);
    expect(chunks.length).toBeLessThan(characterChunks.length);
  });

  it('still recurses on paragraph/sentence/word boundaries under the token unit', async () => {
    const chunker = new RecursiveChunker({ chunkSize: 10, overlap: 0, unit: 'tokens' });
    const text = 'First sentence here. Second sentence here.\n\nSecond paragraph starts here.';

    const chunks = await chunker.chunk(text);

    expect(chunks.length).toBeGreaterThan(1);
    // Every character of the source survives somewhere in the chunks (recursive splitting on
    // separators, not an arbitrary token-boundary cut mid-word).
    for (const word of ['First', 'sentence', 'Second', 'paragraph']) {
      expect(chunks.some((chunk) => chunk.content.includes(word))).toBe(true);
    }
  });

  it('carries the same chunk/totalChunks metadata under either unit', async () => {
    const chunker = new RecursiveChunker({ chunkSize: 10, overlap: 0, unit: 'tokens' });

    const chunks = await chunker.chunk('one two three four five six seven eight nine ten');

    expect(chunks[0].metadata?.totalChunks).toBe(chunks.length);
    expect(chunks.map((chunk) => chunk.metadata?.chunk)).toEqual(chunks.map((_, index) => index));
  });
});

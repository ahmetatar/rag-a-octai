import { describe, expect, it } from 'vitest';
import { RecursiveChunker } from './recursive-chunker';

describe('RecursiveChunker', () => {
  it('uses approximate token counts and overlap', async () => {
    const chunker = new RecursiveChunker({ chunkSize: 4, overlap: 1, unit: 'tokens' });
    const chunks = await chunker.chunk('one two three four five six seven');

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].metadata?.chunkUnit).toBe('tokens');
    expect(chunks[1].content).toContain('four');
  });

  it('adds heading paths to chunk text and metadata', async () => {
    const chunker = new RecursiveChunker({ chunkSize: 100, overlap: 0, unit: 'tokens' });
    const chunks = await chunker.chunk('# Guide\nIntro text.\n## Install\nInstall text.');

    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata?.sectionPath).toBe('Guide');
    expect(chunks[1].metadata?.sectionPath).toBe('Guide > Install');
    expect(chunks[1].content.startsWith('Section: Guide > Install')).toBe(true);
  });
});

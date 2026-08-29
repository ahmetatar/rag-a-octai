import { describe, expect, it, vi } from 'vitest';
import { RagDataIngestor } from './ingestion';
import { BaseEmbedding } from './embedding';
import { Document, FileInfo } from './file-handlers';
import { UpsertItem } from './vector-store';

const FILE: FileInfo = {
  originalname: 'doc.txt',
  mimetype: 'text/plain',
  size: 11,
  encoding: '7bit',
  buffer: Buffer.from('hello world'),
};

/**
 * Assembles an ingestor over stubbed collaborators.
 * @param chunks The chunks the chunker produces for each file.
 * @param embed Produces the embeddings for a batch of texts.
 * @param batchSize The embedding batch size to configure.
 */
function ingestorOver(chunks: Document[], embed: (texts: string[]) => number[][], batchSize = 64) {
  const upserted: UpsertItem[][] = [];
  const deletedSources: string[] = [];
  const deletedTenants: (string | undefined)[] = [];
  const embedBatches: string[][] = [];

  class StubEmbedding extends BaseEmbedding {
    async embed(texts: string | string[]): Promise<number[][]> {
      const list = Array.isArray(texts) ? texts : [texts];
      embedBatches.push(list);
      return embed(list);
    }
  }

  const resolveHandler = vi.fn(() => ({ handleFile: async () => ({ content: 'hello world' }) }));

  const ingestor = new RagDataIngestor(
    // Like the real chunker, merge the metadata the ingestor passes (source, mimeType).
    { chunk: async (_text: string, meta: Record<string, unknown>) =>
        chunks.map((chunk) => ({ ...chunk, metadata: { ...meta, ...chunk.metadata } })) } as never,
    resolveHandler as never,
    new StubEmbedding(),
    {
      upsert: async (items: UpsertItem[]) => void upserted.push(items),
      deleteBySource: async (source: string, tenantId?: string) => {
        deletedSources.push(source);
        deletedTenants.push(tenantId);
      },
    } as never,
    batchSize
  );

  return { ingestor, upserted, deletedSources, deletedTenants, embedBatches };
}

describe('RagDataIngestor.ingest', () => {
  it('rejects a request with no files', async () => {
    const { ingestor } = ingestorOver([], () => []);

    await expect(ingestor.ingest([])).rejects.toThrow('No files provided');
  });

  it('pairs every chunk with its own embedding', async () => {
    const chunks: Document[] = [
      { content: 'alpha', metadata: {} },
      { content: 'beta', metadata: {} },
    ];
    // One distinct vector per text, so a mix-up is visible in the upserted payload.
    const { ingestor, upserted } = ingestorOver(chunks, (texts) => texts.map((text) => [text.length]));

    await ingestor.ingest([FILE]);

    expect(upserted.flat()).toEqual([
      {
        id: 'doc.txt#0',
        text: 'alpha',
        metadata: { source: 'doc.txt', mimeType: 'text/plain', chunk: 0, totalChunks: 2 },
        embedding: [5],
      },
      {
        id: 'doc.txt#1',
        text: 'beta',
        metadata: { source: 'doc.txt', mimeType: 'text/plain', chunk: 1, totalChunks: 2 },
        embedding: [4],
      },
    ]);
  });

  it('gives chunks deterministic per-source ids so re-ingesting overwrites', async () => {
    const chunks: Document[] = [{ content: 'alpha' }, { content: 'beta' }, { content: 'gamma' }];
    const { ingestor, upserted } = ingestorOver(chunks, (texts) => texts.map(() => [0]));

    await ingestor.ingest([FILE]);
    await ingestor.ingest([FILE]);

    // Same file twice yields the same ids both times, so the store overwrites rather than
    // accumulating a second copy.
    expect(upserted[0].map((item) => item.id)).toEqual(['doc.txt#0', 'doc.txt#1', 'doc.txt#2']);
    expect(upserted[1].map((item) => item.id)).toEqual(['doc.txt#0', 'doc.txt#1', 'doc.txt#2']);
  });

  it("deletes a source's existing chunks before storing the new ones", async () => {
    const chunks: Document[] = [{ content: 'alpha' }];
    const { ingestor, deletedSources } = ingestorOver(chunks, (texts) => texts.map(() => [0]));

    await ingestor.ingest([FILE]);

    expect(deletedSources).toEqual(['doc.txt']);
  });

  it('tags every chunk with the tenant and scopes the delete to it', async () => {
    const chunks: Document[] = [{ content: 'alpha' }, { content: 'beta' }];
    const { ingestor, upserted, deletedTenants } = ingestorOver(chunks, (texts) => texts.map(() => [0]));

    await ingestor.ingest([FILE], undefined, 'acme');

    expect(upserted.flat().every((item) => item.metadata?.tenantId === 'acme')).toBe(true);
    expect(deletedTenants).toEqual(['acme']);
  });

  it('embeds in batches of the configured size, preserving order', async () => {
    const chunks: Document[] = Array.from({ length: 5 }, (_, i) => ({ content: `c${i}` }));
    const { ingestor, upserted, embedBatches } = ingestorOver(chunks, (texts) => texts.map((t) => [t.length]), 2);

    await ingestor.ingest([FILE]);

    // 5 chunks at batch size 2 → batches of 2, 2, 1.
    expect(embedBatches.map((batch) => batch.length)).toEqual([2, 2, 1]);
    expect(upserted.flat().map((item) => item.text)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
  });

  it('refuses to store anything when the embedder returns the wrong number of vectors', async () => {
    const chunks: Document[] = [{ content: 'alpha' }, { content: 'beta' }];
    // A single batch large enough to hold both chunks, returning too few vectors.
    const { ingestor, upserted } = ingestorOver(chunks, () => [[1]], 64);

    await expect(ingestor.ingest([FILE])).rejects.toThrow('Embedding count mismatch: got 1 embeddings for 2 chunks');
    expect(upserted).toHaveLength(0);
  });

  it('stores nothing when a file yields no chunks', async () => {
    const { ingestor, upserted, deletedSources } = ingestorOver([], () => []);

    await ingestor.ingest([FILE]);

    expect(upserted).toHaveLength(0);
    expect(deletedSources).toHaveLength(0);
  });

  it('resolves a handler per file instead of sharing one across the request', async () => {
    // Two files of different types processed by one ingestor: each must be read by its own
    // handler, which only holds if resolution is stateless rather than a shared field.
    const resolveHandler = vi.fn((mimetype: string) => ({
      handleFile: async () => ({ content: `handled:${mimetype}` }),
    }));
    const seenContent: string[] = [];

    const ingestor = new RagDataIngestor(
      { chunk: async (text: string) => [{ content: text, metadata: {} }] } as never,
      resolveHandler as never,
      new (class extends BaseEmbedding {
        async embed(texts: string | string[]) {
          const list = Array.isArray(texts) ? texts : [texts];
          seenContent.push(...list);
          return list.map(() => [0]);
        }
      })(),
      { upsert: async () => undefined, deleteBySource: async () => undefined } as never
    );

    await ingestor.ingest([
      { ...FILE, originalname: 'a.txt', mimetype: 'text/plain' },
      { ...FILE, originalname: 'b.pdf', mimetype: 'application/pdf' },
    ]);

    expect(resolveHandler).toHaveBeenCalledTimes(2);
    expect(seenContent).toEqual(['handled:text/plain', 'handled:application/pdf']);
  });

  it('tags each chunk with the heading path of the section it came from', async () => {
    const structuredDoc = ['1. Overview', '', 'Top-level prose.', '', '2. Components', '', '2.1 Kestrel collector', '', 'Kestrel prose.'].join(
      '\n'
    );
    const resolveHandler = vi.fn(() => ({ handleFile: async () => ({ content: structuredDoc }) }));
    const upserted: UpsertItem[][] = [];

    const ingestor = new RagDataIngestor(
      // A pass-through chunker: one chunk per section body, so the test can see exactly what
      // metadata the ingestor attached before the chunker ever ran.
      { chunk: async (text: string, meta: Record<string, unknown>) => [{ content: text, metadata: meta }] } as never,
      resolveHandler as never,
      new (class extends BaseEmbedding {
        async embed(texts: string | string[]) {
          return (Array.isArray(texts) ? texts : [texts]).map(() => [0]);
        }
      })(),
      { upsert: async (items: UpsertItem[]) => void upserted.push(items), deleteBySource: async () => undefined } as never
    );

    await ingestor.ingest([FILE]);

    const bySection = Object.fromEntries(upserted.flat().map((item) => [item.metadata?.sectionPath ?? '(none)', item.text]));
    // The content is prefixed with its own section breadcrumb (see the next test), so it
    // ends with, rather than equals, the section's body.
    expect(bySection['1. Overview']).toContain('Top-level prose.');
    expect(bySection['2. Components > 2.1 Kestrel collector']).toContain('Kestrel prose.');
    // "2. Components" itself has no body of its own (only its sub-heading does), so it
    // contributes no chunk at all.
    expect(Object.keys(bySection)).not.toContain('2. Components');

    const overviewChunk = upserted.flat().find((item) => item.text.includes('Top-level prose.'));
    expect(overviewChunk?.metadata?.heading).toBe('1. Overview');
    const kestrelChunk = upserted.flat().find((item) => item.text.includes('Kestrel prose.'));
    expect(kestrelChunk?.metadata?.heading).toBe('2.1 Kestrel collector');
  });

  it('prepends the section breadcrumb to each chunk of that section, not just the first', async () => {
    const structuredDoc = ['1. Overview', '', 'Sentence one. Sentence two.'].join('\n');
    const resolveHandler = vi.fn(() => ({ handleFile: async () => ({ content: structuredDoc }) }));
    const upserted: UpsertItem[][] = [];

    const ingestor = new RagDataIngestor(
      // Splits the section body into two chunks, so the test can see the breadcrumb reach
      // BOTH — not just get glued onto the section's raw text once before splitting.
      { chunk: async (text: string, meta: Record<string, unknown>) => text.split('. ').map((part) => ({ content: part, metadata: meta })) } as never,
      resolveHandler as never,
      new (class extends BaseEmbedding {
        async embed(texts: string | string[]) {
          return (Array.isArray(texts) ? texts : [texts]).map(() => [0]);
        }
      })(),
      { upsert: async (items: UpsertItem[]) => void upserted.push(items), deleteBySource: async () => undefined } as never,
      64,
      true // includeSectionContext — off by default; this test exists to prove the ON path
    );

    await ingestor.ingest([FILE]);

    const texts = upserted.flat().map((item) => item.text);
    expect(texts).toHaveLength(2);
    expect(texts.every((text) => text.startsWith('1. Overview\n\n'))).toBe(true);
  });

  it('does not prepend a breadcrumb to a chunk with no heading path, even with the flag on', async () => {
    const resolveHandler = vi.fn(() => ({ handleFile: async () => ({ content: 'Unstructured content with no heading at all.' }) }));
    const upserted: UpsertItem[][] = [];

    const ingestor = new RagDataIngestor(
      { chunk: async (text: string, meta: Record<string, unknown>) => [{ content: text, metadata: meta }] } as never,
      resolveHandler as never,
      new (class extends BaseEmbedding {
        async embed(texts: string | string[]) {
          return (Array.isArray(texts) ? texts : [texts]).map(() => [0]);
        }
      })(),
      { upsert: async (items: UpsertItem[]) => void upserted.push(items), deleteBySource: async () => undefined } as never,
      64,
      true
    );

    await ingestor.ingest([FILE]);

    expect(upserted.flat()[0].text).toBe('Unstructured content with no heading at all.');
  });

  it('leaves chunk content unchanged by default (includeSectionContext defaults to false)', async () => {
    const structuredDoc = ['1. Overview', '', 'Top-level prose.'].join('\n');
    const resolveHandler = vi.fn(() => ({ handleFile: async () => ({ content: structuredDoc }) }));
    const upserted: UpsertItem[][] = [];

    const ingestor = new RagDataIngestor(
      { chunk: async (text: string, meta: Record<string, unknown>) => [{ content: text, metadata: meta }] } as never,
      resolveHandler as never,
      new (class extends BaseEmbedding {
        async embed(texts: string | string[]) {
          return (Array.isArray(texts) ? texts : [texts]).map(() => [0]);
        }
      })(),
      { upsert: async (items: UpsertItem[]) => void upserted.push(items), deleteBySource: async () => undefined } as never
      // includeSectionContext omitted — must default to false.
    );

    await ingestor.ingest([FILE]);

    expect(upserted.flat()[0].text).toBe('Top-level prose.');
  });
});

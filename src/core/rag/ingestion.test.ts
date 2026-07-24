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
      { id: 'doc.txt#0', text: 'alpha', metadata: { source: 'doc.txt', mimeType: 'text/plain' }, embedding: [5] },
      { id: 'doc.txt#1', text: 'beta', metadata: { source: 'doc.txt', mimeType: 'text/plain' }, embedding: [4] },
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
});

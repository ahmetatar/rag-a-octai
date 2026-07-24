import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@infrastructure/logging';
// vi.mock is hoisted above this import, so the store is built against the stubbed client.
import { ChromaVectorStore, toSimilarity } from './chroma-vector-store';

/** The collection the mocked ChromaClient hands back; replaced per test. */
let collection: Record<string, unknown>;

vi.mock('chromadb', () => ({
  ChromaClient: class {
    async getOrCreateCollection() {
      return collection;
    }
  },
}));

/**
 * Builds a collection stub that answers `query` with the given distances.
 * @param distances The distance reported for each result, `null` when missing.
 * @param configuration Optional collection configuration to expose.
 */
function collectionReturning(distances: (number | null)[], configuration: unknown = { hnsw: { space: 'cosine' } }) {
  return {
    configuration,
    query: vi.fn(async () => ({
      ids: [distances.map((_, index) => `chunk-${index}`)],
      documents: [distances.map((_, index) => `document ${index}`)],
      metadatas: [distances.map((_, index) => ({ source: 'doc.pdf', page: index + 1 }))],
      distances: [distances],
    })),
    upsert: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
}

/** An upsert payload as passed to the ChromaDB collection. */
type UpsertArgs = { ids: string[]; embeddings: number[][]; documents: string[]; metadatas: unknown[] };

/** Builds a minimal collection stub that records upsert and delete calls. */
function recordingCollection() {
  return {
    configuration: { hnsw: { space: 'cosine' } },
    upsert: vi.fn(async (_args: UpsertArgs) => undefined),
    delete: vi.fn(async (_args: { where: unknown }) => undefined),
    query: vi.fn(),
  };
}

describe('toSimilarity', () => {
  it('turns a cosine distance into a score where higher means closer', () => {
    expect(toSimilarity(0, 'cosine')).toBe(1);
    expect(toSimilarity(0.2, 'cosine')).toBeCloseTo(0.8);
    expect(toSimilarity(1, 'cosine')).toBe(0);
  });

  it('keeps inner-product distances on the same scale as cosine', () => {
    expect(toSimilarity(0.25, 'ip')).toBeCloseTo(0.75);
  });

  it('maps unbounded l2 distances onto (0, 1]', () => {
    expect(toSimilarity(0, 'l2')).toBe(1);
    expect(toSimilarity(9, 'l2')).toBeCloseTo(0.1);
    expect(toSimilarity(1e6, 'l2')).toBeGreaterThan(0);
  });

  it('is monotonically decreasing in distance for every space', () => {
    for (const space of ['cosine', 'ip', 'l2'] as const) {
      expect(toSimilarity(0.1, space)).toBeGreaterThan(toSimilarity(0.9, space));
    }
  });
});

describe('ChromaVectorStore.search', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('scores a close match above a distant one', async () => {
    collection = collectionReturning([0.05, 0.9]);
    const store = new ChromaVectorStore('localhost', 8000, 'docs');

    const [closest, furthest] = await store.search([0.1], 2);

    expect(closest.score).toBeCloseTo(0.95);
    expect(furthest.score).toBeCloseTo(0.1);
    expect(closest.score).toBeGreaterThan(furthest.score);
  });

  it('exposes the raw distance alongside the score', async () => {
    collection = collectionReturning([0.05]);
    const store = new ChromaVectorStore('localhost', 8000, 'docs');

    const [result] = await store.search([0.1], 1);

    expect(result.distance).toBe(0.05);
    expect(result.metadata).toEqual({ source: 'doc.pdf', page: 1 });
  });

  it('skips results without a distance rather than scoring them as perfect matches', async () => {
    collection = collectionReturning([0.05, null]);
    const store = new ChromaVectorStore('localhost', 8000, 'docs');

    const results = await store.search([0.1], 2);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('chunk-0');
  });

  it('warns when the collection uses a different vector space than configured', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    collection = collectionReturning([0.5], { hnsw: { space: 'l2' } });
    const store = new ChromaVectorStore('localhost', 8000, 'docs', 'cosine');

    await store.search([0.1], 1);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('"l2"');
  });

  it('does not warn when the spaces match', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    collection = collectionReturning([0.5]);
    const store = new ChromaVectorStore('localhost', 8000, 'docs', 'cosine');

    await store.search([0.1], 1);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('ChromaVectorStore.upsert', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('splits a large upsert into batches', async () => {
    const recording = recordingCollection();
    collection = recording;
    const store = new ChromaVectorStore('localhost', 8000, 'docs');
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `id-${i}`, text: `t${i}`, embedding: [i] }));

    await store.upsert(items, 2);

    // 5 items at batch size 2 → 3 upsert calls (2, 2, 1).
    expect(recording.upsert).toHaveBeenCalledTimes(3);
    expect(recording.upsert.mock.calls[0][0].ids).toEqual(['id-0', 'id-1']);
    expect(recording.upsert.mock.calls[2][0].ids).toEqual(['id-4']);
  });

  it('does not touch the collection for an empty upsert', async () => {
    const recording = recordingCollection();
    collection = recording;
    const store = new ChromaVectorStore('localhost', 8000, 'docs');

    await store.upsert([]);

    expect(recording.upsert).not.toHaveBeenCalled();
  });
});

describe('ChromaVectorStore.deleteBySource', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes every vector whose source metadata matches', async () => {
    const recording = recordingCollection();
    collection = recording;
    const store = new ChromaVectorStore('localhost', 8000, 'docs');

    await store.deleteBySource('handbook.pdf');

    expect(recording.delete).toHaveBeenCalledWith({ where: { source: 'handbook.pdf' } });
  });
});

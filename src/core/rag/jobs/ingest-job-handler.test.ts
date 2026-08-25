import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIngestJobHandler } from './ingest-job-handler';
import { IngestJobPayload } from './ingest-queue';

const staged: string[] = [];

afterEach(async () => {
  await Promise.allSettled(staged.map((p) => fs.unlink(p).catch(() => undefined)));
  staged.length = 0;
});

/** Writes a temp file and tracks it for cleanup. */
async function stage(name: string, content: string): Promise<string> {
  const filePath = path.join(tmpdir(), `ingest-test-${Math.floor(performance.now())}-${name}`);
  await fs.writeFile(filePath, content);
  staged.push(filePath);
  return filePath;
}

describe('createIngestJobHandler', () => {
  it('reads staged files, ingests them, and returns the summary', async () => {
    const filePath = await stage('doc.txt', 'hello world');
    const ingest = vi.fn(
      async (_files: { originalname: string; buffer: Buffer }[], _params?: unknown, _tenantId?: string) => ({
        chunks: 2,
        sources: 1,
      })
    );
    const handler = createIngestJobHandler(async () => ({ ingest } as never));

    const payload: IngestJobPayload = {
      files: [{ path: filePath, originalname: 'doc.txt', mimetype: 'text/plain', size: 11 }],
      tenantId: 'acme',
    };

    const result = await handler(payload);

    expect(result).toEqual({ chunks: 2, sources: 1 });
    const passedFiles = ingest.mock.calls[0][0];
    expect(passedFiles[0].originalname).toBe('doc.txt');
    expect(passedFiles[0].buffer.toString()).toBe('hello world');
    // ingest receives (files, params, tenantId)
    expect(ingest.mock.calls[0][2]).toBe('acme');
  });

  it('removes staged files after a successful run', async () => {
    const filePath = await stage('doc.txt', 'content');
    const handler = createIngestJobHandler(async () => ({ ingest: async () => ({ chunks: 1, sources: 1 }) } as never));

    await handler({
      files: [{ path: filePath, originalname: 'doc.txt', mimetype: 'text/plain', size: 7 }],
      tenantId: 'acme',
    });

    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it('removes staged files even when ingestion fails', async () => {
    const filePath = await stage('doc.txt', 'content');
    const handler = createIngestJobHandler(
      async () => ({ ingest: async () => { throw new Error('boom'); } } as never)
    );

    await expect(
      handler({
        files: [{ path: filePath, originalname: 'doc.txt', mimetype: 'text/plain', size: 7 }],
        tenantId: 'acme',
      })
    ).rejects.toThrow('boom');

    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it('keeps staged files on failure when a retry is still pending', async () => {
    const filePath = await stage('doc.txt', 'content');
    const handler = createIngestJobHandler(
      async () => ({ ingest: async () => { throw new Error('boom'); } } as never)
    );

    await expect(
      handler(
        {
          files: [{ path: filePath, originalname: 'doc.txt', mimetype: 'text/plain', size: 7 }],
          tenantId: 'acme',
        },
        false
      )
    ).rejects.toThrow('boom');

    await expect(fs.access(filePath)).resolves.toBeUndefined();
  });
});

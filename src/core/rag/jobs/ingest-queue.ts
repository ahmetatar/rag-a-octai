/**
 * A file staged on disk for the ingest worker to process.
 * The buffer is not carried through the queue (it could be large and, with BullMQ, would go
 * to Redis); only the path and metadata travel with the job.
 */
export interface IngestJobFile {
  /** Absolute path to the staged file on disk. */
  path: string;
  /** Original client-supplied file name; becomes the chunk `source`. */
  originalname: string;
  /** MIME type used to resolve the file handler. */
  mimetype: string;
  /** File size in bytes. */
  size: number;
}

/**
 * The payload enqueued for one ingest request.
 */
export interface IngestJobPayload {
  /** Files to ingest, staged on disk. */
  files: IngestJobFile[];
  /** Handler-resolution parameters (from the request query string). */
  params?: Record<string, unknown>;
  /** Tenant the documents belong to. */
  tenantId: string;
}

/**
 * The result of a completed ingest job.
 */
export interface IngestJobResult {
  /** Number of chunks stored. */
  chunks: number;
  /** Number of distinct sources ingested. */
  sources: number;
}

/** Lifecycle states a job can be reported in. */
export type IngestJobState = 'queued' | 'active' | 'completed' | 'failed';

/**
 * A point-in-time view of a job's progress, safe to return to clients.
 */
export interface IngestJobStatus {
  id: string;
  state: IngestJobState;
  /** Present when the job failed. */
  error?: string;
  /** Present when the job completed. */
  result?: IngestJobResult;
}

/**
 * Processes one ingest job. Supplied to the queue at construction, so the queue stays
 * decoupled from the ingestion pipeline.
 */
export type IngestJobHandler = (payload: IngestJobPayload) => Promise<IngestJobResult>;

/**
 * An ingest job queue: accepts work and reports on it, without blocking the request that
 * submitted it. Implemented in-memory (single process) or on BullMQ/Redis (persistent).
 */
export interface IngestQueue {
  /**
   * Enqueues an ingest job.
   * @param payload The job to run.
   * @returns The job id, used to query status later.
   */
  enqueue(payload: IngestJobPayload): Promise<string>;

  /**
   * Returns a job's current status, or null when the id is unknown (or has expired).
   * @param jobId The job id returned by enqueue.
   */
  getStatus(jobId: string): Promise<IngestJobStatus | null>;

  /**
   * Releases resources (workers, connections). Called on shutdown.
   */
  close(): Promise<void>;
}

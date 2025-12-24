/**
 * Interface representing file information.
 */
export interface FileInfo {
  /** The name of the file. */
  originalname: string;
  /** The size of the file in bytes. */
  size: number;
  /** The MIME type of the file. */
  mimetype: string;
  /** The encoding of the file. */
  encoding: string;
  /** The file content as a buffer. */
  buffer: Buffer;
}

/**
 * Interface representing file content and optional metadata.
 */
export interface Document {
  /** The unique identifier for the file content. */
  id?: string;
  /** The content of the file as a string. */
  content: string;
  /** Optional metadata associated with the file. */
  metadata?: Record<string, any>;
}

/**
 * Abstract class representing a MIME type handler.
 */
export abstract class FileHandler {
  /**
   * Abstract method to read a file and return its content as a string.
   * @param fileInfo Information about the file to be read.
   * @returns A promise that resolves to the file content and optional metadata.
   */
  abstract handleFile(fileInfo: FileInfo): Promise<Document | Document[]>;
}

/**
 * A no-operation file handler that returns an empty string.
 */
export class NoopFileHandler extends FileHandler {
  /**
   * Reads a file and returns an empty string.
   * @param fileInfo Information about the file to be read.
   * @returns A promise that resolves to an empty string.
   */
  async handleFile(fileInfo: FileInfo): Promise<Document> {
    console.log(`NoopFileHandler invoked for file: ${fileInfo.originalname}`);
    return { content: '' };
  }
}

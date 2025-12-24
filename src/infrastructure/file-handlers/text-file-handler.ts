import { Document, FileHandler, FileInfo } from './file-handler';
import { Readable } from 'stream';
import { DefaultTextProcessor, TextProcessor } from '@infrastructure/text-processors';

/**
 * Factory function to create a TextFileHandler instance
 * @returns {TextFileHandler} A new instance of TextFileHandler
 */
export function createTextFileHandler(): TextFileHandler {
  return new TextFileHandler(new DefaultTextProcessor());
}

/**
 * A file handler for text files that reads the content and returns it as a string.
 * @extends FileHandler
 * @example
 * const textHandler = new TextFileHandler(new DefaultTextProcessor());
 * const document = await textHandler.handleFile(fileInfo);
 */
export class TextFileHandler extends FileHandler {
  constructor(private readonly textProcessor: TextProcessor) {
    super();
  }

  /** @inheritdoc */
  handleFile(fileInfo: FileInfo): Promise<Document> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream: Readable = Readable.from(fileInfo.buffer);

      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      stream.on('end', async () => {
        const fileContent = Buffer.concat(chunks).toString('utf-8');
        const processedContent = await this.textProcessor.processText(fileContent);
        resolve({ content: processedContent, metadata: { mimeType: 'text' } });
      });

      stream.on('error', (error) => {
        reject(error);
      });
    });
  }
}

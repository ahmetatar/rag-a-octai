import { PDFParse } from 'pdf-parse';
import { Document, FileHandler, FileInfo } from './file-handler';
import { DefaultTextProcessor, TextProcessor } from '@infrastructure/text-processors';

/**
 * Factory function to create a PdfFileHandler instance.
 * @returns {PdfFileHandler} A new instance of PdfFileHandler.
 */
export function createPdfFileHandler(): PdfFileHandler {
  return new PdfFileHandler(new DefaultTextProcessor());
}

/**
 * A file handler for PDF files that extracts text content and metadata.
 * @extends FileHandler
 * @example
 * const pdfHandler = new PdfFileHandler(new DefaultTextProcessor());
 * const document = await pdfHandler.handleFile(fileInfo);
 */
export class PdfFileHandler extends FileHandler {
  constructor(private readonly textProcessor: TextProcessor) {
    super();
  }

  /** @inheritdoc */
  async handleFile({ buffer }: FileInfo): Promise<Document> {
    let pdfParser: PDFParse | null = new PDFParse({ data: buffer });

    const pdfInfo = await pdfParser.getInfo();
    const rawText = await pdfParser.getText();
    const finalText = await this.textProcessor.processText(rawText.text);

    pdfParser.destroy();
    pdfParser = null;

    return { content: finalText, metadata: { totalPages: pdfInfo.total } };
  }
}

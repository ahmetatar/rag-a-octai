import { PDFParse } from 'pdf-parse';
import { Document, FileHandler, FileInfo } from './file-handler';
import { DefaultTextProcessor, TextProcessor } from '@infrastructure/text-processors';

/**
 * Factory function to create a PdfPageFileHandler instance.
 * @returns {PdfPageFileHandler} A new instance of PdfPageFileHandler.
 */
export function createPdfPageFileHandler(): PdfPageFileHandler {
  return new PdfPageFileHandler(new DefaultTextProcessor());
}

/**
 * Handler for PDF page files that extracts text content and metadata.
 * @extends FileHandler
 * @example
 * const pdfHandler = new PdfPageFileHandler(new DefaultTextProcessor());
 * const document = await pdfHandler.handleFile(fileInfo);
 */
export class PdfPageFileHandler extends FileHandler {
  constructor(private readonly textProcessor: TextProcessor) {
    super();
  }

  /** @inheritdoc */
  async handleFile({ buffer }: FileInfo): Promise<Document[]> {
    let pdfParser: PDFParse | null = new PDFParse({ data: buffer });

    const docs: Document[] = [];
    const pdfInfo = await pdfParser.getInfo();

    for (let i = 0; i < pdfInfo.total; i++) {
      const rawText = await pdfParser.getText({ partial: [i + 1] });
      const finalText = await this.textProcessor.processText(rawText.text);
      docs.push({ content: finalText, metadata: { page: i + 1, totalPages: pdfInfo.total } });
    }

    pdfParser.destroy();
    pdfParser = null;

    return docs;
  }
}

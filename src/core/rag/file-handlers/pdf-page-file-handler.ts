import { PDFParse } from 'pdf-parse';
import { Document, FileHandler, FileInfo } from './file-handler';
import { DefaultTextProcessor, TextProcessor } from '../text-processors';

/**
 * Factory function to create a PdfPageFileHandler instance.
 * @returns {PdfPageFileHandler} A new instance of PdfPageFileHandler.
 */
export function createPdfPageFileHandler(): PdfPageFileHandler {
  return new PdfPageFileHandler(new DefaultTextProcessor());
}

/**
 * The PDF handler: extracts one {@link Document} PER PAGE, each tagged with its `page` number.
 *
 * This is the only PDF handler in the codebase — a whole-document PDF handler (extract all
 * pages as one text blob) existed early on but was never wired into `registerFileHandlers`
 * anywhere; it was removed as dead code once the per-page approach became the only one
 * actually used, in production (`app.ts`) and in the eval harness (`eval.ts`) alike. Per-page
 * is the deliberate choice, not a leftover: it gives a citation an exact page number instead
 * of "somewhere in this PDF," and it bounds a single `getText()` call's cost on a large file.
 *
 * Interaction worth knowing: `RagDataIngestor` runs {@link splitIntoSections} independently on
 * EACH page's `Document.content`, because that is the unit a handler returns. A heading whose
 * body text continues onto the next page is therefore split into two sections with the same
 * heading path, not detected as one continuous section spanning the page break — the same
 * trade-off `CHUNK_SIZE` already makes at any arbitrary boundary, just aligned to pages instead
 * of characters. This does not lose text (page N's tail still gets a section and gets chunked;
 * see `splitIntoSections`'s empty-body guard), it only means the heading path doesn't carry the
 * "this body continues from the previous page" fact.
 *
 * @extends FileHandler
 * @example
 * const pdfHandler = new PdfPageFileHandler(new DefaultTextProcessor());
 * const pages = await pdfHandler.handleFile(fileInfo); // one Document per page
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

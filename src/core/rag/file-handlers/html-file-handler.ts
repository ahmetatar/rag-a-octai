import { parse } from 'node-html-parser';
import { Document, FileHandler, FileInfo } from './file-handler';
import { DefaultTextProcessor, TextProcessor } from '../text-processors';

/** Elements whose content is code/markup, not readable prose, and must not be indexed. */
const NON_CONTENT_SELECTOR = 'script,style,noscript';

/**
 * Factory function to create an HtmlFileHandler instance.
 * @returns {HtmlFileHandler} A new instance of HtmlFileHandler.
 */
export function createHtmlFileHandler(): HtmlFileHandler {
  return new HtmlFileHandler(new DefaultTextProcessor());
}

/**
 * A file handler for HTML documents. Strips markup down to readable text so the index holds
 * prose, not tags or scripts.
 * @extends FileHandler
 * @example
 * const htmlHandler = new HtmlFileHandler(new DefaultTextProcessor());
 * const document = await htmlHandler.handleFile(fileInfo);
 */
export class HtmlFileHandler extends FileHandler {
  constructor(private readonly textProcessor: TextProcessor) {
    super();
  }

  /** @inheritdoc */
  async handleFile({ buffer }: FileInfo): Promise<Document> {
    const root = parse(buffer.toString('utf-8'));

    // Drop non-prose elements before extracting text, so scripts/styles never reach the index.
    root.querySelectorAll(NON_CONTENT_SELECTOR).forEach((element) => element.remove());

    // structuredText (not textContent) keeps block boundaries as newlines, so adjacent
    // headings/paragraphs don't run into one word. HTML entities are already decoded.
    const processedContent = await this.textProcessor.processText(root.structuredText);

    return { content: processedContent, metadata: { mimeType: 'html' } };
  }
}

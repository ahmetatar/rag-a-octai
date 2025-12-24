import { TextProcessor } from './text-processor';

/**
 * DefaultTextProcessor provides a basic implementation of text|markdown processing.
 * @extends TextProcessor
 * @example
 * const textProcessor = new DefaultTextProcessor();
 * const processedText = textProcessor.processText(rawText);
 */
export class DefaultTextProcessor extends TextProcessor {
  /**
   * Processes the input text based on the provided options.
   * @param text Input text to be processed
   * @returns Processed text as a Promise<string>
   */
  processText(raw: string): string {
    if (!raw) return '';

    let text = raw;

    text = this.removePageNumbers(text);
    text = this.cleanTocLeaders(text);
    text = this.cleanNumberedToc(text);
    text = this.removeLeaderDotLinesSafe(text);
    text = this.removeHeadersFooters(text);
    text = this.fixLineBreaks(text);
    text = this.normalizeParagraphs(text);
    text = this.removeDuplicateLines(text);
    text = this.removeDuplicateParagraphs(text);
    text = this.preserveSectionSpacing(text);

    return text.trim();
  }

  private removePageNumbers(text: string): string {
    return (
      text
        // Page 12 / Page 12 of 34
        .replace(/^\s*Page\s+\d+(\s+of\s+\d+)?\s*$/gim, '')
        // 12 / 12 of 34
        .replace(/^\s*\d+(\s+of\s+\d+)?\s*$/gm, '')
        // -- 65 of 79 --
        .replace(/^\s*[-–—]{1,}\s*\d+\s+of\s+\d+\s*[-–—]{1,}\s*$/gm, '')
        // - 12 - / -- 12 --
        .replace(/^\s*[-–—]{1,}\s*\d+\s*[-–—]{1,}\s*$/gm, '')
    );
  }

  /**
   * Removes common headers and footers from the text.
   * @param text Input text
   * @returns Text without headers and footers
   */
  private removeHeadersFooters(text: string): string {
    const HEADER_REGEX = /^(Company Name|Document Title|Confidential).*$/gim;
    return text.replace(HEADER_REGEX, '');
  }

  /**
   * Fixes line breaks that occur within sentences.
   * @param text Input text
   * @returns Text with fixed line breaks
   */
  private fixLineBreaks(text: string): string {
    return text.replace(/(?<![.!?:])\n(?!\n)/g, ' ');
  }

  /**
   * Normalizes multiple consecutive newlines into double newlines.
   * @param text Input text
   * @returns Text with normalized paragraphs
   */
  private normalizeParagraphs(text: string): string {
    return text.replace(/\n{3,}/g, '\n\n');
  }

  /**
   * Removes duplicate paragraphs from the text.
   * @param text Input text
   * @returns Text without duplicate paragraphs
   */
  private removeDuplicateParagraphs(text: string): string {
    return text.replace(/(.*)(\n\1)+/g, '$1');
  }

  /**
   * Removes duplicate lines from the text.
   * @param text Input text
   * @returns Text without duplicate lines
   */
  private removeDuplicateLines(text: string): string {
    return text.replace(/^(.+)(\n\1)+$/gm, '$1');
  }

  /**
   * Preserves spacing before section headings.
   * @param text Input text
   * @returns Text with preserved section spacing
   */
  private preserveSectionSpacing(text: string): string {
    return text.replace(/\n(?=[A-Z][A-Za-z\s]{3,}\n)/g, '\n\n');
  }

  /**
   * Cleans table of contents leaders from the text.
   * @param text Input text
   * @returns Text without TOC leaders
   */
  private cleanTocLeaders(text: string): string {
    return text.replace(/\s(?:\.{3,}|·{2,}|[-–—]{2,})\s*\d+\s*$/gm, '');
  }

  /**
   * Cleans numbered table of contents entries from the text.
   * @param text Input text
   * @returns Text without numbered TOC entries
   */
  private cleanNumberedToc(text: string): string {
    return text.replace(/^(\d+(\.\d+)*\s+.+?)(\s\.{3,}\s*\d+)\s*$/gm, '$1');
  }

  /**
   * Removes lines with leader dots safely from the text.
   * @param text Input text
   * @returns Text without leader dot lines
   */
  private removeLeaderDotLinesSafe(text: string): string {
    return text.replace(/^.{20,}(\.{3,}.{0,}){2,}$/gm, '');
  }
}

import { TextProcessor } from './text-processor';

/**
 * Options controlling the DefaultTextProcessor's cleanup behaviour.
 */
export interface DefaultTextProcessorOptions {
  /**
   * Lines beginning with any of these strings are treated as running headers/footers and
   * removed. Defaults to none: header text is document-specific, and guessing at it
   * deletes real content. A caller that knows a document's boilerplate can pass it here.
   */
  headerPrefixes?: string[];
}

/**
 * DefaultTextProcessor cleans up text extracted from documents (mainly PDFs) before it is
 * chunked and embedded.
 *
 * Every transform here is deliberately conservative: this runs on real document content,
 * so a rule that is even slightly too broad silently deletes text a user later expects to
 * query. In particular it never deletes a line just because it is all digits (that would
 * erase prices, quantities and list items) and never guesses at header/footer text.
 *
 * @extends TextProcessor
 * @example
 * const textProcessor = new DefaultTextProcessor();
 * const processedText = textProcessor.processText(rawText);
 */
export class DefaultTextProcessor extends TextProcessor {
  private readonly headerPrefixes: string[];

  constructor(options: DefaultTextProcessorOptions = {}) {
    super();
    this.headerPrefixes = options.headerPrefixes ?? [];
  }

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
    text = this.removeLeaderDotLines(text);
    text = this.removeHeaderLines(text);
    text = this.fixLineBreaks(text);
    text = this.normalizeParagraphs(text);
    text = this.removeConsecutiveDuplicateLines(text);
    text = this.preserveSectionSpacing(text);

    return text.trim();
  }

  /**
   * Removes lines that are unambiguously page-number markers.
   *
   * A bare number on its own line is intentionally NOT removed: it is just as likely to be
   * a price, a quantity or a list item as a page number. Only forms that explicitly read
   * as pagination ("Page 5", "5 of 79", "- 5 -") are stripped.
   *
   * @param text Input text
   * @returns Text without page-number markers
   */
  private removePageNumbers(text: string): string {
    return (
      text
        // Page 12 / Page 12 of 34
        .replace(/^\s*Page\s+\d+(\s+of\s+\d+)?\s*$/gim, '')
        // 12 of 34 (the "of" makes this unambiguous, unlike a bare number)
        .replace(/^\s*\d+\s+of\s+\d+\s*$/gim, '')
        // -- 65 of 79 --
        .replace(/^\s*[-–—]{1,}\s*\d+\s+of\s+\d+\s*[-–—]{1,}\s*$/gm, '')
        // - 12 - / -- 12 -- (dashes on both sides mark it as a page number, not data)
        .replace(/^\s*[-–—]{1,}\s*\d+\s*[-–—]{1,}\s*$/gm, '')
    );
  }

  /**
   * Removes lines that start with one of the configured header/footer prefixes.
   * Does nothing unless the caller supplied prefixes, so real content is never guessed at.
   * @param text Input text
   * @returns Text without configured header/footer lines
   */
  private removeHeaderLines(text: string): string {
    if (this.headerPrefixes.length === 0) {
      return text;
    }

    return text
      .split('\n')
      .filter((line) => !this.headerPrefixes.some((prefix) => line.trimStart().startsWith(prefix)))
      .join('\n');
  }

  /**
   * Fixes line breaks that occur within sentences — the PDF-extraction artifact of a hard
   * line wrap mid-paragraph, which reads as a single stray `\n` between two lines of the same
   * paragraph.
   *
   * A genuine paragraph break (`\n\n`) must survive untouched, not just its own two
   * newlines: without the `\n` entry in the lookbehind, the SECOND newline of every `\n\n`
   * pair is itself "a `\n` not preceded by [.!?:]" and gets joined into a space, silently
   * collapsing every blank line in the document down to a single newline. That is invisible
   * to a mid-paragraph reader, but it destroys the one signal a downstream heading/section
   * detector (`splitIntoSections`) has for "this line stands alone as its own paragraph".
   *
   * @param text Input text
   * @returns Text with fixed line breaks
   */
  private fixLineBreaks(text: string): string {
    return text.replace(/(?<![.!?:\n])\n(?!\n)/g, ' ');
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
   * Collapses runs of identical consecutive lines into a single line.
   *
   * Implemented as a linear line scan rather than a back-reference regex
   * (`/(.*)(\n\1)+/`), which can backtrack pathologically on adversarial input.
   *
   * @param text Input text
   * @returns Text without consecutive duplicate lines
   */
  private removeConsecutiveDuplicateLines(text: string): string {
    const lines = text.split('\n');
    const deduped: string[] = [];

    for (const line of lines) {
      // Only collapse repeated NON-empty lines; blank lines carry paragraph structure.
      if (line !== '' && line === deduped[deduped.length - 1]) {
        continue;
      }
      deduped.push(line);
    }

    return deduped.join('\n');
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
   * Removes table-of-contents-style leader-dot lines (e.g. "Chapter One .... 12").
   *
   * The previous pattern nested `.{0,}` inside a repeated group (`(\.{3,}.{0,}){2,}`),
   * a classic backtracking hazard. This version matches a single run of 3+ dots followed
   * by a trailing page number — what a TOC leader actually looks like — in linear time.
   *
   * @param text Input text
   * @returns Text without leader-dot lines
   */
  private removeLeaderDotLines(text: string): string {
    return text.replace(/^.{20,}?\s\.{3,}\s*\d+\s*$/gm, '');
  }
}

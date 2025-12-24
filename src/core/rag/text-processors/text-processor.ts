/**
 * Interface and abstract class for text processing.
 */
export interface ProcessOptions {
  /** Whether to remove page numbers from the text. */
  removePageNumbers?: boolean;
  /** Whether to join broken lines in the text. */
  joinBrokenLines?: boolean;
  /** Whether to normalize whitespace in the text. */
  normalizeWhitespace?: boolean;
  /** Minimum length of lines to be considered in processing. */
  minLineLength?: number;
}

/**
 * Abstract class representing a text processor.
 */
export abstract class TextProcessor {
  /**
   * Abstract method to process text and return the processed result.
   * @param text The input text to be processed.
   * @returns A promise that resolves to the processed text.
   */
  abstract processText(text: string, options?: ProcessOptions): string | Promise<string>;
}

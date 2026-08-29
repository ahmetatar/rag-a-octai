/** A heading found in a document, with its nesting depth and line position. */
interface HeadingLine {
  lineIndex: number;
  depth: number;
  title: string;
}

/**
 * One section of a document: the heading path that leads to it, and its own body text (not
 * including any sub-section's heading or body).
 */
export interface Section {
  /**
   * Hierarchical heading path leading to this section, outermost first — e.g.
   * `["2. Components", "2.1 Kestrel collector"]`. Empty for text that precedes the document's
   * first heading (front matter, or a document with no detected structure at all).
   */
  path: string[];
  /**
   * This section's own body text: everything between its heading and the next heading at the
   * same or a shallower depth. May be empty for a pure outline node — a heading whose only
   * content is its sub-headings (e.g. "2. Components" immediately followed by "2.1 …").
   */
  body: string;
}

/** A heading line may not run longer than this — a long line is prose, not a title. */
const MAX_HEADING_LENGTH = 100;

/** An outline-numbered heading: "2", "2.1", "2.1.3 Title", with or without a trailing dot. */
const NUMBERED_HEADING = /^(\d+(?:\.\d+)*)\.?\s+(\S.*)$/;

/**
 * Splits `text` into sections along its own heading structure, so each section's body can be
 * chunked separately and tagged with the heading path that precedes it.
 *
 * Headings are detected structurally, not by markup: a line counts as a heading when it
 * stands ALONE as its own paragraph — a blank line (or the start/end of the document) on both
 * sides — and does not end in sentence punctuation. A body paragraph, even a one-line one,
 * ends in a period, a comma, a semicolon or a colon; a heading does not. This is deliberately
 * conservative in the same spirit as {@link DefaultTextProcessor}: it never merges two
 * sections it isn't sure are separate, and it works uniformly across the plain text every
 * file handler already produces — Markdown, HTML and PDF text are all flattened to plain
 * text before this runs, so there is no per-format markup rule to maintain.
 *
 * Nesting depth comes from an outline numbering prefix when the document uses one — "2.1 Foo"
 * is one level deeper than "2 Bar". A heading with no numbering is always depth 1: a flat
 * document (e.g. an ADR's "Context" / "Decision" / "Consequences") has no sub-heading
 * information to nest by, so treating its headings as siblings is the correct read, not a
 * limitation of the detector.
 *
 * @param text The document's plain text.
 * @returns The sections, in document order. Never empty: a document with no detected headings
 * comes back as a single section with an empty `path`.
 */
export function splitIntoSections(text: string): Section[] {
  const lines = text.split('\n');
  const headings: HeadingLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const heading = parseHeadingLine(lines, i);
    if (heading) {
      headings.push(heading);
    }
  }

  if (headings.length === 0) {
    return [{ path: [], body: text.trim() }];
  }

  const sections: Section[] = [];

  const preamble = lines.slice(0, headings[0].lineIndex).join('\n').trim();
  if (preamble) {
    sections.push({ path: [], body: preamble });
  }

  const stack: HeadingLine[] = [];
  for (let h = 0; h < headings.length; h++) {
    const heading = headings[h];
    while (stack.length > 0 && stack[stack.length - 1].depth >= heading.depth) {
      stack.pop();
    }
    stack.push(heading);

    const bodyStart = heading.lineIndex + 1;
    const bodyEnd = h + 1 < headings.length ? headings[h + 1].lineIndex : lines.length;
    const body = lines.slice(bodyStart, bodyEnd).join('\n').trim();

    sections.push({ path: stack.map((entry) => entry.title), body });
  }

  return sections;
}

/**
 * Checks whether `lines[index]` reads as a standalone heading and, if so, parses it.
 * @param lines The document, split into lines.
 * @param index The line to check.
 * @returns The parsed heading, or `undefined` when the line is not a heading.
 */
function parseHeadingLine(lines: string[], index: number): HeadingLine | undefined {
  const line = lines[index].trim();
  if (!line || line.length > MAX_HEADING_LENGTH || /[.,;:]$/.test(line)) {
    return undefined;
  }

  const isolatedBefore = index === 0 || lines[index - 1].trim() === '';
  // A heading must have a line AFTER it (blank or otherwise) — a line with nothing following
  // it at all is the document's entire content, not a heading over an empty section. Without
  // this, a one-line document (or a one-line trailing fragment) is misread as a heading with
  // no body, and its content is silently dropped rather than chunked.
  const isolatedAfter = index < lines.length - 1 && lines[index + 1].trim() === '';
  if (!isolatedBefore || !isolatedAfter) {
    return undefined;
  }

  const numbered = line.match(NUMBERED_HEADING);
  const depth = numbered ? numbered[1].split('.').length : 1;

  return { lineIndex: index, depth, title: line };
}

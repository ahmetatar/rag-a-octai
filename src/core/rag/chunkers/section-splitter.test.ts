import { describe, expect, it } from 'vitest';
import { splitIntoSections } from './section-splitter';

describe('splitIntoSections', () => {
  it('returns a single unstructured section when no heading is detected', () => {
    const text = 'Just one paragraph of prose that never stands alone as its own line.';

    const sections = splitIntoSections(text);

    expect(sections).toEqual([{ path: [], body: text }]);
  });

  it('splits on standalone, unpunctuated, isolated lines', () => {
    const text = ['Context', '', 'Some prose that explains the context.', '', 'Decision', '', 'Some prose that explains the decision.'].join(
      '\n'
    );

    const sections = splitIntoSections(text);

    expect(sections).toEqual([
      { path: ['Context'], body: 'Some prose that explains the context.' },
      { path: ['Decision'], body: 'Some prose that explains the decision.' },
    ]);
  });

  it('does not treat a one-line paragraph ending in punctuation as a heading', () => {
    const text = ['Heading', '', 'A short paragraph that ends with a period.', '', 'Another heading', '', 'More prose.'].join('\n');

    const sections = splitIntoSections(text);

    expect(sections.map((section) => section.path)).toEqual([['Heading'], ['Another heading']]);
  });

  it('does not treat a non-isolated short line (a list item) as a heading', () => {
    const text = ['Heading', '', 'Sev-1: urgent', 'Sev-2: less urgent', 'Sev-3: routine.', '', 'Body prose after the list.'].join('\n');

    const sections = splitIntoSections(text);

    expect(sections).toEqual([
      { path: ['Heading'], body: 'Sev-1: urgent\nSev-2: less urgent\nSev-3: routine.\n\nBody prose after the list.' },
    ]);
  });

  it('nests outline-numbered headings by their numbering depth', () => {
    const text = [
      '1. Overview',
      '',
      'Top-level prose.',
      '',
      '2. Components',
      '',
      '2.1 Kestrel collector',
      '',
      'Kestrel prose.',
      '',
      '2.2 Halyard storage engine',
      '',
      'Halyard prose.',
      '',
      '3. Limits',
      '',
      'Limits prose.',
    ].join('\n');

    const sections = splitIntoSections(text);

    expect(sections).toEqual([
      { path: ['1. Overview'], body: 'Top-level prose.' },
      { path: ['2. Components'], body: '' },
      { path: ['2. Components', '2.1 Kestrel collector'], body: 'Kestrel prose.' },
      { path: ['2. Components', '2.2 Halyard storage engine'], body: 'Halyard prose.' },
      { path: ['3. Limits'], body: 'Limits prose.' },
    ]);
  });

  it('treats headings with no outline numbering as flat siblings, never nested', () => {
    const text = ['Context', '', 'Context prose.', '', 'Decision', '', 'Decision prose.', '', 'Consequences', '', 'Consequences prose.'].join(
      '\n'
    );

    const sections = splitIntoSections(text);

    expect(sections.every((section) => section.path.length === 1)).toBe(true);
  });

  it('keeps front matter before the first heading as a path-less preamble section', () => {
    const text = ['Doc Title', 'Doc Subtitle', '', '1. Overview', '', 'Overview prose.'].join('\n');

    const sections = splitIntoSections(text);

    expect(sections[0]).toEqual({ path: [], body: 'Doc Title\nDoc Subtitle' });
    expect(sections[1]).toEqual({ path: ['1. Overview'], body: 'Overview prose.' });
  });

  it('produces no preamble section when the document has no front matter', () => {
    const text = ['The Solar System', '', 'The Sun is a star.'].join('\n');

    const sections = splitIntoSections(text);

    expect(sections).toEqual([{ path: ['The Solar System'], body: 'The Sun is a star.' }]);
  });

  it('does not swallow a single-line, unpunctuated document as an empty-bodied heading', () => {
    // A line with nothing after it at all is the document's entire content, not a heading
    // over an empty section — misreading it that way would silently drop the content.
    const sections = splitIntoSections('hello world');

    expect(sections).toEqual([{ path: [], body: 'hello world' }]);
  });
});

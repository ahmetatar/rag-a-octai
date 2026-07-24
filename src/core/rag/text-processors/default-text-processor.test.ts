import { describe, expect, it } from 'vitest';
import { DefaultTextProcessor } from './default-text-processor';

const processor = new DefaultTextProcessor();

describe('DefaultTextProcessor — data preservation', () => {
  it('keeps standalone numbers such as prices and quantities', () => {
    const out = processor.processText('Prices:\n1499\n2999\n5750\nThose are the totals.');

    expect(out).toContain('1499');
    expect(out).toContain('2999');
    expect(out).toContain('5750');
  });

  it('keeps numbered list items', () => {
    const out = processor.processText('Steps:\n1\n2\n3\nDone.');

    expect(out).toContain('1');
    expect(out).toContain('2');
    expect(out).toContain('3');
  });

  it('does not delete content just because it starts with a boilerplate-sounding word', () => {
    const out = processor.processText('Confidential information must be encrypted at rest.\nNext line.');

    expect(out).toContain('Confidential information must be encrypted at rest.');
  });

  it('returns empty string for empty input', () => {
    expect(processor.processText('')).toBe('');
  });
});

describe('DefaultTextProcessor — boilerplate removal', () => {
  it('removes explicit page-number markers', () => {
    expect(processor.processText('Page 5\nReal content.')).not.toContain('Page 5');
    expect(processor.processText('12 of 34\nReal content.').trim()).toBe('Real content.');
    expect(processor.processText('- 7 -\nReal content.').trim()).toBe('Real content.');
  });

  it('strips TOC leader dots with a trailing page number', () => {
    const out = processor.processText('Introduction to the subject matter ....... 12\nBody text.');

    expect(out).not.toMatch(/\.{3,}/);
    expect(out).not.toContain('12');
  });

  it('collapses runs of identical consecutive lines that survive line-break joining', () => {
    // Lines ending in punctuation are not merged by fixLineBreaks, so a true repeated
    // line reaches the dedup pass.
    const out = processor.processText('Repeated footer.\nRepeated footer.\nRepeated footer.\nUnique body line.');

    expect(out.match(/Repeated footer\./g)).toHaveLength(1);
    expect(out).toContain('Unique body line.');
  });

  it('removes only configured header prefixes when provided', () => {
    const withHeaders = new DefaultTextProcessor({ headerPrefixes: ['ACME Corp'] });

    const out = withHeaders.processText('ACME Corp — Internal\nActual paragraph content.');

    expect(out).not.toContain('ACME Corp');
    expect(out).toContain('Actual paragraph content.');
  });
});

describe('DefaultTextProcessor — resistant to adversarial input', () => {
  // The rewritten dedup and leader-dot methods are linear; these inputs would blow up a
  // catastrophically-backtracking implementation. Guard against a regression by capping
  // the time budget.
  it('processes many near-duplicate long lines quickly', () => {
    const input = Array.from({ length: 5000 }, (_, i) => 'x'.repeat(200) + i).join('\n');

    const start = Date.now();
    processor.processText(input);

    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('processes long dotted lines quickly', () => {
    const input = Array.from({ length: 2000 }, () => 'y'.repeat(30) + '.'.repeat(50) + 'z'.repeat(50)).join('\n');

    const start = Date.now();
    processor.processText(input);

    expect(Date.now() - start).toBeLessThan(1000);
  });
});

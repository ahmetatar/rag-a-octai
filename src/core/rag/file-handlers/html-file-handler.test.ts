import { describe, expect, it } from 'vitest';
import { createHtmlFileHandler } from './html-file-handler';
import { FileInfo } from './file-handler';

/** Wraps an HTML string as the minimal FileInfo the handler reads (buffer only). */
function htmlFile(html: string): FileInfo {
  return {
    originalname: 'page.html',
    size: html.length,
    mimetype: 'text/html',
    encoding: 'utf-8',
    buffer: Buffer.from(html, 'utf-8'),
  };
}

describe('HtmlFileHandler', () => {
  it('extracts readable text and decodes HTML entities', async () => {
    const handler = createHtmlFileHandler();

    const document = await handler.handleFile(htmlFile('<p>Tom &amp; Jerry cost &lt;5</p>'));

    const content = Array.isArray(document) ? document[0].content : document.content;
    expect(content).toContain('Tom & Jerry cost <5');
  });

  it('drops script, style and noscript content so it is never indexed', async () => {
    const handler = createHtmlFileHandler();

    const document = await handler.handleFile(
      htmlFile('<style>.a{color:red}</style><p>Real text</p><script>steal()</script><noscript>no js</noscript>')
    );

    const content = Array.isArray(document) ? document[0].content : document.content;
    expect(content).toContain('Real text');
    expect(content).not.toContain('steal');
    expect(content).not.toContain('color:red');
    expect(content).not.toContain('no js');
  });

  it('keeps block elements from running together into one word', async () => {
    const handler = createHtmlFileHandler();

    const document = await handler.handleFile(htmlFile('<h1>Title</h1><p>Body</p>'));

    const content = Array.isArray(document) ? document[0].content : document.content;
    // 'TitleBody' would mean the block boundary was lost.
    expect(content).not.toContain('TitleBody');
    expect(content).toContain('Title');
    expect(content).toContain('Body');
  });

  it('tags the document with an html mime type', async () => {
    const handler = createHtmlFileHandler();

    const document = await handler.handleFile(htmlFile('<p>hi</p>'));

    const metadata = Array.isArray(document) ? document[0].metadata : document.metadata;
    expect(metadata).toMatchObject({ mimeType: 'html' });
  });
});

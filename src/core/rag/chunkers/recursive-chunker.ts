import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Chunker, ChunkingOptions } from './chunker';
import { Document } from '../file-handlers';

/**
 * A chunker that uses recursive character splitting to divide text into chunks.
 * @category Infrastructure/Chunkers
 * @extends Chunker
 * @example
 * ```typescript
 * import { RecursiveChunker } from 'your-module-path';
 * 
 * const chunker = new RecursiveChunker({ chunkSize: 1000, overlap: 200 });
 * const chunks = await chunker.chunk(yourText);
 * ```
 */
export class RecursiveChunker extends Chunker {
  private readonly options: ChunkingOptions;

  constructor(options: ChunkingOptions) {
    super();
    
    this.assertChunkSizeGreaterThanOverlap(options);
    this.options = {
      chunkSize: options?.chunkSize,
      overlap: options?.overlap,
      unit: options?.unit ?? 'tokens',
    };
  }

  /** @inheritdoc */
  async chunk(text: string, metadata?: Record<string, any>): Promise<Document[]> {
    const sections = splitSections(text, metadata?.sectionPath);
    const chunks: Array<{ content: string; sectionPath?: string }> = [];
    for (const section of sections) {
      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: this.options.chunkSize,
        chunkOverlap: this.options.overlap ?? 0,
        lengthFunction: this.options.unit === 'tokens' ? approximateTokenCount : (value) => value.length,
      });
      const prefix = section.sectionPath ? `Section: ${section.sectionPath}\n\n` : '';
      for (const piece of await textSplitter.splitText(section.content)) {
        chunks.push({ content: `${prefix}${piece}`, sectionPath: section.sectionPath });
      }
    }

    return chunks.map((chunk, index) =>
      this.createChunk(chunk.content, {
        ...metadata,
        ...(chunk.sectionPath ? { sectionPath: chunk.sectionPath } : {}),
        chunkUnit: this.options.unit,
        chunk: index,
        totalChunks: chunks.length,
      })
    );
  }
}

/** A deterministic approximation that keeps chunk sizes aligned with model input budgets. */
function approximateTokenCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function splitSections(text: string, inheritedPath?: string): Array<{ content: string; sectionPath?: string }> {
  const lines = text.split('\n');
  const sections: Array<{ content: string; sectionPath?: string }> = [];
  const path: string[] = inheritedPath ? inheritedPath.split(' > ') : [];
  let current: string[] = [];

  const flush = () => {
    const content = current.join('\n').trim();
    if (content) sections.push({ content, sectionPath: path.join(' > ') || undefined });
    current = [];
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) { current.push(line); continue; }
    flush();
    const depth = match[1].length;
    path.splice(depth - 1);
    path[depth - 1] = match[2];
  }
  flush();
  return sections;
}

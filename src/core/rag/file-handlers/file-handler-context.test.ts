import { afterEach, describe, expect, it } from 'vitest';
import { FileHandler, FileInfo, Document } from './file-handler';
import {
  getRegisteredMimeTypes,
  isMimeTypeSupported,
  registerFileHandlers,
  resolveFileHandler,
} from './file-handler-context';

class StubHandler extends FileHandler {
  constructor(private readonly label: string) {
    super();
  }

  async handleFile(_fileInfo: FileInfo): Promise<Document> {
    return { content: this.label };
  }
}

// The registry is module-level global state; keep whatever the app registered untouched.
const originalTypes = getRegisteredMimeTypes();

afterEach(() => {
  for (const type of getRegisteredMimeTypes()) {
    if (!originalTypes.includes(type)) {
      // Registered handlers cannot be removed through the public API, so overwrite the
      // test-only types with a no-op to avoid leaking into other tests.
      registerFileHandlers({ [type]: new StubHandler('cleanup') });
    }
  }
});

describe('resolveFileHandler', () => {
  it('returns the handler registered for a MIME type', () => {
    const handler = new StubHandler('direct');
    registerFileHandlers({ 'application/x-direct': handler });

    expect(resolveFileHandler('application/x-direct')).toBe(handler);
  });

  it('invokes the factory with the given params for factory-registered handlers', () => {
    const seen: unknown[] = [];
    registerFileHandlers({
      'application/x-factory': (params) => {
        seen.push(params);
        return new StubHandler('from-factory');
      },
    });

    resolveFileHandler('application/x-factory', { pageMode: 'single' });

    expect(seen).toEqual([{ pageMode: 'single' }]);
  });

  it('returns a fresh instance per call for factory-registered handlers', () => {
    registerFileHandlers({ 'application/x-fresh': () => new StubHandler('fresh') });

    expect(resolveFileHandler('application/x-fresh')).not.toBe(resolveFileHandler('application/x-fresh'));
  });

  it('throws for an unregistered MIME type', () => {
    expect(() => resolveFileHandler('application/x-unknown')).toThrow('No file handler found for MIME type');
  });

  it('reports support through isMimeTypeSupported and getRegisteredMimeTypes', () => {
    registerFileHandlers({ 'application/x-supported': new StubHandler('supported') });

    expect(isMimeTypeSupported('application/x-supported')).toBe(true);
    expect(isMimeTypeSupported('application/x-missing')).toBe(false);
    expect(getRegisteredMimeTypes()).toContain('application/x-supported');
  });
});

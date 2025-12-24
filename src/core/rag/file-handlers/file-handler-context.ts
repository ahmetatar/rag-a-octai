import logger from '@infrastructure/logging/default-logger';
import { Document, FileHandler, FileInfo } from './file-handler';

/**
 * Parameters for resolving file handlers.
 */
export type HandlerResolveParameters = Record<string, any>;

/**
 * Type definition for the file handler registry.
 */
export type FileHandlerRegistry = Record<string, FileHandler | ((params: HandlerResolveParameters) => FileHandler)>;

// Module level registry for file handlers
const HANDLER_REGISTRY: FileHandlerRegistry = {};

/**
 * Registers file handlers in the global registry.
 * @param registry An object mapping MIME types to file handlers or factory functions.
 */
export function registerFileHandlers(registry: FileHandlerRegistry) {
  Object.assign(HANDLER_REGISTRY, registry);
}

/**
 * Context class to handle MIME type based file reading using appropriate file handlers.
 * @extends FileHandler
 * @example
 * const fileHandlerContext = new FileHandlerContext();
 * fileHandlerContext.setFileHandler('application/pdf');
 * const document = await fileHandlerContext.handleFile(fileInfo); 
 */
export class FileHandlerContext extends FileHandler {
  private fileHandler: FileHandler;

  /**
   * Sets the file handler based on the provided MIME type.
   * @param mimetype The MIME type of the file.
   */
  setFileHandler(mimetype: string, params: HandlerResolveParameters = {}) {
    const handlerOrFactory = HANDLER_REGISTRY[mimetype];

    if (!handlerOrFactory) {
      throw new Error(`No file handler found for MIME type: ${mimetype}`);
    }

    this.fileHandler = handlerOrFactory instanceof Function ? handlerOrFactory(params) : handlerOrFactory;
    logger.info(`Using ${this.fileHandler.constructor.name} for MIME type: ${mimetype}`);
  }

  /**
   * Reads a file based on its MIME type using the appropriate handler.
   * @param fileInfo Information about the file to be read.
   * @returns A promise that resolves to the file content as a string.
   */
  async handleFile(fileInfo: FileInfo): Promise<Document | Document[]> {
    if (!this.fileHandler) {
      throw new Error('File handler not set');
    }
    return this.fileHandler.handleFile(fileInfo);
  }
}

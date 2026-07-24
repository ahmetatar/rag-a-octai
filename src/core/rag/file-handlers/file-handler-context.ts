import { logger } from '@infrastructure/logging';
import { FileHandler } from './file-handler';

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
 * Lists the MIME types that currently have a registered handler.
 *
 * Handlers are registered while the application boots, i.e. AFTER this module is
 * loaded, so callers must read this at request time rather than at module load.
 *
 * @returns The registered MIME types.
 */
export function getRegisteredMimeTypes(): string[] {
  return Object.keys(HANDLER_REGISTRY);
}

/**
 * Checks whether a handler is registered for the given MIME type.
 * @param mimetype The MIME type to check.
 * @returns True when a handler can process this MIME type.
 */
export function isMimeTypeSupported(mimetype: string): boolean {
  return Boolean(HANDLER_REGISTRY[mimetype]);
}

/**
 * Resolves the file handler for a MIME type.
 */
export type FileHandlerResolver = (mimetype: string, params?: HandlerResolveParameters) => FileHandler;

/**
 * Resolves the handler registered for a MIME type.
 *
 * This is intentionally a pure function rather than stateful context object: the previous
 * design stored the resolved handler on an instance shared across requests, so two
 * concurrent uploads of different types would clobber each other's handler. Resolving on
 * every call keeps each file's handler local to that call, and factory-registered handlers
 * get a fresh instance per request.
 *
 * @param mimetype The MIME type of the file.
 * @param params Parameters passed to factory-registered handlers.
 * @returns The handler for the MIME type.
 * @throws Error when no handler is registered for the MIME type.
 */
export const resolveFileHandler: FileHandlerResolver = (mimetype, params = {}) => {
  const handlerOrFactory = HANDLER_REGISTRY[mimetype];

  if (!handlerOrFactory) {
    throw new Error(`No file handler found for MIME type: ${mimetype}`);
  }

  const handler = handlerOrFactory instanceof Function ? handlerOrFactory(params) : handlerOrFactory;
  logger.info(`Using ${handler.constructor.name} for MIME type: ${mimetype}`);
  return handler;
};

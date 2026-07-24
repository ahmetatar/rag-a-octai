import { Server } from 'http';
import { logger } from '../logging';

/** Signals that should start a graceful shutdown. */
const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * Stops accepting new connections and lets in-flight requests finish before exiting.
 *
 * Container runtimes send SIGTERM and kill the process shortly after; without this the
 * process dies mid-request, so an ingestion can end with some chunks stored and the rest
 * lost. A timeout guards against requests that never finish.
 *
 * @param server The listening HTTP server.
 * @param timeoutMs How long to wait for in-flight requests before forcing an exit.
 */
export function registerGracefulShutdown(server: Server, timeoutMs = 10_000): void {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    // A second Ctrl-C should not restart the sequence.
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info(`${signal} received, closing server...`);

    const forceExit = setTimeout(() => {
      logger.error(`Shutdown timed out after ${timeoutMs}ms, exiting anyway.`);
      process.exit(1);
    }, timeoutMs);
    // Do not keep the event loop alive just for this timer.
    forceExit.unref();

    server.close((error) => {
      clearTimeout(forceExit);

      if (error) {
        logger.error(`Error while closing server: ${error.message}`);
        process.exit(1);
      }

      logger.info('Server closed.');
      process.exit(0);
    });
  };

  SHUTDOWN_SIGNALS.forEach((signal) => process.on(signal, () => shutdown(signal)));
}

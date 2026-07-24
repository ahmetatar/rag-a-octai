import config from '@app/config';
import { createApp } from '@app/app';
import { closeIngestQueue } from '@routes/ingestion.route';
import { logger } from '@infrastructure/logging';
import { registerGracefulShutdown } from '@infrastructure/http';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(`Server is running on port ${config.port}`);
});

// Close the ingest queue (and its Redis connections) on shutdown so BullMQ does not keep
// the process alive or leave a worker mid-job.
registerGracefulShutdown(server, closeIngestQueue);

// An unhandled rejection terminates the process by default on Node 22. Log the cause
// first, otherwise the container restarts with no trace of what happened.
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled promise rejection: ${reason instanceof Error ? reason.stack ?? reason.message : reason}`);
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${error.stack ?? error.message}`);
  process.exit(1);
});

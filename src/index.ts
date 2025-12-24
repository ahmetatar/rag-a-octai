import express from 'express';
import logger from '@infrastructure/logging/default-logger';
import config from '@app/config';
import * as routes from '@routes/index';
import { registerFileHandlers, createTextFileHandler, createPdfPageFileHandler } from '@infrastructure/file-handlers';

registerFileHandlers({
  'text/plain': createTextFileHandler(),
  'application/pdf': createPdfPageFileHandler(),
});

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/ingest', routes.ingestionRouter);
app.use('/query', routes.queryRouter);

app.listen(config.port, () => {
  logger.info(`Server is running on port ${config.port}`);
});

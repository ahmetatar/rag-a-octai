import { createLogger, format, transports } from 'winston';
import config from '@app/config';
// Imported from the file, not the observability barrel, to avoid a require cycle: the
// barrel also exports the metrics module, which logs through this logger.
import { getCorrelationId } from '@infrastructure/observability/correlation-id';

/**
 * Default logger configuration using Winston.
 * Logs messages with timestamps to the console; DEBUG=true lowers the level to `debug`.
 * When a request is in flight its correlation id is appended so every line — including
 * ones emitted deep in the embed → search → generate chain — can be tied to one request.
 */
const logger = createLogger({
  level: config.debugMode ? 'debug' : 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message }) => {
      const correlationId = getCorrelationId();
      const suffix = correlationId ? ` [${correlationId}]` : '';
      return `${timestamp} ${level}: ${message}${suffix}`;
    })
  ),
  transports: [new transports.Console()],
});

export { logger };

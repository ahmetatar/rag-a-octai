import { createLogger, format, transports } from 'winston';
import config from '@app/config';

/**
 * Default logger configuration using Winston.
 * Logs messages with timestamps to the console; DEBUG=true lowers the level to `debug`.
 */
const logger = createLogger({
  level: config.debugMode ? 'debug' : 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
  ),
  transports: [new transports.Console()],
});

export { logger };

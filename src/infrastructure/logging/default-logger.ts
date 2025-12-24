import { createLogger, format, transports } from 'winston';

/**
 * Default logger configuration using Winston.
 * Logs messages in JSON format with timestamps to the console.
 */
const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
  ),
  transports: [new transports.Console()],
});

export default logger;

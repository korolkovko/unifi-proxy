import pino from 'pino';

const logLevel = process.env.LOG_LEVEL || 'info';
const logPretty = process.env.LOG_PRETTY === 'true';

/**
 * Create Pino logger instance with optimal configuration
 * - Structured JSON logging for production (Railway)
 * - Pretty logging for development
 * - Performance optimized (extreme mode for production)
 */
const logger = pino({
  level: logLevel,

  // Use pretty print in development
  transport: logPretty ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    }
  } : undefined,

  // Base configuration for structured logging
  base: {
    pid: process.pid,
    env: process.env.NODE_ENV || 'production',
  },

  // Timestamp format
  timestamp: pino.stdTimeFunctions.isoTime,

  // Serializers for common objects
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },

  // Format log errors
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
});

/**
 * Create child logger with additional context
 * @param {Object} bindings - Additional key-value pairs to include in all logs
 * @returns {Object} Child logger instance
 */
export function createChildLogger(bindings) {
  return logger.child(bindings);
}

export default logger;

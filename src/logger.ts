/**
 * Winston logger configuration for Weather Prediction Market Bot
 */

import winston from 'winston';
import { getConfig } from './config';
import path from 'path';
import fs from 'fs';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom log format
const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  let log = `${timestamp} [${level}]: ${message}`;
  
  // Add stack trace for errors
  if (stack) {
    log += `\n${stack}`;
  }
  
  // Add metadata if present
  if (Object.keys(meta).length > 0) {
    log += ` ${JSON.stringify(meta)}`;
  }
  
  return log;
});

// Create logger instance
function createLogger(): winston.Logger {
  const config = getConfig();
  
  // Ensure log directory exists
  if (config.logging.toFile) {
    const logDir = path.dirname(config.logging.filePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }
  
  const transports: winston.transport[] = [
    // Console transport with colors
    new winston.transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        logFormat
      ),
    }),
  ];
  
  // File transport if enabled
  if (config.logging.toFile) {
    transports.push(
      new winston.transports.File({
        filename: config.logging.filePath,
        format: combine(
          timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          errors({ stack: true }),
          logFormat
        ),
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5,
      })
    );
    
    // Separate error log
    transports.push(
      new winston.transports.File({
        filename: config.logging.filePath.replace('.log', '.error.log'),
        level: 'error',
        format: combine(
          timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          errors({ stack: true }),
          logFormat
        ),
        maxsize: 10 * 1024 * 1024,
        maxFiles: 3,
      })
    );
  }
  
  return winston.createLogger({
    level: config.logging.level,
    transports,
    // Don't exit on handled exceptions
    exitOnError: false,
  });
}

// Singleton logger instance
let _logger: winston.Logger | null = null;

export function getLogger(): winston.Logger {
  if (!_logger) {
    _logger = createLogger();
  }
  return _logger;
}

// Convenience methods for structured logging
export const logger = {
  get instance(): winston.Logger {
    return getLogger();
  },
  
  debug(message: string, meta?: Record<string, unknown>): void {
    getLogger().debug(message, meta);
  },
  
  info(message: string, meta?: Record<string, unknown>): void {
    getLogger().info(message, meta);
  },
  
  warn(message: string, meta?: Record<string, unknown>): void {
    getLogger().warn(message, meta);
  },
  
  error(message: string, error?: Error | unknown, meta?: Record<string, unknown>): void {
    if (error instanceof Error) {
      getLogger().error(message, { ...meta, stack: error.stack, errorMessage: error.message });
    } else if (error) {
      getLogger().error(message, { ...meta, error });
    } else {
      getLogger().error(message, meta);
    }
  },
  
  // Trading-specific logs
  trade(action: string, data: Record<string, unknown>): void {
    getLogger().info(`[TRADE] ${action}`, { type: 'trade', ...data });
  },
  
  edge(market: string, edge: number, data: Record<string, unknown>): void {
    getLogger().info(`[EDGE] ${market}: ${(edge * 100).toFixed(2)}%`, { type: 'edge', market, edge, ...data });
  },
  
  market(action: string, data: Record<string, unknown>): void {
    getLogger().debug(`[MARKET] ${action}`, { type: 'market', ...data });
  },
  
  forecast(city: string, data: Record<string, unknown>): void {
    getLogger().debug(`[FORECAST] ${city}`, { type: 'forecast', city, ...data });
  },
  
  bot(action: string, data?: Record<string, unknown>): void {
    getLogger().info(`[BOT] ${action}`, { type: 'bot', ...data });
  },
};

export default logger;



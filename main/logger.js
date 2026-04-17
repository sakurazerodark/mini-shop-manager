const path = require('path');
const fs = require('fs');
const winston = require('winston');
require('winston-daily-rotate-file');
const { baseDataDir } = require('./utils/dir');

const logsDir = path.join(baseDataDir, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Console Format: readable, colorized
const timeFormat = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const pad3 = (n) => String(n).padStart(3, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad3(d.getMilliseconds())}`;
};

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: timeFormat }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    // Extract metadata excluding winston internal symbols
    const metaObj = Object.keys(meta).reduce((acc, key) => {
      if (typeof key === 'string') acc[key] = meta[key];
      return acc;
    }, {});
    const metaStr = Object.keys(metaObj).length ? JSON.stringify(metaObj) : '';
    return `[${timestamp}] ${level}: ${message} ${metaStr}`;
  })
);

// File Format: logback style plain text
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: timeFormat }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaObj = Object.keys(meta).reduce((acc, key) => {
      if (typeof key === 'string') acc[key] = meta[key];
      return acc;
    }, {});
    const metaStr = Object.keys(metaObj).length ? JSON.stringify(metaObj) : '';
    return `[${timestamp}] ${level.toUpperCase()} - ${message} ${metaStr}`;
  })
);

// App Logger for general application logs
const appLogger = winston.createLogger({
  level: 'info',
  format: fileFormat,
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    new winston.transports.DailyRotateFile({
      filename: path.join(logsDir, 'app-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,  // Compress old log files
      maxSize: '20m',       // Rotate if file exceeds 20MB
      maxFiles: '14d'       // Keep logs for 14 days, then auto-delete
    })
  ]
});

// Access Logger specifically for HTTP requests
const accessLogger = winston.createLogger({
  level: 'info',
  format: fileFormat,
  transports: [
    new winston.transports.DailyRotateFile({
      filename: path.join(logsDir, 'access-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d'
    })
  ]
});

module.exports = {
  info: (message, meta) => appLogger.info(message, meta),
  warn: (message, meta) => appLogger.warn(message, meta),
  error: (message, meta) => appLogger.error(message, meta),
  access: (meta) => accessLogger.info('HTTP Access', meta)
};


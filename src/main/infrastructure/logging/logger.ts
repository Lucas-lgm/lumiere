/**
 * Logging system
 *
 * Provides unified logging functionality with different log levels and output methods.
 * Supports global log level control + file output (rotation).
 */

import { appendFileSync, statSync, renameSync, unlinkSync } from 'fs'

/**
 * Log level enum
 */
export enum LogLevel {
  /** Debug information, used only in development environment */
  DEBUG = 0,
  /** General information */
  INFO = 1,
  /** Warning information */
  WARN = 2,
  /** Error information */
  ERROR = 3
}

/**
 * Log metadata interface
 */
export interface LogMeta {
  [key: string]: any
}

/**
 * Logger configuration interface
 */
export interface LoggerConfig {
  /** Minimum log level, logs below this level will be ignored */
  minLevel: LogLevel
  /** Whether to enable console output */
  enableConsole: boolean
}

// ========== Global state ==========

/** Global log level (takes priority over instance config) */
let globalMinLevel: LogLevel | null = null

/** File log path */
let logFilePath: string | null = null

/** Whether file logging is enabled */
let fileLoggingEnabled = false

/** 5MB single file size cap */
const MAX_LOG_FILE_SIZE = 5 * 1024 * 1024

/**
 * Set global log level (shared by all Logger instances)
 */
export function setGlobalLogLevel(level: LogLevel): void {
  globalMinLevel = level
}

/**
 * Parse AppSettings logLevel string to LogLevel enum
 */
export function parseLogLevel(level: string): LogLevel {
  switch (level) {
    case 'error': return LogLevel.ERROR
    case 'warn': return LogLevel.WARN
    case 'info': return LogLevel.INFO
    case 'debug':
    case 'trace': return LogLevel.DEBUG
    default: return LogLevel.WARN
  }
}

/**
 * Initialize file logging (called by bootstrap after app.whenReady)
 * @param filePath Log file path, e.g. `app.getPath('logs') + '/lumiere.log'`
 */
export function initFileLogging(filePath: string): void {
  logFilePath = filePath
  fileLoggingEnabled = true
}

/**
 * Log file rotation: rename to .1.log when exceeding 5MB
 */
function rotateIfNeeded(): void {
  if (!logFilePath) return
  try {
    const stats = statSync(logFilePath)
    if (stats.size >= MAX_LOG_FILE_SIZE) {
      const rotatedPath = logFilePath.replace(/\.log$/, '.1.log')
      try { unlinkSync(rotatedPath) } catch { /* ignore if not exists */ }
      renameSync(logFilePath, rotatedPath)
    }
  } catch {
    // File doesn't exist or other error, ignore
  }
}

/**
 * Logger class
 *
 * Provides structured logging with different levels and output methods.
 * All logs include timestamp, level, module name, and message content.
 */
export class Logger {
  private config: LoggerConfig
  private moduleName: string

  constructor(moduleName: string, config?: Partial<LoggerConfig>) {
    this.moduleName = moduleName
    this.config = {
      minLevel: process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.INFO,
      enableConsole: true,
      ...config
    }
  }

  debug(message: string, meta?: LogMeta): void {
    this.log(LogLevel.DEBUG, message, meta)
  }

  info(message: string, meta?: LogMeta): void {
    this.log(LogLevel.INFO, message, meta)
  }

  warn(message: string, meta?: LogMeta): void {
    this.log(LogLevel.WARN, message, meta)
  }

  error(message: string, meta?: LogMeta): void {
    this.log(LogLevel.ERROR, message, meta)
  }

  private log(level: LogLevel, message: string, meta?: LogMeta): void {
    // Global log level takes priority, otherwise use instance level
    const minLevel = globalMinLevel ?? this.config.minLevel
    if (level < minLevel) return

    const timestamp = new Date().toISOString()
    const levelName = LogLevel[level]
    const logEntry = this.formatLogEntry(timestamp, levelName, message, meta)

    // Output to console
    if (this.config.enableConsole) {
      this.outputToConsole(level, logEntry)
    }

    // Output to file
    if (fileLoggingEnabled && logFilePath) {
      try {
        rotateIfNeeded()
        appendFileSync(logFilePath, logEntry + '\n')
      } catch {
        // File write failure doesn't affect the main flow
      }
    }
  }

  private formatLogEntry(timestamp: string, level: string, message: string, meta?: LogMeta): string {
    const parts = [
      `[${timestamp}]`,
      `[${level}]`,
      `[${this.moduleName}]`,
      message
    ]

    if (meta && Object.keys(meta).length > 0) {
      parts.push(JSON.stringify(meta))
    }

    return parts.join(' ')
  }

  private outputToConsole(level: LogLevel, logEntry: string): void {
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(logEntry)
        break
      case LogLevel.INFO:
        console.log(logEntry)
        break
      case LogLevel.WARN:
        console.warn(logEntry)
        break
      case LogLevel.ERROR:
        console.error(logEntry)
        break
    }
  }
}

/**
 * Factory function to create Logger instances
 */
export function createLogger(moduleName: string, config?: Partial<LoggerConfig>): Logger {
  return new Logger(moduleName, config)
}

/**
 * Default logger instance
 */
export const defaultLogger = createLogger('Main')

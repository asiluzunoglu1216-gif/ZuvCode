import { redactSecrets } from "./redact.js";
import { nowIso } from "./time.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  level: LogLevel;
  scope: string;
  message: string;
  time: string;
  data?: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export interface LoggerOptions {
  minLevel?: LogLevel;
  sink?: (record: LogRecord) => void;
}

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export function createLogger(scope: string, options: LoggerOptions = {}): Logger {
  const minLevel = options.minLevel ?? "info";
  const sink = options.sink ?? defaultSink;

  function write(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (levelWeight[level] < levelWeight[minLevel]) {
      return;
    }

    const record: LogRecord = {
      level,
      scope,
      message: redactSecrets(message),
      time: nowIso()
    };

    if (data !== undefined) {
      record.data = redactRecord(data);
    }

    sink(record);
  }

  return {
    debug: (message, data) => write("debug", message, data),
    info: (message, data) => write("info", message, data),
    warn: (message, data) => write("warn", message, data),
    error: (message, data) => write("error", message, data),
    child: (childScope) => createLogger(`${scope}:${childScope}`, options)
  };
}

export function createSilentLogger(): Logger {
  return createLogger("silent", { minLevel: "error", sink: () => undefined });
}

function defaultSink(record: LogRecord): void {
  const payload = record.data === undefined ? "" : ` ${JSON.stringify(record.data)}`;
  const line = `[${record.time}] ${record.level.toUpperCase()} ${record.scope}: ${record.message}${payload}`;
  if (record.level === "error" || record.level === "warn") {
    process.stderr.write(`${line}\n`);
  }
}

function redactRecord(data: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(redactSecrets(JSON.stringify(data))) as Record<string, unknown>;
}


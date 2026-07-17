export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  readonly [key: string]: unknown;
}

/**
 * Injectable structured-logging seam, mirroring the repo-wide
 * Clock/IdGenerator pattern (src/application/types.ts): a real
 * implementation for production, a capturing fake for tests. Never
 * logs full request/response bodies or secrets (tokens, passwords) —
 * callers are responsible for passing only safe, structured fields.
 */
export interface Logger {
  log(level: LogLevel, message: string, fields?: LogFields): void;
}

/** Default Logger for real usage — writes structured JSON lines to stdout/stderr. */
export class ConsoleLogger implements Logger {
  log(level: LogLevel, message: string, fields: LogFields = {}): void {
    const entry = { level, message, timestamp: new Date().toISOString(), ...fields };
    const line = JSON.stringify(entry);
    if (level === "error" || level === "warn") {
      console.error(line);
    } else {
      console.log(line);
    }
  }
}

/** No-op Logger — the default for tests that don't care about log output. */
export class NullLogger implements Logger {
  log(): void {
    // intentionally empty
  }
}

/**
 * Capturing Logger for tests that need to assert on what was logged
 * (e.g. "an error was logged for this failed request") without
 * depending on stdout.
 */
export class InMemoryLogger implements Logger {
  readonly entries: Array<{ level: LogLevel; message: string; fields: LogFields }> = [];

  log(level: LogLevel, message: string, fields: LogFields = {}): void {
    this.entries.push({ level, message, fields });
  }
}

type Level = "info" | "warn" | "error";

function write(level: Level, scope: string, message: string, extra?: unknown) {
  const line = `${new Date().toISOString()} ${level.padEnd(5)} [${scope}] ${message}`;
  const out = level === "info" ? console.log : console.error;
  if (extra === undefined) out(line);
  else out(line, extra instanceof Error ? (extra.stack ?? extra.message) : extra);
}

export interface Logger {
  info(message: string, extra?: unknown): void;
  warn(message: string, extra?: unknown): void;
  error(message: string, extra?: unknown): void;
}

export function logger(scope: string): Logger {
  return {
    info: (m, e) => write("info", scope, m, e),
    warn: (m, e) => write("warn", scope, m, e),
    error: (m, e) => write("error", scope, m, e),
  };
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

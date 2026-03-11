export type LogLevelName = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_ORDER: Record<LogLevelName, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export class Logger {
  public constructor(private readonly level: LogLevelName) {}

  public debug(message: string, data?: unknown): void {
    this.write("debug", message, data);
  }

  public info(message: string, data?: unknown): void {
    this.write("info", message, data);
  }

  public warn(message: string, data?: unknown): void {
    this.write("warn", message, data);
  }

  public error(message: string, data?: unknown): void {
    this.write("error", message, data);
  }

  private write(level: LogLevelName, message: string, data?: unknown): void {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[this.level]) {
      return;
    }

    const suffix = data === undefined ? "" : ` ${JSON.stringify(data)}`;
    process.stderr.write(`[${level.toUpperCase()}] ${message}${suffix}\n`);
  }
}

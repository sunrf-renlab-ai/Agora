type LogLevel = "debug" | "info" | "warn" | "error";

interface LogFields {
  [k: string]: unknown;
}

function emit(level: LogLevel, msg: string, fields: LogFields = {}) {
  const line = JSON.stringify({ level, msg, ts: new Date().toISOString(), ...fields });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: LogFields) => emit("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};

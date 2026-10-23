import pino from "pino";

// Structured JSON logs. Pipe through pino-pretty locally if wanted.
export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: process.env.WIDELINE_SERVICE ?? "web" },
  timestamp: pino.stdTimeFunctions.isoTime,
  // idNumber: a scout's ID or passport number must never reach a log (AUTH09).
  redact: [
    "password",
    "*.password",
    "idNumber",
    "*.idNumber",
    "headers.cookie",
    "headers.authorization",
  ],
});

import pino, { type LoggerOptions } from "pino";

/**
 * A Prisma error: a PrismaClient* class, or anything carrying a Prisma error
 * code ("P2002"). Checked by shape, so it also catches errors that crossed a
 * module boundary or were rebuilt by the driver adapter.
 */
function isPrismaError(err: unknown): err is Error & Record<string, unknown> {
  if (!(err instanceof Error)) return false;
  if (err.name.startsWith("PrismaClient")) return true;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && /^P\d{4}$/.test(code);
}

/** True when the error, or any error in its cause chain, is a Prisma error. */
function hasPrismaError(err: unknown, depth = 0): boolean {
  if (!(err instanceof Error) || depth > 10) return false;
  return isPrismaError(err) || hasPrismaError(err.cause, depth + 1);
}

/** The stack frames only: the first lines repeat the message, which can hold query arguments. */
function framesOnly(stack: unknown): string | undefined {
  if (typeof stack !== "string") return undefined;
  const frames = stack.split("\n").filter((line) => /^\s+at /.test(line));
  return frames.length ? frames.join("\n") : undefined;
}

/**
 * The `err` serializer. Prisma validation, request and driver errors repeat the
 * query arguments in their message (a player's name, a date of birth, a CSV
 * row), and children's data must never reach a log (NFR08, CONS). For those
 * only name, code, clientVersion, meta.modelName and meta.target are kept, with
 * the bare stack frames. Any other error is serialized as pino does by default;
 * one that wraps a Prisma error keeps its own message, and its cause goes
 * through this serializer.
 */
export function serializeErr(err: unknown): unknown {
  if (isPrismaError(err)) {
    const meta = err.meta as { modelName?: unknown; target?: unknown } | undefined;
    const kept = meta && {
      ...(meta.modelName !== undefined && { modelName: meta.modelName }),
      ...(meta.target !== undefined && { target: meta.target }),
    };
    return {
      type: err.name,
      name: err.name,
      ...(err.code !== undefined && { code: err.code }),
      ...(err.clientVersion !== undefined && { clientVersion: err.clientVersion }),
      ...(kept && Object.keys(kept).length > 0 && { meta: kept }),
      ...(framesOnly(err.stack) && { stack: framesOnly(err.stack) }),
    };
  }
  if (err instanceof Error && hasPrismaError(err.cause)) {
    return {
      type: err.name,
      message: err.message,
      stack: err.stack,
      cause: serializeErr(err.cause),
    };
  }
  return pino.stdSerializers.err(err as Error);
}

/** The logger's options. Exported so a test can build the same logger over its own stream. */
export const logOptions: LoggerOptions = {
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
  serializers: { err: serializeErr },
};

// Structured JSON logs. Pipe through pino-pretty locally if wanted.
export const log = pino(logOptions);

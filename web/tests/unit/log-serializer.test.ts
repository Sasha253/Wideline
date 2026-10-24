import pino from "pino";
import { describe, expect, it } from "vitest";
import { logOptions, serializeErr } from "@/server/log";

// NFR08, CONS: children's data never reaches a log. Prisma errors repeat the
// query arguments (names, dates of birth, CSV rows) in their message, so the
// logger's err serializer keeps only their name, code, version and model.

const NAME = "Thabo Nkosi";
const DOB = "2011-03-14";

/** Shaped like Prisma's PrismaClientValidationError: the arguments are in the message. */
function validationError() {
  const err = new Error(
    `Invalid \`prisma.player.create()\` invocation:\n\n{\n  data: {\n    firstName: "${NAME}",\n    dateOfBirth: new Date("${DOB}"),\n    heightCm: "tall"\n  }\n}\n\nArgument \`heightCm\`: Invalid value provided.`,
  ) as Error & { clientVersion: string };
  err.name = "PrismaClientValidationError";
  err.clientVersion = "7.10.1";
  return err;
}

/** The real logger options over a stream that keeps each line. */
function capture() {
  const lines: string[] = [];
  const logger = pino(logOptions, { write: (s: string) => void lines.push(s) });
  return { logger, lines };
}

describe("the err serializer", () => {
  it("drops the message and the arguments in the stack of a Prisma validation error", () => {
    const { logger, lines } = capture();
    logger.error({ err: validationError() }, "player save failed");
    expect(lines).toHaveLength(1);
    const text = lines[0]!;
    expect(text).not.toContain("Thabo");
    expect(text).not.toContain("Nkosi");
    expect(text).not.toContain(DOB);
    expect(text).not.toContain("2011");
    const { err } = JSON.parse(text) as { err: Record<string, unknown> };
    expect(err).toMatchObject({
      type: "PrismaClientValidationError",
      name: "PrismaClientValidationError",
      clientVersion: "7.10.1",
    });
    expect(err).not.toHaveProperty("message");
    expect(String(err.stack)).toMatch(/^\s+at /);
  });

  it("keeps code, modelName and target of a request error, and nothing else from meta", () => {
    const err = Object.assign(new Error(`Unique constraint failed: ("${NAME}", ${DOB})`), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      clientVersion: "7.10.1",
      meta: { modelName: "Player", target: ["teamId", "squadNumber"], row: { firstName: NAME } },
    });
    expect(serializeErr(err)).toEqual({
      type: "PrismaClientKnownRequestError",
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      clientVersion: "7.10.1",
      meta: { modelName: "Player", target: ["teamId", "squadNumber"] },
      stack: expect.stringMatching(/^\s+at /),
    });
  });

  it("treats any error with a Prisma code as a Prisma error", () => {
    const err = Object.assign(new Error(`Foreign key failed for ${NAME}`), { code: "P2003" });
    expect(JSON.stringify(serializeErr(err))).not.toContain(NAME);
  });

  it("keeps the wrapper's message but not its Prisma cause's", () => {
    const { logger, lines } = capture();
    logger.error({ err: new Error("import failed", { cause: validationError() }) }, "x");
    const { err } = JSON.parse(lines[0]!) as { err: { message: string; cause: object } };
    expect(err.message).toBe("import failed");
    expect(err.cause).toMatchObject({ name: "PrismaClientValidationError" });
    expect(lines[0]).not.toContain("Thabo");
  });

  it("leaves other errors as pino serializes them", () => {
    const { logger, lines } = capture();
    logger.error({ err: new TypeError("boom") }, "x");
    const { err } = JSON.parse(lines[0]!) as { err: Record<string, unknown> };
    expect(err).toMatchObject({ type: "TypeError", message: "boom" });
    expect(String(err.stack)).toContain("TypeError: boom");
  });
});

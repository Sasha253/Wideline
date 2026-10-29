import { describe, expect, it, vi } from "vitest";

// C08 (CV01): the worker callback's token is an HMAC of the job and the
// instance under CV_CALLBACK_SECRET, compared in constant time. Another job's
// or instance's token, a truncated one, or a guess is refused. Bodies over
// 8 KB, unknown kinds and malformed JSON are refused before any database read.

vi.stubEnv("CV_CALLBACK_SECRET", "a-test-secret-of-at-least-32-characters!!");
const { callbackToken, verifyCallbackToken } = await import("@/server/cv/instances");
const { CALLBACK_MAX_BYTES, handleCvCallback } = await import("@/server/cv/callback");

describe("callback tokens", () => {
  const token = callbackToken("inst_1", "job_1");

  it("accepts the instance's own token", () => {
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyCallbackToken(token, "inst_1", "job_1")).toBe(true);
  });

  it.each([
    ["another job's token", callbackToken("inst_1", "job_2")],
    ["another instance's token", callbackToken("inst_2", "job_1")],
    ["a truncated token", token.slice(0, 63)],
    ["an empty token", ""],
    ["a guess", "0".repeat(64)],
  ])("refuses %s", (_name, t) => {
    expect(verifyCallbackToken(t, "inst_1", "job_1")).toBe(false);
  });
});

describe("handleCvCallback before the database", () => {
  const auth = `Bearer ${callbackToken("inst_1", "job_1")}`;

  it("refuses a body over 8 KB", async () => {
    const body = JSON.stringify({
      instanceId: "inst_1",
      kind: "failed",
      error: "x".repeat(CALLBACK_MAX_BYTES),
    });
    expect((await handleCvCallback("job_1", auth, body)).status).toBe(413);
  });

  it.each([
    ["malformed JSON", "{", 400],
    ["an unknown kind", JSON.stringify({ instanceId: "inst_1", kind: "progress" }), 400],
    ["an extra field", JSON.stringify({ instanceId: "inst_1", kind: "heartbeat", url: "x" }), 400],
    [
      "succeeded with no checksum",
      JSON.stringify({ instanceId: "inst_1", kind: "succeeded" }),
      400,
    ],
  ])("refuses %s", async (_name, body, status) => {
    expect((await handleCvCallback("job_1", auth, body)).status).toBe(status);
  });

  it("refuses a wrong or missing token with 401", async () => {
    const body = JSON.stringify({ instanceId: "inst_1", kind: "heartbeat" });
    expect((await handleCvCallback("job_1", null, body)).status).toBe(401);
    expect((await handleCvCallback("job_2", auth, body)).status).toBe(401);
    expect((await handleCvCallback("job_1", "Basic abc", body)).status).toBe(401);
  });
});

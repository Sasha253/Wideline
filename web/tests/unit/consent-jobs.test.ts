import { beforeEach, describe, expect, it, vi } from "vitest";

// NFR11: enqueueConsentWithdrawn never fails the consent change it follows (the
// row is already saved), and its log line carries ids only, never names.

const queue = vi.hoisted(() => ({
  getBoss: vi.fn(),
  QUEUES: { consentWithdrawn: "consent-withdrawn" },
}));
vi.mock("@/server/queue", () => queue);

const logged = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("@/server/log", () => ({ log: logged }));

const { enqueueConsentWithdrawn } = await import("@/server/consent/jobs");

const job = { organisationId: "org-1", playerId: "player-1", consentId: "consent-1" };

beforeEach(() => {
  queue.getBoss.mockReset();
  logged.error.mockReset();
});

describe("enqueueConsentWithdrawn", () => {
  it("resolves when getBoss rejects, and logs only the ids", async () => {
    const cause = new Error("queue down");
    queue.getBoss.mockRejectedValue(cause);
    await expect(enqueueConsentWithdrawn(job)).resolves.toBeUndefined();
    expect(logged.error).toHaveBeenCalledTimes(1);
    const [fields, message] = logged.error.mock.calls[0]!;
    expect(fields).toEqual({ err: cause, ...job });
    expect(Object.keys(fields).sort()).toEqual(["consentId", "err", "organisationId", "playerId"]);
    expect(message).toBe("consent-withdrawn enqueue failed");
  });

  it("resolves when send rejects", async () => {
    queue.getBoss.mockResolvedValue({ send: vi.fn().mockRejectedValue(new Error("send failed")) });
    await expect(enqueueConsentWithdrawn(job)).resolves.toBeUndefined();
    expect(logged.error).toHaveBeenCalledTimes(1);
  });

  it("sends the job with ids only", async () => {
    const send = vi.fn().mockResolvedValue("job-id");
    queue.getBoss.mockResolvedValue({ send });
    await enqueueConsentWithdrawn(job);
    expect(send).toHaveBeenCalledWith("consent-withdrawn", job);
    expect(logged.error).not.toHaveBeenCalled();
  });
});

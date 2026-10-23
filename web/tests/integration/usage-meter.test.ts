import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import { recordUsage, usageTotals } from "@/server/usage/meter";
import { fixtures } from "./helpers/fixtures";

// ADMIN05, NFR04, NFR06: the usage meter records one signed delta per source,
// so a retried job never counts twice.

const f = fixtures();
let orgA: string;
let orgB: string;

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 12));
const range = { from: day(1), to: day(31) };

beforeAll(async () => {
  orgA = (await f.org("Usage A")).id;
  orgB = (await f.org("Usage B")).id;
});

afterAll(async () => {
  await f.cleanup();
});

describe("recordUsage", () => {
  it("records a source once: a retry returns false and adds no row (NFR06)", async () => {
    const event = {
      organisationId: orgA,
      metric: "matches" as const,
      quantity: 1,
      sourceType: "Match",
      sourceId: "match-1",
      occurredAt: day(2),
    };
    expect(await recordUsage(event)).toBe(true);
    expect(await recordUsage({ ...event, quantity: 5 })).toBe(false);
    const rows = await rawDb.usageEvent.findMany({
      where: { organisationId: orgA, sourceId: "match-1" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.quantity).toBe(BigInt(1));
  });

  it("needs a currency for GPU cost, and refuses one on other metrics", async () => {
    const base = { organisationId: orgA, sourceType: "CvJob", sourceId: "job-x" };
    await expect(
      recordUsage({ ...base, metric: "gpu_cost_cents", quantity: 120 }),
    ).rejects.toThrow();
    await expect(
      recordUsage({ ...base, metric: "storage_bytes", quantity: 1, currency: "USD" }),
    ).rejects.toThrow();
    await expect(
      recordUsage({ ...base, metric: "gpu_cost_cents", quantity: 1, currency: "usd" }),
    ).rejects.toThrow();
    await expect(
      recordUsage({ ...base, metric: "gpu_cost_cents", quantity: 1, currency: "XYZ" }),
    ).rejects.toThrow();
    await expect(recordUsage({ ...base, metric: "matches", quantity: 1.5 })).rejects.toThrow();
    expect(
      await rawDb.usageEvent.count({ where: { organisationId: orgA, sourceId: "job-x" } }),
    ).toBe(0);
  });

  it("writes inside a transaction and rolls back with it", async () => {
    await expect(
      rawDb.$transaction(async (tx) => {
        await recordUsage(
          {
            organisationId: orgA,
            metric: "video_seconds",
            quantity: 60,
            sourceType: "Upload",
            sourceId: "rolled-back",
          },
          tx,
        );
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(
      await rawDb.usageEvent.count({ where: { organisationId: orgA, sourceId: "rolled-back" } }),
    ).toBe(0);
  });
});

describe("usageTotals", () => {
  beforeAll(async () => {
    const events = [
      { metric: "matches", quantity: 1, sourceId: "match-2", occurredAt: day(3) },
      { metric: "video_seconds", quantity: 5400, sourceId: "upload-1", occurredAt: day(3) },
      { metric: "storage_bytes", quantity: 8_000_000_000, sourceId: "file-1", occurredAt: day(3) },
      {
        metric: "storage_bytes",
        quantity: -3_000_000_000,
        sourceId: "file-1-del",
        occurredAt: day(20),
      },
      {
        metric: "gpu_cost_cents",
        quantity: 250,
        currency: "USD",
        sourceId: "job-1",
        occurredAt: day(4),
      },
      {
        metric: "gpu_cost_cents",
        quantity: 100,
        currency: "USD",
        sourceId: "job-2",
        occurredAt: day(5),
      },
      {
        metric: "gpu_cost_cents",
        quantity: 900,
        currency: "ZAR",
        sourceId: "job-3",
        occurredAt: day(5),
      },
      // Outside the range.
      {
        metric: "matches",
        quantity: 1,
        sourceId: "match-old",
        occurredAt: new Date(Date.UTC(2026, 8, 30)),
      },
    ] as const;
    for (const e of events) {
      await recordUsage({ organisationId: orgA, sourceType: "Test", ...e });
    }
    await recordUsage({
      organisationId: orgB,
      metric: "matches",
      quantity: 40,
      sourceType: "Test",
      sourceId: "b-match",
      occurredAt: day(3),
    });
  });

  it("sums per metric in the range, nets storage deltas and groups money by currency", async () => {
    expect(await usageTotals(orgA, range)).toEqual({
      // match-1 (day 2) from the first test, plus match-2.
      matches: BigInt(2),
      video_seconds: BigInt(5400),
      storage_bytes: BigInt(5_000_000_000),
      gpu_cost_cents: { USD: BigInt(350), ZAR: BigInt(900) },
    });
  });

  it("excludes other organisations' rows", async () => {
    expect((await usageTotals(orgB, range)).matches).toBe(BigInt(40));
    expect((await usageTotals(orgB, range)).gpu_cost_cents).toEqual({});
  });

  it("the end of the range is exclusive", async () => {
    expect((await usageTotals(orgA, { from: day(1), to: day(3) })).matches).toBe(BigInt(1));
  });
});

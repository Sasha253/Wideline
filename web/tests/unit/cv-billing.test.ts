import { afterEach, describe, expect, it, vi } from "vitest";
import { billedSeconds, costCents } from "@/server/cv/billing";
import { resetCvConfig } from "@/server/cv/config";
import { hourlyProvider } from "@/server/cv/providers/hourly";
import { GpuProviderNotConfigured } from "@/server/cv/providers/types";

// C08 (NFR04): GPU cost per instance. Billed time rounds up to the provider's
// step and never falls below its minimum; cost rounds up to the cent. The
// hourly provider's billing comes from its settings, and every call throws
// until a provider is chosen (Q-033).

const t0 = new Date("2026-10-28T10:00:00Z");
const after = (s: number) => new Date(t0.getTime() + s * 1000);

describe("billedSeconds", () => {
  it("rounds up to the increment", () => {
    const perMinute = { minimumSeconds: 60, incrementSeconds: 60 };
    expect(billedSeconds(t0, after(61), perMinute)).toBe(120);
    expect(billedSeconds(t0, after(120), perMinute)).toBe(120);
  });

  it("respects the minimum", () => {
    expect(billedSeconds(t0, after(5), { minimumSeconds: 60, incrementSeconds: 1 })).toBe(60);
  });

  it("counts per second with a step of 1, and never goes negative", () => {
    const perSecond = { minimumSeconds: 0, incrementSeconds: 1 };
    expect(billedSeconds(t0, after(90.2), perSecond)).toBe(91);
    expect(billedSeconds(after(10), t0, perSecond)).toBe(0);
  });
});

describe("costCents", () => {
  it("rounds up to the cent", () => {
    expect(costCents(3600, 59)).toBe(59);
    expect(costCents(61, 59)).toBe(1);
    expect(costCents(1800, 59)).toBe(30);
  });

  it("is zero for a free provider (local docker)", () => {
    expect(costCents(7200, 0)).toBe(0);
  });
});

describe("the hourly provider stub", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetCvConfig();
  });

  it("reads its rate and currency, bills per minute, and refuses every call", async () => {
    vi.stubEnv("HOURLY_GPU_CENTS_PER_HOUR", "69");
    vi.stubEnv("HOURLY_GPU_CURRENCY", "EUR");
    resetCvConfig();
    const p = hourlyProvider();
    expect(p.billing).toEqual({
      centsPerHour: 69,
      currency: "EUR",
      minimumSeconds: 60,
      incrementSeconds: 60,
    });
    await expect(
      p.start({ instanceId: "i", processingJobId: "j", image: "x", env: {} }),
    ).rejects.toBeInstanceOf(GpuProviderNotConfigured);
    await expect(p.list()).rejects.toBeInstanceOf(GpuProviderNotConfigured);
  });
});

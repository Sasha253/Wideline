import { cvConfig } from "../config";
import { GpuProviderNotConfigured, type GpuProvider } from "./types";

/**
 * The hourly GPU provider (C08; PRD open question, Q-033). The billing maths
 * are real so cost reports are right from the first job; every call throws
 * until the provider is chosen and implemented here (C19): start by API with
 * the wideline labels or tags, status, destroy and a labelled list for the
 * watchdog. Per-minute billing is assumed.
 */
export function hourlyProvider(): GpuProvider {
  const cfg = cvConfig();
  const notConfigured = async (): Promise<never> => {
    throw new GpuProviderNotConfigured("hourly");
  };
  return {
    name: "hourly",
    billing: {
      centsPerHour: cfg.HOURLY_GPU_CENTS_PER_HOUR,
      currency: cfg.HOURLY_GPU_CURRENCY,
      minimumSeconds: 60,
      incrementSeconds: 60,
    },
    start: notConfigured,
    status: notConfigured,
    destroy: notConfigured,
    list: notConfigured,
  };
}

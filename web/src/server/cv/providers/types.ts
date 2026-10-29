/**
 * Where a CV instance runs (C08; CV01, NFR07). The dispatcher starts one
 * instance per attempt, polls it, and destroys it; the watchdog lists what is
 * running so nothing outlives its job. Implementations: `docker` (local
 * development, src/server/cv/providers/docker.ts), `hourly` (the GPU provider
 * still to be chosen, a stub) and a fake in the tests.
 */

export type GpuBilling = {
  centsPerHour: number;
  /** ISO 4217. */
  currency: string;
  /** The least the provider bills for one instance. */
  minimumSeconds: number;
  /** Billing rounds up to this step (60 for per-minute billing). */
  incrementSeconds: number;
};

export type GpuStartSpec = {
  /** GpuInstance.id: the label the watchdog matches instances by. */
  instanceId: string;
  processingJobId: string;
  image: string;
  /** Ids and signed URLs only: never names or lineups. */
  env: Record<string, string>;
};

export type GpuInstanceState = "starting" | "running" | "exited" | "gone";

export type GpuListedInstance = {
  providerInstanceId: string;
  /** The wideline instance label, or null when the instance has none. */
  instanceId: string | null;
  createdAt: Date;
};

export interface GpuProvider {
  readonly name: string;
  readonly billing: GpuBilling;
  start(spec: GpuStartSpec): Promise<{ providerInstanceId: string }>;
  status(providerInstanceId: string): Promise<GpuInstanceState>;
  /** Idempotent: an instance that is already gone counts as destroyed. */
  destroy(providerInstanceId: string): Promise<void>;
  /** Every instance carrying the wideline label, running or not. */
  list(): Promise<GpuListedInstance[]>;
}

/** The provider is not set up yet (the hourly stub until a provider is chosen). */
export class GpuProviderNotConfigured extends Error {
  constructor(provider: string) {
    super(`GPU provider ${provider} is not configured`);
    this.name = "GpuProviderNotConfigured";
  }
}

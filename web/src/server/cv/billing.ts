import type { GpuBilling } from "./providers/types";

/**
 * GPU cost per instance (NFR04): the seconds a provider bills for a run from
 * start to destroy, and their cost in cents. Both round up, so the recorded
 * cost is never below the bill.
 */

export function billedSeconds(
  start: Date,
  end: Date,
  { minimumSeconds, incrementSeconds }: Pick<GpuBilling, "minimumSeconds" | "incrementSeconds">,
): number {
  const ran = Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 1000));
  const step = Math.max(1, incrementSeconds);
  return Math.max(minimumSeconds, Math.ceil(ran / step) * step);
}

export function costCents(seconds: number, centsPerHour: number): number {
  return Math.ceil((seconds * centsPerHour) / 3600);
}

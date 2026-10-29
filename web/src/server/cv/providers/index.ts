import { cvConfig } from "../config";
import { dockerProvider } from "./docker";
import { hourlyProvider } from "./hourly";
import type { GpuProvider } from "./types";

export type { GpuProvider } from "./types";

let cached: GpuProvider | undefined;

/** The provider CV_DISPATCH names: docker locally, hourly once chosen. */
export function gpuProvider(): GpuProvider {
  cached ??= cvConfig().CV_DISPATCH === "hourly" ? hourlyProvider() : dockerProvider();
  return cached;
}

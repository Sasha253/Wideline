import { describe, expect, it } from "vitest";
import { ffprobeArgs, redactProbeError } from "@/worker/probe";

// The probe worker's ffprobe call (MATCH03): the signed URL never reaches an
// error, a log or the dead-letter queue, and ffprobe opens only network
// protocols with the QuickTime demuxer and a bounded probe.

const URL_SIGNED =
  "http://rustfs:9000/wideline/orgs/o1/matches/m1/raw/v1.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=KEY%2F20261026%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Signature=abc123";

describe("redactProbeError", () => {
  it("replaces the signed URL with the video id", () => {
    const stderr = `${URL_SIGNED}: Server returned 5XX Server Error reply\n[http @ 0x1] HTTP error 503 for ${URL_SIGNED}`;
    const out = redactProbeError(stderr, URL_SIGNED, "v1");
    expect(out).toBe(
      "video v1: Server returned 5XX Server Error reply\n[http @ 0x1] HTTP error 503 for video v1",
    );
    expect(out).not.toMatch(/X-Amz|Signature|abc123|KEY/);
  });

  it("strips the query string of any other URL ffprobe prints", () => {
    const redirected =
      "https://other.example/raw/v1.mp4?X-Amz-Signature=def456&X-Amz-Credential=KEY2";
    const out = redactProbeError(`Redirecting to ${redirected}\n`, URL_SIGNED, "v1");
    expect(out).toBe("Redirecting to https://other.example/raw/v1.mp4?[redacted]\n");
  });
});

describe("ffprobeArgs", () => {
  it("whitelists network protocols, forces the mov demuxer and bounds the probe", () => {
    const args = ffprobeArgs(URL_SIGNED);
    const after = (flag: string) => args[args.indexOf(flag) + 1];
    expect(after("-protocol_whitelist")).toBe("http,https,tcp,tls");
    expect(after("-f")).toBe("mov");
    expect(Number(after("-probesize"))).toBeGreaterThan(0);
    expect(Number(after("-analyzeduration"))).toBeGreaterThan(0);
    expect(args.at(-1)).toBe(URL_SIGNED);
  });
});

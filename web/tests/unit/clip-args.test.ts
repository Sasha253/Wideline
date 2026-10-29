import { describe, expect, it } from "vitest";
import { clipSize, ffmpegClipArgs } from "@/server/clips/cut";
import { clipExpiry } from "@/server/clips/expiry";
import { clipKey } from "@/server/clips/keys";
import { matchPrefix } from "@/server/matches/keys";
import { windowFor } from "@/worker/clips";

// C09 (CV11, Q-045): clip cutting arguments, keys, expiry and windows.

const SOURCE = "https://s3.wideline.localhost/b/raw.mp4?X-Amz-Signature=x";
const HD = { width: 1920, height: 1080 };

describe("ffmpegClipArgs", () => {
  const args = ffmpegClipArgs(SOURCE, "/tmp/c.mp4", { startMs: 55_000, endMs: 63_000 }, HD, true);
  const after = (flag: string) => args[args.indexOf(flag) + 1];

  it("reads through the protocol whitelist with a fixed demuxer, seeking first", () => {
    expect(after("-protocol_whitelist")).toBe("https,http,tcp,tls,file");
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(after("-ss")).toBe("55.000");
    expect(after("-f")).toBe("mov");
    expect(after("-i")).toBe(SOURCE);
    expect(after("-t")).toBe("8.000");
  });

  it("encodes H.264 veryfast CRF 26 with a 2 s GOP, AAC 96k and faststart", () => {
    expect(after("-c:v")).toBe("libx264");
    expect(after("-preset")).toBe("veryfast");
    expect(after("-crf")).toBe("26");
    expect(after("-g")).toBe("50");
    expect(after("-c:a")).toBe("aac");
    expect(after("-b:a")).toBe("96k");
    expect(after("-movflags")).toBe("+faststart");
    expect(args.at(-1)).toBe("/tmp/c.mp4");
  });

  it("scales to a 720p short side", () => {
    expect(after("-vf")).toBe("scale=1280:720");
  });

  it("drops audio when the source has none", () => {
    const silent = ffmpegClipArgs(SOURCE, "/tmp/c.mp4", { startMs: 0, endMs: 1000 }, HD, false);
    expect(silent).toContain("-an");
    expect(silent).not.toContain("aac");
  });
});

describe("clipSize", () => {
  it("never upscales and keeps even sizes", () => {
    expect(clipSize(HD)).toEqual({ width: 1280, height: 720 });
    expect(clipSize({ width: 1280, height: 720 })).toEqual({ width: 1280, height: 720 });
    expect(clipSize({ width: 960, height: 540 })).toEqual({ width: 960, height: 540 });
    expect(clipSize({ width: 1080, height: 1920 })).toEqual({ width: 720, height: 1280 });
  });
});

describe("clipKey and clipExpiry", () => {
  it("keeps clips under the match prefix, one key per event", () => {
    expect(clipKey("org1", "m1", "ev1")).toBe(matchPrefix("org1", "m1") + "clips/ev1.mp4");
  });

  it("expires 14 days after the upload", () => {
    const up = new Date("2026-10-01T08:00:00Z");
    expect(clipExpiry(up).toISOString()).toBe("2026-10-15T08:00:00.000Z");
  });
});

describe("windowFor", () => {
  it("clamps the window to the footage and drops an empty one", () => {
    const w = (start: number | null, end: number | null) =>
      windowFor({ id: "e", clipStartMs: start, clipEndMs: end }, 10_000);
    expect(w(-2000, 3000)).toEqual({ startMs: 0, endMs: 3000 });
    expect(w(8000, 12_000)).toEqual({ startMs: 8000, endMs: 10_000 });
    expect(w(11_000, 12_000)).toBeNull();
    expect(w(null, 12_000)).toBeNull();
  });
});

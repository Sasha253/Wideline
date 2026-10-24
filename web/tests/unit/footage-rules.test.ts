import { describe, expect, it } from "vitest";
import { evaluateFootage } from "@/lib/footage-rules";
import { parseRate, summariseProbe, type FfprobeOutput } from "@/server/matches/probe";

// MATCH03, MATCH04 (C06 acceptance: footage under 1080p is rejected with
// guidance). ffprobe JSON samples, trimmed to the fields the probe reads.

function probe({
  width = 1920,
  height = 1080,
  rate = "25/1",
  avg = rate,
  duration = "5640.0",
  sar = "1:1",
  rotation,
  tagsRotate,
}: {
  width?: number;
  height?: number;
  rate?: string;
  avg?: string;
  duration?: string;
  sar?: string;
  rotation?: number;
  tagsRotate?: string;
} = {}): FfprobeOutput {
  return {
    streams: [
      { codec_type: "audio", codec_name: "aac" },
      {
        codec_type: "video",
        codec_name: "h264",
        width,
        height,
        sample_aspect_ratio: sar,
        r_frame_rate: rate,
        avg_frame_rate: avg,
        ...(tagsRotate && { tags: { rotate: tagsRotate } }),
        ...(rotation !== undefined && {
          side_data_list: [{ side_data_type: "Display Matrix", rotation }],
        }),
      },
    ],
    format: { duration, format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
  };
}

const check = (output: FfprobeOutput, halfLengthMinutes = 45) =>
  evaluateFootage(summariseProbe(output), { halfLengthMinutes });

const codes = (output: FfprobeOutput, half?: number) =>
  check(output, half).issues.map((i) => i.code);

describe("footage rules", () => {
  it("accepts 1920x1080 at 25 fps, 16:9, a full match", () => {
    expect(check(probe())).toEqual({ verdict: "accepted", issues: [] });
  });

  it("rejects 1280x720 with re-film guidance", () => {
    const v = check(probe({ width: 1280, height: 720 }));
    expect(v.verdict).toBe("rejected");
    expect(v.issues).toEqual([
      {
        code: "low_resolution",
        severity: "reject",
        message: "This video is 1280 × 720. Wideline needs at least 1080p (1920 × 1080).",
        guidance:
          "Set the camera to 1080p or higher before the next match, and export at the original quality. Phone apps often shrink exports to 720p.",
      },
    ]);
  });

  it("treats a phone clip rotated by the display matrix as portrait", () => {
    const output = probe({ width: 1920, height: 1080, rotation: -90 });
    expect(summariseProbe(output)).toMatchObject({ width: 1080, height: 1920, rotation: 270 });
    const v = check(output);
    expect(v.verdict).toBe("rejected");
    expect(codes(output)).toContain("portrait");
  });

  it("reads the older rotate tag too", () => {
    expect(summariseProbe(probe({ tagsRotate: "90" }))).toMatchObject({
      width: 1080,
      height: 1920,
    });
  });

  it("warns that 1440x1080 at 4:3 may not be wide-angle", () => {
    const v = check(probe({ width: 1440, height: 1080 }));
    expect(v.verdict).toBe("accepted_with_warnings");
    expect(v.issues.map((i) => i.code)).toEqual(["not_wide"]);
    expect(v.issues[0]!.message).toBe(
      "This video is narrower than 16:9, so it may not show the whole pitch.",
    );
  });

  it("applies the sample aspect ratio: anamorphic 1440x1080 at 4:3 SAR displays 16:9", () => {
    expect(summariseProbe(probe({ width: 1440, height: 1080, sar: "4:3" }))).toMatchObject({
      width: 1920,
      height: 1080,
    });
    expect(check(probe({ width: 1440, height: 1080, sar: "4:3" })).verdict).toBe("accepted");
  });

  it("rejects 15 fps and warns at 24 fps", () => {
    expect(check(probe({ rate: "15/1" })).verdict).toBe("rejected");
    expect(codes(probe({ rate: "15/1" }))).toEqual(["low_fps"]);
    const v = check(probe({ rate: "24000/1001" }));
    expect(v.verdict).toBe("accepted_with_warnings");
    expect(v.issues[0]!.message).toBe(
      "This video runs at 24 frames per second. Tracking works best at 25 or more.",
    );
  });

  it("rejects footage under 5 minutes", () => {
    const v = check(probe({ duration: "250.5" }));
    expect(v.verdict).toBe("rejected");
    expect(v.issues.map((i) => i.code)).toEqual(["too_short"]);
    expect(v.issues[0]!.message).toBe(
      "This video is 4 min long. A match recording needs at least 5 min.",
    );
  });

  it("uses avg_frame_rate for variable frame rate files", () => {
    // A VFR phone file reports a misleading r_frame_rate.
    expect(summariseProbe(probe({ rate: "90000/1", avg: "30000/1001" })).fps).toBeCloseTo(29.97);
    expect(check(probe({ rate: "90000/1", avg: "30000/1001" })).verdict).toBe("accepted");
    expect(parseRate("0/0")).toBeNull();
  });

  it("accepts 32:9 panoramic footage", () => {
    expect(check(probe({ width: 3840, height: 1080 })).verdict).toBe("accepted");
  });

  it("warns on a duration that does not fit the half length", () => {
    expect(codes(probe({ duration: String(40 * 60) }))).toEqual(["duration_short"]);
    expect(codes(probe({ duration: String(40 * 60) }), 20)).toEqual([]);
    expect(codes(probe({ duration: String(160 * 60) }))).toEqual(["duration_long"]);
  });

  it("rejects a file with no video stream, or one ffprobe cannot read", () => {
    const audioOnly: FfprobeOutput = {
      streams: [{ codec_type: "audio" }],
      format: { duration: "5400" },
    };
    expect(check(audioOnly).issues.map((i) => i.code)).toEqual(["no_video"]);
    expect(evaluateFootage(null, { halfLengthMinutes: 45 })).toMatchObject({
      verdict: "rejected",
      issues: [{ code: "unreadable" }],
    });
  });

  it("leaves cover art out", () => {
    const withCover: FfprobeOutput = {
      streams: [
        { codec_type: "video", width: 300, height: 300, disposition: { attached_pic: 1 } },
        ...probe().streams!,
      ],
      format: probe().format,
    };
    expect(check(withCover).verdict).toBe("accepted");
  });
});

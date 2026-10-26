import { describe, expect, it } from "vitest";
import { matchPrefix } from "@/server/matches/keys";
import {
  contentTypeFor,
  ffmpegArgs,
  FILE_PATTERN,
  hlsKeys,
  ladderFor,
  normaliseInitName,
  progressMs,
  RENDITION_NAMES,
  RENDITIONS,
} from "@/server/transcode/ladder";

// C07 (MATCH06, NFR03): the HLS ladder and ffmpeg's arguments. One process,
// network protocols only, the QuickTime demuxer, a keyframe every 2 s, 4 s
// fMP4 segments, and output under the match prefix.

const URL_SIGNED = "http://rustfs:9000/wideline/orgs/o1/matches/m1/raw/v1.mp4?X-Amz-Signature=abc";

describe("ladderFor", () => {
  it("never upscales", () => {
    expect(ladderFor(1080).map((r) => r.name)).toEqual(["1080p", "720p", "480p"]);
    expect(ladderFor(2160).map((r) => r.name)).toEqual(["1080p", "720p", "480p"]);
    expect(ladderFor(720).map((r) => r.name)).toEqual(["720p", "480p"]);
    expect(ladderFor(1079).map((r) => r.name)).toEqual(["720p", "480p"]);
    expect(ladderFor(360).map((r) => r.name)).toEqual(["480p"]);
    expect(ladderFor(null).map((r) => r.name)).toEqual(["1080p", "720p", "480p"]);
  });

  it("is highest first with falling bitrates", () => {
    const rates = RENDITIONS.map((r) => r.videoKbps);
    expect(rates).toEqual([...rates].sort((a, b) => b - a));
    for (const r of RENDITIONS) expect(r.maxKbps).toBeGreaterThan(r.videoKbps);
  });
});

describe("ffmpegArgs", () => {
  const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

  it("whitelists network protocols and forces the mov demuxer before the input", () => {
    const args = ffmpegArgs(URL_SIGNED, "/tmp/out", ladderFor(1080), true);
    const input = args.indexOf("-i");
    expect(after(args, "-protocol_whitelist")).toBe("http,https,tcp,tls");
    expect(args.indexOf("-protocol_whitelist")).toBeLessThan(input);
    expect(after(args, "-f")).toBe("mov");
    expect(args.indexOf("-f")).toBeLessThan(input);
    expect(args[input + 1]).toBe(URL_SIGNED);
    expect(args).toContain("-reconnect");
  });

  it("keyframes every 2 s with no scene cuts, and 4 s fMP4 VOD segments", () => {
    const args = ffmpegArgs(URL_SIGNED, "/tmp/out", ladderFor(1080), true);
    expect(after(args, "-force_key_frames")).toBe("expr:gte(t,n_forced*2)");
    expect(after(args, "-sc_threshold")).toBe("0");
    expect(after(args, "-c:v")).toBe("libx264");
    expect(after(args, "-preset")).toBe("veryfast");
    expect(after(args, "-hls_time")).toBe("4");
    expect(after(args, "-hls_playlist_type")).toBe("vod");
    expect(after(args, "-hls_segment_type")).toBe("fmp4");
    expect(after(args, "-hls_flags")).toBe("independent_segments");
    expect(after(args, "-master_pl_name")).toBe("master.m3u8");
    expect(after(args, "-hls_segment_filename")).toBe("/tmp/out/%v/seg_%05d.m4s");
    expect(args.at(-1)).toBe("/tmp/out/%v/index.m3u8");
    expect(after(args, "-progress")).toBe("pipe:1");
  });

  it("names every rendition in var_stream_map, with audio when the source has it", () => {
    const withAudio = ffmpegArgs(URL_SIGNED, "/o", ladderFor(1080), true);
    expect(after(withAudio, "-var_stream_map")).toBe(
      "v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:480p",
    );
    expect(after(withAudio, "-c:a")).toBe("aac");
    expect(after(withAudio, "-b:a")).toBe("96k");
    expect(withAudio.filter((a) => a === "0:a:0")).toHaveLength(3);
    expect(after(withAudio, "-filter_complex")).toBe(
      "[0:v]split=3[s0][s1][s2];[s0]scale=-2:1080[v0];[s1]scale=-2:720[v1];[s2]scale=-2:480[v2]",
    );
    expect(after(withAudio, "-b:v:0")).toBe("5000k");
    expect(after(withAudio, "-maxrate:v:2")).toBe("1300k");

    const silent = ffmpegArgs(URL_SIGNED, "/o", ladderFor(720), false);
    expect(after(silent, "-var_stream_map")).toBe("v:0,name:720p v:1,name:480p");
    expect(silent).not.toContain("-c:a");
    expect(silent).not.toContain("0:a:0");
  });

  it("scales a one-rendition ladder without a split", () => {
    const args = ffmpegArgs(URL_SIGNED, "/o", ladderFor(480), false);
    expect(after(args, "-filter_complex")).toBe("[0:v]scale=-2:480[v0]");
  });
});

describe("hlsKeys", () => {
  it("sits under the match prefix, and its files match FILE_PATTERN", () => {
    const keys = hlsKeys("org1", "match1", "vid1");
    expect(keys.prefix.startsWith(matchPrefix("org1", "match1"))).toBe(true);
    expect(keys.master).toBe("orgs/org1/matches/match1/hls/vid1/master.m3u8");
    expect(keys.file("720p", "seg_00012.m4s")).toBe(
      "orgs/org1/matches/match1/hls/vid1/720p/seg_00012.m4s",
    );
    for (const f of ["index.m3u8", "init.mp4", "seg_00000.m4s", "seg_99999.m4s"]) {
      expect(FILE_PATTERN.test(f)).toBe(true);
    }
    for (const f of ["master.m3u8", "../raw/v.mp4", "seg_1.m4s", "init_0.mp4", "index.m3u8x"]) {
      expect(FILE_PATTERN.test(f)).toBe(false);
    }
    expect(RENDITION_NAMES).toEqual(["1080p", "720p", "480p"]);
  });
});

describe("helpers", () => {
  it("points the playlist at init.mp4 and reads ffmpeg progress", () => {
    expect(normaliseInitName('#EXT-X-MAP:URI="init_2.mp4"\nseg_00000.m4s\n', "init_2.mp4")).toBe(
      '#EXT-X-MAP:URI="init.mp4"\nseg_00000.m4s\n',
    );
    expect(progressMs("out_time_us=5920000")).toBe(5920);
    expect(progressMs("frame=12")).toBeNull();
    expect(contentTypeFor("index.m3u8")).toBe("application/vnd.apple.mpegurl");
    expect(contentTypeFor("init.mp4")).toBe("video/mp4");
    expect(contentTypeFor("seg_00000.m4s")).toBe("video/iso.segment");
  });
});

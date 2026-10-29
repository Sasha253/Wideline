// No "server-only" marker: the clips worker (plain Node, src/worker/clips.ts)
// runs this.
import { spawn } from "node:child_process";

/**
 * Cutting one event clip with ffmpeg (C09; CV11, Q-045). Pure argument
 * building plus a runner, so the worker and its tests share them.
 *
 * Each clip is cut from the raw footage (A-8) with an input seek, read
 * through the C06 protocol whitelist with a fixed demuxer, scaled down to a
 * 720p short side (never up), H.264 veryfast CRF 26 with a 2 s GOP, AAC
 * 96 kbit/s when the source has audio (Q-030, Q-045), and +faststart so a
 * browser can play it while it downloads. Draft constants (A-16).
 */

export const CLIP_SHORT_SIDE = 720;
export const CLIP_CRF = 26;
export const CLIP_GOP = 50;
export const CLIP_AUDIO_BITRATE = "96k";
/** One clip should take seconds; this stops a stuck read. */
export const CLIP_TIMEOUT_MS = 10 * 60 * 1000;
const STDERR_TAIL = 2000;

export type ClipWindow = { startMs: number; endMs: number };
export type SourceSize = { width: number; height: number };

/** The clip's output size: the short side at most 720, even dimensions, aspect kept. */
export function clipSize({ width, height }: SourceSize): SourceSize {
  const short = Math.min(width, height);
  const scale = short > CLIP_SHORT_SIDE ? CLIP_SHORT_SIDE / short : 1;
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** ffmpeg arguments for one clip, written to `outPath`. */
export function ffmpegClipArgs(
  url: string,
  outPath: string,
  window: ClipWindow,
  source: SourceSize,
  hasAudio: boolean,
): string[] {
  const { width, height } = clipSize(source);
  const seconds = (ms: number) => (ms / 1000).toFixed(3);
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-protocol_whitelist",
    "https,http,tcp,tls,file",
    "-ss",
    seconds(window.startMs),
    "-f",
    "mov",
    "-i",
    url,
    "-t",
    seconds(window.endMs - window.startMs),
    "-map",
    "0:v:0",
    ...(hasAudio ? ["-map", "0:a:0?"] : []),
    "-vf",
    `scale=${width}:${height}`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    String(CLIP_CRF),
    "-g",
    String(CLIP_GOP),
    "-pix_fmt",
    "yuv420p",
    ...(hasAudio ? ["-c:a", "aac", "-b:a", CLIP_AUDIO_BITRATE] : ["-an"]),
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    outPath,
  ];
}

/** Runs ffmpeg with no shell. The error carries the end of stderr (redact it before storing). */
export function runFfmpegClip(args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: CLIP_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else {
        const why = signal ? `killed by ${signal}` : `exit code ${code}`;
        reject(new Error(`ffmpeg clip failed (${why}): ${stderr.trim()}`));
      }
    });
  });
}

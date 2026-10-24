import type { ProbeSummary } from "@/lib/footage-rules";

// Reads `ffprobe -print_format json -show_format -show_streams` output into a
// ProbeSummary for evaluateFootage() (MATCH03). Pure, so it is unit tested
// with JSON samples; the worker (src/worker/probe.ts) runs ffprobe. No
// "server-only" marker: the worker imports it.

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  sample_aspect_ratio?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  tags?: Record<string, string | undefined>;
  side_data_list?: { side_data_type?: string; rotation?: number | string }[];
  disposition?: Record<string, number | undefined>;
};

export type FfprobeOutput = {
  streams?: FfprobeStream[];
  format?: { duration?: string; format_name?: string };
};

/** "30000/1001" to 29.97; "0/0", "" and nonsense to null. */
export function parseRate(rate: string | undefined): number | null {
  if (!rate) return null;
  const [n, d = "1"] = rate.split("/");
  const value = Number(n) / Number(d);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** "16:9" or "4:3" sample aspect ratio as a number; 1 when missing or "0:1". */
function parseRatio(ratio: string | undefined): number {
  if (!ratio) return 1;
  const [n, d] = ratio.split(":").map(Number);
  const value = (n ?? 0) / (d ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * Clockwise rotation the player applies: 0, 90, 180 or 270. Newer ffprobe
 * puts it in the display matrix side data (as -90 for a phone held upright);
 * older files carry tags.rotate.
 */
export function rotationOf(stream: FfprobeStream): number {
  const matrix = stream.side_data_list?.find(
    (s) => s.side_data_type === "Display Matrix" && s.rotation !== undefined,
  );
  const raw = matrix ? Number(matrix.rotation) : Number(stream.tags?.rotate ?? 0);
  if (!Number.isFinite(raw)) return 0;
  const quarter = Math.round(raw / 90) * 90;
  return ((quarter % 360) + 360) % 360;
}

function positive(value: string | undefined): number | null {
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The first real video stream (cover art is left out), with the display size
 * after the sample aspect ratio and rotation, the average frame rate (variable
 * frame rate files report a misleading r_frame_rate) and the duration.
 */
export function summariseProbe(output: FfprobeOutput): ProbeSummary {
  const stream = (output.streams ?? []).find(
    (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
  );
  if (!stream) {
    return {
      hasVideo: false,
      durationSec: positive(output.format?.duration),
      width: null,
      height: null,
      fps: null,
      displayAspect: null,
      codec: null,
      rotation: 0,
    };
  }
  const rotation = rotationOf(stream);
  let width: number | null = null;
  let height: number | null = null;
  if (stream.width && stream.height) {
    const sar = parseRatio(stream.sample_aspect_ratio);
    const w = Math.round(stream.width * sar);
    const h = stream.height;
    [width, height] = rotation === 90 || rotation === 270 ? [h, w] : [w, h];
  }
  return {
    hasVideo: true,
    durationSec: positive(output.format?.duration) ?? positive(stream.duration),
    width,
    height,
    fps: parseRate(stream.avg_frame_rate) ?? parseRate(stream.r_frame_rate),
    displayAspect: width && height ? width / height : null,
    codec: stream.codec_name ?? null,
    rotation,
  };
}

/**
 * ffprobe's error output for a file it cannot read at all: the footage is
 * rejected as unreadable. Anything else (network, timeout) is transient and
 * the job retries.
 */
export function isUnreadableFile(stderr: string): boolean {
  return /Invalid data found|moov atom not found|could not find codec parameters|Invalid argument|End of file|Server returned 404/i.test(
    stderr,
  );
}

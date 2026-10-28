import { matchPrefix } from "../matches/keys";

/**
 * The HLS ladder (MATCH06, NFR03; C07). One ffmpeg run turns the raw footage
 * into up to three fMP4 renditions with 4 s segments and a keyframe every 2 s,
 * so a seek lands on a keyframe in under 1 s. Pure: no I/O, so the playback
 * routes, the worker and the unit tests share it. No "server-only" marker, for
 * the worker.
 *
 * Storage layout, under the match prefix so the match_deleted purge
 * (src/worker/retention.ts) removes it with everything else:
 *
 *   orgs/{org}/matches/{match}/hls/{videoId}/master.m3u8
 *   orgs/{org}/matches/{match}/hls/{videoId}/{rendition}/index.m3u8
 *   orgs/{org}/matches/{match}/hls/{videoId}/{rendition}/init.mp4
 *   orgs/{org}/matches/{match}/hls/{videoId}/{rendition}/seg_00000.m4s …
 */

export type Rendition = {
  name: RenditionName;
  height: number;
  videoKbps: number;
  maxKbps: number;
};

/** Highest first. Bitrates are drafts for the pilot's storage budget (NFR05). */
export const RENDITIONS = [
  { name: "1080p", height: 1080, videoKbps: 5000, maxKbps: 5350 },
  { name: "720p", height: 720, videoKbps: 2800, maxKbps: 3000 },
  { name: "480p", height: 480, videoKbps: 1200, maxKbps: 1300 },
] as const satisfies readonly {
  name: string;
  height: number;
  videoKbps: number;
  maxKbps: number;
}[];

export type RenditionName = (typeof RENDITIONS)[number]["name"];

export const RENDITION_NAMES: readonly RenditionName[] = RENDITIONS.map((r) => r.name);

/** Every file a rendition directory may hold: its playlist, its init segment and media segments. */
export const FILE_PATTERN = /^(?:index\.m3u8|init\.mp4|seg_\d{5}\.m4s)$/;

export const MASTER_PLAYLIST = "master.m3u8";
export const MEDIA_PLAYLIST = "index.m3u8";
export const INIT_SEGMENT = "init.mp4";

/** Segment length in seconds, and the keyframe interval inside it. */
export const SEGMENT_SEC = 4;
export const KEYFRAME_SEC = 2;
export const AUDIO_KBPS = 96;

export function isRenditionName(name: string): name is RenditionName {
  return (RENDITION_NAMES as readonly string[]).includes(name);
}

/**
 * The renditions for a source of this height, highest first. Never upscales:
 * a 1080p source gets all three, 720p gets 720p and 480p. A source below the
 * lowest rung (C06 rejects those, so only a test) gets the lowest rung alone.
 */
export function ladderFor(sourceHeight: number | null): Rendition[] {
  const all = RENDITIONS as readonly Rendition[];
  if (!sourceHeight) return [...all];
  const fits = all.filter((r) => r.height <= sourceHeight);
  return fits.length ? fits : [all.at(-1)!];
}

/** Object keys for one video's HLS output. */
export function hlsKeys(organisationId: string, matchId: string, videoId: string) {
  const prefix = `${matchPrefix(organisationId, matchId)}hls/${videoId}/`;
  return {
    prefix,
    master: `${prefix}${MASTER_PLAYLIST}`,
    /** The key of one file in a rendition directory. */
    file: (rendition: RenditionName, file: string) => `${prefix}${rendition}/${file}`,
  };
}

/** The Content-Type each HLS file is stored and served with. */
export function contentTypeFor(file: string): string {
  if (file.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (file.endsWith(".m4s")) return "video/iso.segment";
  return "video/mp4";
}

/**
 * ffmpeg's arguments for the whole ladder in one process. The input is a
 * signed URL: only network protocols may be opened (no file:, concat: or
 * subfile: tricks from a crafted file), the demuxer is forced to the QuickTime
 * one (MP4 and MOV both), and dropped connections reconnect. Each rendition is
 * H.264 (x264 veryfast, yuv420p for every browser) with a keyframe every 2 s
 * and no scene-cut keyframes, so segments line up across renditions; AAC 96k
 * when the source has audio. Output goes to `outDir`, one directory per
 * rendition; progress is written to stdout as key=value lines. `threads`
 * caps the encoder and filter threads (TRANSCODE_THREADS), since three x264
 * encoders on every core can exhaust a small Docker VM's memory.
 */
export function ffmpegArgs(
  url: string,
  outDir: string,
  ladder: readonly Rendition[],
  hasAudio: boolean,
  threads: number = transcodeThreads(),
): string[] {
  const n = ladder.length;
  const split =
    n === 1
      ? `[0:v]scale=-2:${ladder[0]!.height}[v0]`
      : `[0:v]split=${n}${ladder.map((_, i) => `[s${i}]`).join("")};` +
        ladder.map((r, i) => `[s${i}]scale=-2:${r.height}[v${i}]`).join(";");

  const args = [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-protocol_whitelist",
    "http,https,tcp,tls",
    "-reconnect",
    "1",
    "-reconnect_on_network_error",
    "1",
    "-reconnect_delay_max",
    "30",
    "-f",
    "mov",
    "-i",
    url,
    "-filter_complex_threads",
    String(threads),
    "-filter_complex",
    split,
  ];
  ladder.forEach((r, i) => {
    args.push("-map", `[v${i}]`);
    if (hasAudio) args.push("-map", "0:a:0");
    args.push(
      `-b:v:${i}`,
      `${r.videoKbps}k`,
      `-maxrate:v:${i}`,
      `${r.maxKbps}k`,
      `-bufsize:v:${i}`,
      `${r.maxKbps * 2}k`,
    );
  });
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-force_key_frames",
    `expr:gte(t,n_forced*${KEYFRAME_SEC})`,
    "-sc_threshold",
    "0",
    "-threads",
    String(threads),
  );
  if (hasAudio) args.push("-c:a", "aac", "-b:a", `${AUDIO_KBPS}k`, "-ac", "2");
  args.push(
    "-f",
    "hls",
    "-hls_time",
    String(SEGMENT_SEC),
    "-hls_playlist_type",
    "vod",
    "-hls_segment_type",
    "fmp4",
    "-hls_flags",
    "independent_segments",
    "-hls_fmp4_init_filename",
    INIT_SEGMENT,
    "-hls_segment_filename",
    `${outDir}/%v/seg_%05d.m4s`,
    "-master_pl_name",
    MASTER_PLAYLIST,
    "-var_stream_map",
    ladder.map((r, i) => (hasAudio ? `v:${i},a:${i}` : `v:${i}`) + `,name:${r.name}`).join(" "),
    "-progress",
    "pipe:1",
    "-nostats",
    `${outDir}/%v/${MEDIA_PLAYLIST}`,
  );
  return args;
}

/** Default ffmpeg thread cap when TRANSCODE_THREADS is unset or invalid. */
export const DEFAULT_TRANSCODE_THREADS = 2;

/** ffmpeg's thread cap from TRANSCODE_THREADS: a positive integer, else the default. */
export function transcodeThreads(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.TRANSCODE_THREADS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_TRANSCODE_THREADS;
}

/**
 * ffmpeg names a rendition's init segment init_{index}.mp4 when the ladder has
 * more than one rendition. Returns the media playlist with its EXT-X-MAP
 * pointing at init.mp4 instead; the worker renames the file to match.
 */
export function normaliseInitName(playlist: string, actual: string): string {
  return playlist.split(`URI="${actual}"`).join(`URI="${INIT_SEGMENT}"`);
}

/** The out_time ffmpeg's -progress reports, in ms, or null for any other line. */
export function progressMs(line: string): number | null {
  const m = /^out_time_us=(\d+)$/.exec(line.trim());
  return m ? Math.floor(Number(m[1]) / 1000) : null;
}

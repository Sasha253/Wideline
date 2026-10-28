import "server-only";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AuthContext } from "../auth/session";
import { bucket, s3Internal, s3Public } from "../storage";
import {
  contentTypeFor,
  FILE_PATTERN,
  INIT_SEGMENT,
  isRenditionName,
  MASTER_PLAYLIST,
  MEDIA_PLAYLIST,
  type RenditionName,
} from "../transcode/ladder";
import { requireSquadOrg } from "./access";

/**
 * Secure playback (MATCH06, NFR17; docs/build/design/C07.md). Footage is
 * private: the browser never gets a bucket URL in a playlist. The app serves
 * the master and media playlists itself, rewritten so every entry points at a
 * session-checked app route (/api/matches/{id}/hls/...), with no-store; the
 * init and media segment routes answer 302 to a GET presigned for 60 s
 * (HLS_SEGMENT_URL_TTL_SEC). A long session never holds stale URLs, and access
 * ends on the next request when the role (or, from C10/C11, the review claim)
 * goes. An expired presigned URL gets 403 from the store.
 */

/** Who is watching. C10/C11 add a scout with a review claim. */
export type Viewer = { kind: "club"; ctx: AuthContext };

export type PlayableVideo = {
  videoId: string;
  /** The object key prefix of the HLS output, ending in "/". */
  prefix: string;
};

/** Seconds a presigned segment URL lasts: HLS_SEGMENT_URL_TTL_SEC, default 60. */
export function segmentUrlTtlSec(): number {
  const v = Number(process.env.HLS_SEGMENT_URL_TTL_SEC);
  return Number.isInteger(v) && v > 0 && v <= 3600 ? v : 60;
}

/**
 * The match's playable video for a club member: accepted, not deleted, with
 * an HLS manifest. Read through the scoped client, so another organisation's
 * match is null. Null too before the transcode finishes.
 */
export async function playableVideo(
  ctx: AuthContext,
  matchId: string,
): Promise<PlayableVideo | null> {
  requireSquadOrg(ctx);
  const video = await ctx.db.video.findFirst({
    where: { matchId, status: "accepted", deletedAt: null, hlsManifestPath: { not: null } },
    select: { id: true, hlsManifestPath: true },
  });
  const path = video?.hlsManifestPath;
  if (!video || !path) return null;
  const suffix = `/hls/${video.id}/${MASTER_PLAYLIST}`;
  // Defence in depth: the key must be this organisation's and this video's.
  if (
    !path.startsWith(`orgs/${ctx.organisationId}/matches/${matchId}/`) ||
    !path.endsWith(suffix)
  ) {
    return null;
  }
  return { videoId: video.id, prefix: path.slice(0, -MASTER_PLAYLIST.length) };
}

/** The playable video for this viewer, or null. One entry point for C10/C11's claim viewer. */
export async function canPlay(viewer: Viewer, matchId: string): Promise<PlayableVideo | null> {
  switch (viewer.kind) {
    case "club":
      return playableVideo(viewer.ctx, matchId);
  }
}

export class PlaylistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaylistError";
  }
}

const base = (matchId: string) => `/api/matches/${encodeURIComponent(matchId)}/hls`;

/** Maps each line of a playlist, keeping line endings, comments and tags byte for byte. */
function mapLines(text: string, uri: (line: string) => string, tag: (line: string) => string) {
  return text
    .split("\n")
    .map((raw) => {
      const cr = raw.endsWith("\r") ? "\r" : "";
      const line = cr ? raw.slice(0, -1) : raw;
      if (line.trim() === "") return raw;
      return (line.startsWith("#") ? tag(line) : uri(line.trim())) + cr;
    })
    .join("\n");
}

/** Rewrites every URI="..." attribute of a tag. */
function mapTagUris(line: string, uri: (value: string) => string): string {
  return line.replace(/URI="([^"]*)"/g, (_, value: string) => `URI="${uri(value)}"`);
}

/** "720p/index.m3u8" as a rendition name, or a PlaylistError. */
function renditionOf(entry: string): RenditionName {
  const m = /^([^/]+)\/index\.m3u8$/.exec(entry);
  const name = m?.[1] ?? "";
  if (!isRenditionName(name)) throw new PlaylistError("unexpected master playlist entry");
  return name;
}

/**
 * The master playlist with every variant pointing at its app route. Only the
 * video renditions are accepted: any other entry, including an EXT-X-MEDIA
 * URI (so HLS subtitle renditions are not supported; captions come from
 * WebVTT <track>s on the player), throws PlaylistError. A playlist can never
 * point at raw footage or another key.
 */
export function rewriteMasterPlaylist(text: string, matchId: string): string {
  const to = (entry: string) => `${base(matchId)}/${renditionOf(entry)}/${MEDIA_PLAYLIST}`;
  return mapLines(text, to, (line) => mapTagUris(line, to));
}

/**
 * A rendition's media playlist with its init segment and media segments
 * pointing at their app routes. Throws PlaylistError for any entry outside
 * FILE_PATTERN (a path, a URL, another playlist).
 */
export function rewriteMediaPlaylist(
  text: string,
  matchId: string,
  rendition: RenditionName,
): string {
  if (!isRenditionName(rendition)) throw new PlaylistError("unknown rendition");
  const to = (entry: string) => {
    if (!FILE_PATTERN.test(entry) || entry === MEDIA_PLAYLIST) {
      throw new PlaylistError("unexpected media playlist entry");
    }
    return `${base(matchId)}/${rendition}/${entry}`;
  };
  return mapLines(text, to, (line) =>
    line.startsWith("#EXT-X-MAP:")
      ? mapTagUris(line, (v) => {
          if (v !== INIT_SEGMENT) throw new PlaylistError("unexpected init segment");
          return to(v);
        })
      : line,
  );
}

/** A playlist's text from object storage (server-side, internal endpoint). */
export async function readPlaylist(key: string): Promise<string> {
  const res = await s3Internal().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  if (!res.Body) throw new Error("playlist has no body");
  return res.Body.transformToString("utf-8");
}

/** A short-lived GET URL for one HLS file, signed for the public S3 host (NFR17). */
export async function signedSegmentUrl(
  key: string,
  file: string,
  ttlSec = segmentUrlTtlSec(),
): Promise<string> {
  return getSignedUrl(
    s3Public(),
    new GetObjectCommand({ Bucket: bucket(), Key: key, ResponseContentType: contentTypeFor(file) }),
    { expiresIn: ttlSec },
  );
}

/** Playback answers are never cached: playlists and redirects are per session. */
export const NO_STORE = { "Cache-Control": "no-store, private" } as const;

export const PLAYLIST_TYPE = "application/vnd.apple.mpegurl";

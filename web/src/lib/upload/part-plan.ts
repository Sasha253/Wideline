// The multipart plan shared by the uploader (multipart-client.ts) and the
// upload service (src/server/matches/upload.ts). Client-safe and pure
// (MATCH02, NFR26; docs/build/design/C06.md, Surface 3).

const MiB = 1024 * 1024;

/** The smallest part: 8 MiB. S3 needs at least 5 MiB for every part but the last. */
export const MIN_PART_SIZE = 8 * MiB;

/** S3's limit on parts per multipart upload. */
export const MAX_PARTS = 10_000;

/** Parts in flight at once in the browser. */
export const PARALLEL_PARTS = 3;

/** Most part URLs the server signs per request. */
export const MAX_PRESIGN_BATCH = 50;

/**
 * Bytes per part for a file: 8 MiB, or more for a file so big it would need
 * more than MAX_PARTS parts, rounded up to a whole MiB.
 */
export function partSizeFor(size: number): number {
  const needed = Math.ceil(size / MAX_PARTS);
  return Math.max(MIN_PART_SIZE, Math.ceil(needed / MiB) * MiB);
}

/** How many parts a file of this size has with this part size. */
export function partCount(size: number, partSize: number): number {
  return Math.max(1, Math.ceil(size / partSize));
}

/** Byte range [start, end) of a 1-based part. */
export function partRange(
  partNumber: number,
  size: number,
  partSize: number,
): { start: number; end: number } {
  const start = (partNumber - 1) * partSize;
  return { start, end: Math.min(size, start + partSize) };
}

export type VideoKind = "mp4" | "mov";

/** Accepted video files, by extension, with the MIME types browsers report for them. */
export const ACCEPTED_TYPES: Record<VideoKind, { mime: string; label: string }> = {
  mp4: { mime: "video/mp4", label: "MP4" },
  mov: { mime: "video/quicktime", label: "MOV" },
};

/** The file input's accept attribute. */
export const ACCEPT_ATTRIBUTE = ".mp4,.mov,video/mp4,video/quicktime";

// Some systems report no type, or a generic one, for a .mov file.
const GENERIC_MIME = new Set(["", "application/octet-stream"]);

/**
 * "mp4" or "mov" when the file is one, by its extension and its MIME type;
 * null for anything else. The extension decides; a MIME type that names
 * another format refuses the file.
 */
export function videoKind(fileName: string, mime: string): VideoKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName.trim())?.[1]?.toLowerCase();
  if (ext !== "mp4" && ext !== "mov") return null;
  const type = mime.trim().toLowerCase();
  if (GENERIC_MIME.has(type)) return ext;
  const ok = Object.values(ACCEPTED_TYPES).some((t) => t.mime === type);
  return ok ? ext : null;
}

/** The fingerprint input: name, size and last-modified time, so the same file resumes. */
export function fingerprintSource(file: {
  name: string;
  size: number;
  lastModified: number;
}): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

// Redaction of worker error text (C06 probe, C07 transcode). No "server-only"
// marker: the worker imports it.

/**
 * Takes a signed URL out of ffprobe's or ffmpeg's stderr before it reaches an
 * error, a log, a ProcessingJob row or the dead-letter queue: the URL is a
 * bearer credential for the footage. The exact URL becomes the video id; any
 * other URL left (a redirect, a partly encoded copy) is cut down to its path,
 * without the query string.
 */
export function redactProbeError(stderr: string, url: string, videoId: string): string {
  const named = url ? stderr.split(url).join(`video ${videoId}`) : stderr;
  return named.replace(/(https?:\/\/[^\s?'"]*)\?[^\s'"]*/g, "$1?[redacted]");
}

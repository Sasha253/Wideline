// The best-effort check before an upload (docs/build/design/C06.md, Surface 3,
// "File summary and pre-check"): read the video's frame size in the browser,
// so a coach on mobile data learns before sending 8 GB that the footage will
// be rejected. The worker's ffprobe check stays authoritative. MOV files often
// cannot be read in the browser; that is not a warning.

export type Precheck =
  | { kind: "ok" }
  | { kind: "unreadable" }
  | { kind: "low_resolution"; width: number; height: number }
  | { kind: "portrait" };

/** The verdict for a frame size: portrait first, then under 1080 on the short side. */
export function precheckSize(width: number, height: number): Precheck {
  if (!width || !height) return { kind: "unreadable" };
  if (height > width) return { kind: "portrait" };
  if (Math.min(width, height) < 1080) return { kind: "low_resolution", width, height };
  return { kind: "ok" };
}

/** Reads the file's metadata through a <video> element, giving up after 5 s. */
export function precheckFile(file: Blob, timeoutMs = 5000): Promise<Precheck> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (result: Precheck) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ kind: "unreadable" }), timeoutMs);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => finish(precheckSize(video.videoWidth, video.videoHeight));
    video.onerror = () => finish({ kind: "unreadable" });
    video.src = url;
  });
}

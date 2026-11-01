"use client";

import { Check, Pause, Play, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icons";
import { formatEta, formatSize } from "@/lib/labels";
import { Track } from "./UploadPanel";
import { useUpload } from "./upload-store";

/**
 * The upload strip at the top of the lineup and marker steps (Screens A, "Upload · lineup"):
 * the file, a lime track, the figures in mono and Pause or Resume, while the upload started
 * on the upload page keeps running. Nothing shows when no upload runs in this tab.
 */
export function UploadStrip({ matchId }: { matchId: string }) {
  const router = useRouter();
  const active = useUpload(matchId);
  const done = active?.done;
  const uploader = active?.uploader;

  // Finished while the coach was on this step: refresh the steps, then forget it. A
  // failure is left for the upload page, which explains it.
  useEffect(() => {
    if (!done || !uploader) return;
    let live = true;
    void done.then((end) => {
      if (!live || end.phase !== "complete") return;
      router.refresh();
    });
    return () => {
      live = false;
    };
  }, [done, uploader, router]);

  if (!active) return null;
  const { snap } = active;
  const paused = snap.phase === "paused";
  const stalled = paused || snap.phase === "offline" || snap.phase === "retrying";
  const complete = snap.phase === "complete";
  const failed = snap.phase === "error" || snap.phase === "cancelled";
  const percent = snap.phase === "finishing" || complete ? 100 : snap.percent;
  const figures = [
    `${formatSize(snap.sentBytes)} of ${formatSize(snap.totalBytes)}`,
    `${percent}%`,
    snap.etaSec !== null && !stalled && !complete ? `about ${formatEta(snap.etaSec)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // Screen readers hear each 10% step only.
  const spoken = Math.floor(percent / 10) * 10;

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-3.5 gap-y-2 border border-line bg-panel px-7 py-3 touch:px-4">
      <span role="status" className="sr-only">
        {complete
          ? "Upload complete."
          : failed
            ? "The upload stopped."
            : stalled
              ? `Upload paused at ${percent}%.`
              : spoken > 0
                ? `Uploaded ${spoken}%`
                : ""}
      </span>
      {complete ? (
        <span
          aria-hidden
          className="grid size-5 shrink-0 place-items-center rounded-full bg-confirmed text-on-status"
        >
          <Check {...iconProps} size={12} />
        </span>
      ) : (
        <Upload {...iconProps} aria-hidden className="shrink-0" />
      )}
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-mono text-body-s font-medium">{snap.fileName}</span>
        <span className="text-body-s text-ink-muted">
          {complete ? (
            "Upload complete"
          ) : failed ? (
            <>
              The upload stopped.{" "}
              <Link
                href={`/matches/${matchId}/upload`}
                className="text-brand-text underline underline-offset-3"
              >
                Open the upload
              </Link>
            </>
          ) : (
            "Keeps uploading while you work. After a dropped connection it carries on from where it stopped."
          )}
        </span>
      </span>
      {!complete && !failed && (
        <>
          <Track percent={percent} live={!stalled} className="min-w-30 flex-1 touch:basis-full" />
          <span className="font-mono text-body-s font-semibold whitespace-nowrap tabular-nums">
            {figures}
          </span>
          <Button
            variant="secondary"
            size="s"
            icon={paused ? Play : Pause}
            className="touch:h-control-l"
            disabled={snap.phase === "finishing"}
            onClick={() => (paused ? active.uploader.resume() : active.uploader.pause())}
          >
            {paused ? "Resume" : "Pause"}
          </Button>
        </>
      )}
    </div>
  );
}

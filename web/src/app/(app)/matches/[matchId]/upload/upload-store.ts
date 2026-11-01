"use client";

import { useSyncExternalStore } from "react";
import {
  MultipartUploader,
  type UploadFile,
  type UploadSnapshot,
} from "@/lib/upload/multipart-client";

/**
 * The running upload of each match, kept in the browser outside any page (Screens A,
 * "Upload · lineup"): the coach can move on to the lineup and markers while it uploads,
 * and the upload strip on those pages shows the same uploader. It lives as long as the
 * tab does; a reload drops it, and the upload page resumes from the server's parts.
 */
export type ActiveUpload = {
  uploader: MultipartUploader;
  snap: UploadSnapshot;
  /** start()'s result: resolves once the upload completes, is cancelled or fails. */
  done: Promise<UploadSnapshot>;
};

const uploads = new Map<string, ActiveUpload>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

const TERMINAL: UploadSnapshot["phase"][] = ["complete", "cancelled", "error"];

export function isRunning(snap: UploadSnapshot | null | undefined): boolean {
  return !!snap && !TERMINAL.includes(snap.phase);
}

// Leaving Wideline (closing the tab, reloading) stops a running upload: warn first.
function warnOnUnload(e: BeforeUnloadEvent) {
  if ([...uploads.values()].some((u) => isRunning(u.snap))) e.preventDefault();
}

/** Starts uploading `file` for a match and keeps it running across pages. */
export function startUpload(matchId: string, file: UploadFile): ActiveUpload {
  const uploader = new MultipartUploader({
    matchId,
    file,
    onChange: (snap) => {
      const current = uploads.get(matchId);
      if (current?.uploader !== uploader) return;
      uploads.set(matchId, { ...current, snap });
      emit();
    },
  });
  uploads.set(matchId, {
    uploader,
    snap: uploader.snapshot,
    done: Promise.resolve(uploader.snapshot),
  });
  if (uploads.size === 1) window.addEventListener("beforeunload", warnOnUnload);
  const done = uploader.start();
  // start() may already have reported progress: keep the newest snapshot.
  const entry = { ...uploads.get(matchId)!, done };
  uploads.set(matchId, entry);
  emit();
  return entry;
}

export function getUpload(matchId: string): ActiveUpload | null {
  return uploads.get(matchId) ?? null;
}

/** Forgets a match's upload once its result has been handled. */
export function clearUpload(matchId: string, uploader?: MultipartUploader) {
  const current = uploads.get(matchId);
  if (!current || (uploader && current.uploader !== uploader)) return;
  uploads.delete(matchId);
  if (uploads.size === 0) window.removeEventListener("beforeunload", warnOnUnload);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The match's running (or just finished) upload, or null. Null in the server HTML. */
export function useUpload(matchId: string): ActiveUpload | null {
  return useSyncExternalStore(
    subscribe,
    () => uploads.get(matchId) ?? null,
    () => null,
  );
}

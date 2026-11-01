"use client";

import { ArrowRight, Check, Info, Pause, Play, RefreshCw, Upload, Video, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import { Banner, FieldErrorText } from "@/components/forms";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/Modal";
import { cx } from "@/components/ui/cx";
import { iconProps } from "@/components/ui/icons";
import { UNEXPECTED_ERROR } from "@/lib/action-result";
import { formatEta, formatGB, formatSize, formatSpeed } from "@/lib/labels";
import {
  fingerprintFile,
  type MultipartUploader,
  type UploadFile,
  type UploadSnapshot,
} from "@/lib/upload/multipart-client";
import { ACCEPT_ATTRIBUTE, ACCEPTED_TYPES, videoKind } from "@/lib/upload/part-plan";
import { precheckFile, type Precheck } from "@/lib/upload/precheck";
import { clearUpload, getUpload, startUpload, useUpload } from "./upload-store";

/** An upload the server still has open for this match. */
export type OpenUpload = {
  videoId: string;
  fileName: string;
  sizeBytes: number;
  fingerprint: string;
  percent: number;
};

type View = "choose" | "summary" | "uploading";

type Notice = { tone: "ok" | "danger"; text: string; signIn?: boolean } | null;

const SIGNED_OUT =
  "You have been signed out. Sign in again, then come back here and choose the same file to carry on.";
const GONE = "This upload was cancelled, so it cannot carry on. Choose your file to start again.";

const noSubscribe = () => () => {};

/** The copy for a file the browser can refuse before any upload starts. */
function refuse(file: File, limit: number): string | null {
  if (!videoKind(file.name, file.type)) return "Choose an MP4 or MOV file.";
  if (file.size === 0) return "This file is empty. Choose the match video.";
  if (file.size > limit) {
    return `This file is ${formatSize(file.size)}. The most you can upload for one match is ${formatGB(limit)}.`;
  }
  return null;
}

function Checklist({ limit }: { limit: number }) {
  const items = [
    "The whole match in one file, from before kickoff to after full time.",
    "Filmed in landscape from high on the halfway line, with both goals in the frame.",
    "1080p or higher, at 25 frames per second or more.",
    `MP4 or MOV, up to ${formatGB(limit)}.`,
  ];
  return (
    <ul className="mt-3 flex flex-col border-t border-line" role="list">
      {items.map((t) => (
        <li key={t} className="flex gap-3 border-b border-line py-3">
          <Check {...iconProps} className="mt-px shrink-0 text-confirmed" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

/** A progress track: lime while the upload is live, muted while it is paused. */
export function Track({
  percent,
  live,
  className,
}: {
  percent: number;
  live: boolean;
  className?: string;
}) {
  return (
    <span aria-hidden className={cx("block h-2 bg-selected", className)}>
      <span
        className={cx("block h-full", live ? "border border-brand-edge bg-brand" : "bg-ink-muted")}
        style={{ width: `${percent}%` } as CSSProperties}
      />
    </span>
  );
}

/**
 * The upload card (MATCH02, NFR26; docs/build/design/C06.md, Surface 3):
 * choose, pre-check, upload with progress, retry, offline, pause, resume and
 * cancel. MultipartUploader does the work; this renders its snapshot.
 */
export function UploadPanel({
  matchId,
  limitBytes,
  open,
}: {
  matchId: string;
  limitBytes: number;
  open: OpenUpload | null;
}) {
  const router = useRouter();
  const ids = useId();
  const headingId = `${ids}-heading`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // "Choose another file" in the summary view: its file input is hidden from
  // assistive technology, so a refusal there focuses this button instead.
  const chooseAgainRef = useRef<HTMLButtonElement>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  // The uploader lives in the upload store, so it keeps running while the coach moves on
  // to the lineup and markers; coming back here shows the same upload.
  const active = useUpload(matchId);
  const snap = active?.snap ?? null;
  const uploader = active?.uploader ?? null;
  const [resume, setResume] = useState<OpenUpload | null>(open);
  const [view, setView] = useState<View>(() => (getUpload(matchId) ? "uploading" : "choose"));
  const [file, setFile] = useState<File | null>(null);
  const [precheck, setPrecheck] = useState<Precheck | "checking" | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [over, setOver] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Bumped on each client refusal; the effect below focuses the control the
  // error describes once the error is in the DOM.
  const [refusals, setRefusals] = useState(0);
  // False in the server HTML, true once hydrated: the file input only works then.
  const hydrated = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

  useEffect(() => {
    if (refusals === 0) return;
    (chooseAgainRef.current ?? inputRef.current)?.focus();
  }, [refusals]);

  // Focus the new view's heading when the view changes (not on first load).
  const shownView = useRef(view);
  useEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    headingRef.current?.focus();
  }, [view]);

  // The store warns before the tab closes while an upload runs (upload-store.ts).

  // How the upload ended, handled once by whichever upload page is open. Elsewhere (the
  // lineup or markers page) the upload strip shows the result instead.
  const done = active?.done;
  const activeUploader = active?.uploader;
  useEffect(() => {
    if (!done || !activeUploader) return;
    let live = true;
    void done.then((end) => {
      if (!live) return;
      clearUpload(matchId, activeUploader);
      if (end.phase === "complete") {
        router.push(`/matches/${matchId}?done=uploaded`);
        return;
      }
      if (end.phase === "cancelled") return;
      const code = end.error?.code;
      if (code === "signed_out") {
        setNotice({ tone: "danger", text: SIGNED_OUT, signIn: true });
      } else if (code === "upload_gone") {
        setResume(null);
        setNotice({ tone: "danger", text: GONE });
        setView("choose");
      } else if (code === "upload_exists") {
        router.refresh();
      } else if (code === "upload_type" || code === "upload_empty" || code === "upload_too_big") {
        setFileError(end.error?.message ?? UNEXPECTED_ERROR);
        setView("choose");
      } else {
        setNotice({ tone: "danger", text: UNEXPECTED_ERROR });
        setView("choose");
      }
    });
    return () => {
      live = false;
    };
  }, [done, activeUploader, matchId, router]);

  // The retry countdown ticks once a second.
  useEffect(() => {
    if (snap?.phase !== "retrying") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [snap?.phase]);

  // Screen readers hear each 10% step only; the percent never goes down.
  const spoken = snap ? Math.floor(snap.percent / 10) * 10 : 0;

  function begin(f: File) {
    setNotice(null);
    setFileError(null);
    startUpload(matchId, f as UploadFile);
    setView("uploading");
  }

  async function choose(f: File | undefined) {
    if (!f) return;
    setNotice(null);
    const refused = refuse(f, limitBytes);
    if (refused) {
      setFileError(refused);
      setRefusals((n) => n + 1);
      return;
    }
    setFileError(null);
    if (resume) {
      const fp = await fingerprintFile(f);
      const same = fp
        ? fp === resume.fingerprint
        : f.name === resume.fileName && f.size === resume.sizeBytes;
      if (!same) {
        setFileError(
          `This is not the file you started with (${resume.fileName}, ${formatSize(resume.sizeBytes)}). Choose that file, or cancel the upload to start again.`,
        );
        setRefusals((n) => n + 1);
        return;
      }
      void begin(f);
      return;
    }
    setFile(f);
    setView("summary");
    setPrecheck("checking");
    setPrecheck(await precheckFile(f));
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setOver(false);
    void choose(e.dataTransfer.files[0]);
  }

  function openCancel() {
    setCancelOpen(true);
  }

  async function confirmCancel() {
    setCancelling(true);
    try {
      const current = getUpload(matchId)?.uploader;
      if (current) await current.cancel();
      else if (resume) {
        const res = await fetch(`/api/matches/${matchId}/upload`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId: resume.videoId }),
        });
        if (!res.ok && res.status !== 410) throw new Error(`cancel ${res.status}`);
        window.localStorage?.removeItem(`wideline.upload.${matchId}`);
      }
      clearUpload(matchId);
      setCancelOpen(false);
      setResume(null);
      setFile(null);
      setNotice({ tone: "ok", text: "Upload cancelled. Choose a file to start again." });
      setView("choose");
      router.refresh();
    } catch {
      setNotice({ tone: "danger", text: UNEXPECTED_ERROR });
      setCancelOpen(false);
    } finally {
      setCancelling(false);
    }
  }

  const dropzone = (
    <label
      className={cx(
        "flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-control px-6 py-8 text-center has-[:focus-visible]:ring-focus",
        over
          ? "border-pending bg-raised"
          : "border border-dashed border-control bg-panel hover:bg-raised",
      )}
      data-over={over ? "true" : "false"}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        aria-invalid={fileError ? true : undefined}
        aria-describedby={fileError ? `${ids}-file-error` : undefined}
        onChange={(e) => {
          void choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <span className="grid size-10 place-items-center bg-selected" aria-hidden>
        <Upload {...iconProps} />
      </span>
      <span className="font-semibold break-all">
        {resume ? `Choose ${resume.fileName}` : "Choose a video file"}
      </span>
      <span className="hidden text-body-s text-ink-muted tablet:inline">or drag it here</span>
      <span className="text-body-s text-ink-muted">MP4 or MOV, up to {formatGB(limitBytes)}</span>
    </label>
  );

  // role="alert": a refusal moves focus to the control, which reads only the
  // field's name, so the message itself is announced. Keyed by the refusal
  // count, so refusing the same file again announces it again.
  const fileErrorText = fileError && (
    <div key={refusals} role="alert" className="mt-2">
      <FieldErrorText id={`${ids}-file-error`} message={fileError} />
    </div>
  );

  let title: string;
  let body: React.ReactNode;
  if (view === "uploading" && snap) {
    title = "Uploading";
    body = (
      <Progress
        matchId={matchId}
        snap={snap}
        headingId={headingId}
        now={now}
        uploader={uploader}
        onCancel={openCancel}
      />
    );
  } else if (view === "summary" && file) {
    const kind = videoKind(file.name, file.type);
    const warn =
      precheck &&
      precheck !== "checking" &&
      (precheck.kind === "low_resolution" || precheck.kind === "portrait")
        ? precheck
        : null;
    title = "Choose the recording";
    body = (
      <div className="flex flex-col gap-4">
        <FileLine name={file.name}>
          {formatSize(file.size)}
          {kind && ` · ${ACCEPTED_TYPES[kind].label}`}
        </FileLine>
        {precheck === "checking" && (
          <p className="text-body-s text-ink-muted">Checking the file…</p>
        )}
        {warn && (
          <>
            <Banner tone="warn">
              {warn.kind === "portrait"
                ? "This video looks like it was filmed upright (portrait). Portrait footage is rejected after upload."
                : `This video looks like ${warn.width} × ${warn.height}. Footage under 1080p is rejected after upload.`}
            </Banner>
            <p>Uploading takes time and data. Check the file first.</p>
          </>
        )}
        <p className="flex gap-2.5 text-ink-muted">
          <Info {...iconProps} className="mt-px shrink-0 text-ink" />
          <span>
            This upload uses about {formatSize(file.size)} of data. Large recordings upload faster
            on Wi-Fi.
          </span>
        </p>
        <div className="flex flex-col gap-2 tablet:flex-row">
          {warn ? (
            <>
              <Button
                ref={chooseAgainRef}
                variant="primary"
                block
                className="justify-center"
                aria-describedby={fileError ? `${ids}-file-error` : undefined}
                onClick={() => inputRef.current?.click()}
              >
                Choose another file
              </Button>
              <Button
                variant="secondary"
                block
                className="justify-center"
                onClick={() => void begin(file)}
              >
                Upload anyway
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="primary"
                icon={Upload}
                block
                className="justify-center"
                disabled={precheck === "checking"}
                onClick={() => void begin(file)}
              >
                Start upload
              </Button>
              <Button
                ref={chooseAgainRef}
                variant="ghost"
                block
                className="justify-center"
                aria-describedby={fileError ? `${ids}-file-error` : undefined}
                onClick={() => inputRef.current?.click()}
              >
                Choose another file
              </Button>
            </>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {fileErrorText}
      </div>
    );
  } else if (resume) {
    title = "Carry on uploading";
    body = (
      <div className="flex flex-col gap-4">
        <Banner tone="warn">
          The upload of {resume.fileName} stopped at {resume.percent}%. Choose the same file to
          carry on from there.
        </Banner>
        {dropzone}
        {fileErrorText}
        <div>
          <Button variant="ghost" icon={X} block className="justify-center" onClick={openCancel}>
            Cancel upload and start again
          </Button>
        </div>
      </div>
    );
  } else {
    title = "Choose the recording";
    body = (
      <>
        {dropzone}
        {fileErrorText}
      </>
    );
  }

  const sentBytes =
    snap?.sentBytes ?? (resume ? Math.floor((resume.percent / 100) * resume.sizeBytes) : 0);

  return (
    <div className="max-w-2xl" data-upload-ready={hydrated ? "true" : undefined}>
      <div aria-live="polite" className="mt-6 empty:mt-0">
        {notice && (
          <div className="flex flex-col items-start gap-3">
            <Banner tone={notice.tone}>{notice.text}</Banner>
            {notice.signIn && (
              <div>
                <ButtonLink
                  variant="secondary"
                  href={`/login?next=${encodeURIComponent(`/matches/${matchId}/upload`)}`}
                >
                  Sign in
                </ButtonLink>
              </div>
            )}
          </div>
        )}
      </div>
      <section aria-labelledby={headingId} className="mt-6">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-heading-section stretch-wide uppercase outline-none"
        >
          {title}
        </h2>
        <div className="mt-3 border border-line bg-panel p-4">{body}</div>
      </section>
      {view === "uploading" ? (
        <details className="mt-6 border-t border-line pt-3">
          <summary className="cursor-pointer text-label">Before you upload</summary>
          <Checklist limit={limitBytes} />
        </details>
      ) : (
        <section aria-labelledby={`${ids}-before`} className="mt-8">
          <h2
            id={`${ids}-before`}
            className="font-display text-heading-section stretch-wide uppercase"
          >
            Before you upload
          </h2>
          <Checklist limit={limitBytes} />
        </section>
      )}
      <span className="sr-only" aria-live="polite">
        {view === "uploading" && spoken > 0 ? `Uploaded ${spoken}%` : ""}
      </span>
      <ConfirmModal
        open={cancelOpen}
        onClose={() => {
          if (!cancelling) setCancelOpen(false);
        }}
        onConfirm={() => void confirmCancel()}
        title="Cancel this upload?"
        icon={X}
        confirmLabel="Cancel upload"
        cancelLabel="Keep uploading"
        tone="danger"
        loading={cancelling}
        loadingLabel="Cancelling"
      >
        The {formatSize(sentBytes)} uploaded so far is thrown away. You can start again with the
        same file or another one.
      </ConfirmModal>
    </div>
  );
}

/** The file being uploaded: a video tile, the name in mono, and its facts. */
function FileLine({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3">
      <span className="grid size-10 place-items-center bg-selected" aria-hidden>
        <Video {...iconProps} />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-mono text-mono-m font-medium break-all">{name}</span>
        <span className="font-mono text-body-s text-ink-muted tabular-nums">{children}</span>
      </span>
    </div>
  );
}

function Progress({
  matchId,
  snap,
  headingId,
  now,
  uploader,
  onCancel,
}: {
  matchId: string;
  snap: UploadSnapshot;
  headingId: string;
  now: number;
  uploader: MultipartUploader | null;
  onCancel: () => void;
}) {
  const paused = snap.phase === "paused";
  const offline = snap.phase === "offline";
  const retrying = snap.phase === "retrying";
  const finishing = snap.phase === "finishing" || snap.phase === "complete";
  const percent = finishing ? 100 : snap.percent;
  const sent = formatSize(snap.sentBytes);
  const total = formatSize(snap.totalBytes);
  let caption: string;
  if (finishing) caption = "Finishing upload…";
  else if (snap.resumedBytes !== null && snap.sentBytes <= snap.resumedBytes)
    caption = `Resuming from ${snap.resumedFromPercent}%`;
  else if (snap.speedBps === null || snap.etaSec === null)
    caption = `${sent} of ${total} · Working out time left…`;
  else
    caption = `${sent} of ${total} · ${formatSpeed(snap.speedBps)} · about ${formatEta(snap.etaSec)} left`;

  const retryIn = snap.retryAt ? Math.max(1, Math.ceil((snap.retryAt - now) / 1000)) : null;

  const stalled = paused || offline || retrying;

  return (
    <div className="flex flex-col gap-4">
      <FileLine name={snap.fileName}>
        {sent} of {total}
      </FileLine>
      <div className="flex flex-col gap-2.5">
        <div
          role="progressbar"
          aria-labelledby={headingId}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={`${percent}%, ${sent} of ${total}`}
        >
          <Track percent={percent} live={!stalled} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {stalled ? (
            <span className="inline-flex h-6 items-center gap-1.5 rounded-control border-pending pr-2.5 pl-2 text-body-s font-semibold text-pending">
              <Pause {...iconProps} size={14} />
              {paused
                ? `Paused at ${percent}%`
                : offline
                  ? "Paused · no connection"
                  : "Paused · connection lost"}
            </span>
          ) : (
            <span className="font-mono text-mono-m font-semibold tabular-nums">{percent}%</span>
          )}
          <span className="font-mono text-body-s text-ink-muted tabular-nums">{caption}</span>
        </div>
      </div>
      {retrying && (
        <div className="flex flex-col items-start gap-3">
          <Banner tone="warn">
            <span className="sr-only">Connection lost. Retrying automatically.</span>
            <span aria-hidden="true">Connection lost. Retrying in {retryIn ?? 1} s.</span>
          </Banner>
          <Button
            variant="secondary"
            size="s"
            icon={RefreshCw}
            onClick={() => uploader?.retryNow()}
          >
            Retry now
          </Button>
        </div>
      )}
      {offline && (
        <p role="status" className="text-pretty">
          Your upload is safe. It carries on from {sent} when you are back online.
        </p>
      )}
      {snap.missingPartsNotice && !finishing && (
        <Banner tone="warn">Some parts did not arrive. Sending them again.</Banner>
      )}
      <p className="flex gap-2.5 text-ink-muted">
        <Info {...iconProps} className="mt-px shrink-0 text-ink" />
        <span>
          Large recordings upload faster on Wi-Fi. You can fill in the lineup while you wait.
        </span>
      </p>
      {/* Screens A, "Upload · phone paused": the one primary, the next step, then cancel. */}
      <div className="flex flex-col gap-2 tablet:flex-row tablet:flex-wrap">
        {paused ? (
          <Button
            variant="primary"
            icon={Play}
            block
            className="justify-center"
            onClick={() => uploader?.resume()}
          >
            Resume upload
          </Button>
        ) : offline ? (
          <Button
            variant="primary"
            icon={RefreshCw}
            block
            className="justify-center"
            onClick={() => uploader?.retryNow()}
          >
            Try to resume now
          </Button>
        ) : (
          <Button
            variant="secondary"
            icon={Pause}
            block
            className="justify-center"
            disabled={finishing}
            onClick={() => uploader?.pause()}
          >
            Pause upload
          </Button>
        )}
        {!finishing && (
          <ButtonLink
            variant="secondary"
            block
            className="justify-center touch:h-row"
            href={`/matches/${matchId}/lineup`}
          >
            Continue to lineup
            <ArrowRight {...iconProps} />
          </ButtonLink>
        )}
        <Button
          variant="ghost"
          icon={X}
          block
          className="justify-center text-ink-muted"
          disabled={finishing}
          onClick={onCancel}
        >
          Cancel upload
        </Button>
      </div>
    </div>
  );
}

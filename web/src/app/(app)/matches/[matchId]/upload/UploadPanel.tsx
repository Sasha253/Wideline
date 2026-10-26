"use client";

import { Check, Pause, Play, Upload, WifiOff, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent,
} from "react";
import { Banner, FieldErrorText } from "@/components/forms";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { iconProps } from "@/components/ui/icons";
import { UNEXPECTED_ERROR } from "@/lib/action-result";
import { formatEta, formatGB, formatSize, formatSpeed } from "@/lib/labels";
import {
  fingerprintFile,
  MultipartUploader,
  type UploadFile,
  type UploadSnapshot,
} from "@/lib/upload/multipart-client";
import { ACCEPT_ATTRIBUTE, ACCEPTED_TYPES, videoKind } from "@/lib/upload/part-plan";
import { precheckFile, type Precheck } from "@/lib/upload/precheck";

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
    <ul className="wl-checklist mt-4" role="list">
      {items.map((t) => (
        <li key={t} className="body">
          <Check {...iconProps} />
          {t}
        </li>
      ))}
    </ul>
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const uploaderRef = useRef<MultipartUploader | null>(null);
  const [resume, setResume] = useState<OpenUpload | null>(open);
  const [view, setView] = useState<View>("choose");
  const [file, setFile] = useState<File | null>(null);
  const [precheck, setPrecheck] = useState<Precheck | "checking" | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [snap, setSnap] = useState<UploadSnapshot | null>(null);
  const [over, setOver] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [uploader, setUploader] = useState<MultipartUploader | null>(null);
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

  const running =
    view === "uploading" &&
    snap !== null &&
    !["complete", "cancelled", "error"].includes(snap.phase);
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  // The retry countdown ticks once a second.
  useEffect(() => {
    if (snap?.phase !== "retrying") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [snap?.phase]);

  // Screen readers hear each 10% step only; the percent never goes down.
  const spoken = snap ? Math.floor(snap.percent / 10) * 10 : 0;

  async function begin(f: File) {
    setNotice(null);
    setFileError(null);
    const next = new MultipartUploader({
      matchId,
      file: f as UploadFile,
      onChange: (s) => setSnap(s),
    });
    uploaderRef.current = next;
    setUploader(next);
    setSnap(next.snapshot);
    setView("uploading");
    const end = await next.start();
    if (uploaderRef.current !== next) return;
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
      setFileError(end.error?.message ?? refuse(f, limitBytes) ?? UNEXPECTED_ERROR);
      setView("choose");
    } else {
      setNotice({ tone: "danger", text: UNEXPECTED_ERROR });
      setView("choose");
    }
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
    dialogRef.current?.showModal();
    requestAnimationFrame(() => keepRef.current?.focus());
  }

  async function confirmCancel() {
    setCancelling(true);
    try {
      const current = uploaderRef.current;
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
      uploaderRef.current = null;
      setUploader(null);
      dialogRef.current?.close();
      setResume(null);
      setSnap(null);
      setFile(null);
      setNotice({ tone: "ok", text: "Upload cancelled. Choose a file to start again." });
      setView("choose");
      router.refresh();
    } catch {
      setNotice({ tone: "danger", text: UNEXPECTED_ERROR });
      dialogRef.current?.close();
    } finally {
      setCancelling(false);
    }
  }

  const dropzone = (
    <label
      className="wl-dropzone"
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
      <Upload {...iconProps} />
      <span className="body-strong">
        {resume ? `Choose ${resume.fileName}` : "Choose a video file"}
      </span>
      <span className="caption hidden text-ink-muted md:inline">or drag it here</span>
      <span className="caption text-ink-muted">MP4 or MOV, up to {formatGB(limitBytes)}</span>
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
      <div className="wl-stack">
        <div>
          <p className="body-strong break-all">{file.name}</p>
          <p className="caption text-ink-muted">
            <span className="data">{formatSize(file.size)}</span>
            {kind && ` · ${ACCEPTED_TYPES[kind].label}`}
          </p>
        </div>
        {precheck === "checking" && <p className="caption text-ink-muted">Checking the file…</p>}
        {warn && (
          <>
            <Banner tone="warn">
              {warn.kind === "portrait"
                ? "This video looks like it was filmed upright (portrait). Portrait footage is rejected after upload."
                : `This video looks like ${warn.width} × ${warn.height}. Footage under 1080p is rejected after upload.`}
            </Banner>
            <p className="body">Uploading takes time and data. Check the file first.</p>
          </>
        )}
        <p className="caption text-ink-muted">
          This upload uses about {formatSize(file.size)} of data. Use Wi-Fi if you can.
        </p>
        <div className="wl-row">
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
      <div className="wl-stack">
        <Banner tone="warn">
          The upload of {resume.fileName} stopped at {resume.percent}%. Choose the same file to
          carry on from there.
        </Banner>
        {dropzone}
        {fileErrorText}
        <div>
          <Button variant="danger" icon={X} block className="justify-center" onClick={openCancel}>
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
          <div className="wl-stack">
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
      {view === "uploading" ? (
        <details className="mt-6">
          <summary className="body-strong">Before you upload</summary>
          <Checklist limit={limitBytes} />
        </details>
      ) : (
        <section aria-labelledby={`${ids}-before`} className="mt-6">
          <h2 id={`${ids}-before`} className="heading-2">
            Before you upload
          </h2>
          <Checklist limit={limitBytes} />
        </section>
      )}
      <section aria-labelledby={headingId} className="mt-8">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="heading-2">
          {title}
        </h2>
        <div className="wl-card mt-4">{body}</div>
      </section>
      <span className="sr-only" aria-live="polite">
        {view === "uploading" && spoken > 0 ? `Uploaded ${spoken}%` : ""}
      </span>
      <dialog
        ref={dialogRef}
        className="wl-dialog"
        aria-labelledby={`${ids}-cancel-title`}
        aria-describedby={`${ids}-cancel-body`}
      >
        <h2 id={`${ids}-cancel-title`} className="heading-2">
          Cancel this upload?
        </h2>
        <p id={`${ids}-cancel-body`} className="body mt-2 text-ink-muted">
          The {formatSize(sentBytes)} uploaded so far is thrown away. You can start again with the
          same file or another one.
        </p>
        <div className="wl-dialog__actions">
          <Button ref={keepRef} variant="secondary" onClick={() => dialogRef.current?.close()}>
            Keep uploading
          </Button>
          <Button variant="danger" disabled={cancelling} onClick={() => void confirmCancel()}>
            {cancelling ? "Cancelling…" : "Cancel upload"}
          </Button>
        </div>
      </dialog>
    </div>
  );
}

function Progress({
  snap,
  headingId,
  now,
  uploader,
  onCancel,
}: {
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

  return (
    <div>
      <div className="wl-progress__head">
        <span className="body-strong min-w-0 break-all">{snap.fileName}</span>
        <span className="data">{paused ? `Paused at ${percent}%` : `${percent}%`}</span>
      </div>
      <div
        className={cx("wl-progress", (paused || offline || retrying) && "wl-progress--paused")}
        role="progressbar"
        aria-labelledby={headingId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%, ${sent} of ${total}`}
      >
        <span
          className="wl-progress__fill"
          style={{ "--wl-progress": `${percent}%` } as CSSProperties}
        />
      </div>
      <p className="caption data mt-2">{caption}</p>
      {retrying && (
        <div className="mt-4 wl-stack">
          <Banner tone="warn">
            <span className="sr-only">Connection lost. Retrying automatically.</span>
            <span aria-hidden="true">Connection lost. Retrying in {retryIn ?? 1} s.</span>
          </Banner>
          <div>
            <Button variant="ghost" size="sm" onClick={() => uploader?.retryNow()}>
              Retry now
            </Button>
          </div>
        </div>
      )}
      {offline && (
        <div className="mt-4 wl-banner" role="status">
          <WifiOff {...iconProps} />
          <p className="body">Paused: you are offline. The upload carries on when you reconnect.</p>
        </div>
      )}
      {snap.missingPartsNotice && !finishing && (
        <div className="mt-4">
          <Banner tone="warn">Some parts did not arrive. Sending them again.</Banner>
        </div>
      )}
      <div className="wl-row mt-4">
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
        ) : (
          !offline && (
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
          )
        )}
        <Button
          variant="danger"
          icon={X}
          block
          className="justify-center"
          disabled={finishing}
          onClick={onCancel}
        >
          Cancel upload
        </Button>
      </div>
      <p className="caption mt-4 text-ink-muted">
        Keep this page open until the upload finishes. If it stops, come back here and choose the
        same file to carry on.
      </p>
    </div>
  );
}

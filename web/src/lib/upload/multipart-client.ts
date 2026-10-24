import { fingerprintSource, MAX_PRESIGN_BATCH, PARALLEL_PARTS, partRange } from "./part-plan";

// The browser side of the resumable upload (MATCH02, NFR26;
// docs/build/design/C06.md, Surface 3). Parts go straight to object storage
// through presigned URLs; the server lists what arrived (ListParts), so a
// reload, a new tab or another device resumes where the upload stopped.
//
// Rules:
//  - Each part retries with backoff (1, 2, 4, 8, 16, then every 30 s), with no
//    limit while online. Offline pauses everything until the browser is back.
//  - A 403 on a part means its URL expired: fetch fresh URLs, no backoff.
//  - Progress counts only parts that arrived, and never goes backwards.
//  - Nothing about the file but { videoId, fingerprint, fileName } is stored,
//    per match, in localStorage.
// fetch, the clock, connectivity and storage are injectable for tests.

export const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;

/** Throughput is averaged over this window; time left is shown after this long. */
const SPEED_WINDOW_MS = 30_000;
const ETA_AFTER_MS = 10_000;

export type UploadInfo = {
  videoId: string;
  status: "uploading" | "probing" | "accepted" | "rejected" | "cancelled";
  fileName: string;
  sizeBytes: number;
  partSize: number;
  partCount: number;
  fingerprint: string;
  uploadedParts: { partNumber: number; size: number }[];
  uploadedBytes: number;
};

export type UploadErrorCode =
  | "signed_out"
  | "upload_type"
  | "upload_empty"
  | "upload_too_big"
  | "upload_exists"
  | "upload_gone"
  | "invalid";

/** A refusal the uploader does not retry. message is the server's copy, when it sent one. */
export class UploadRefused extends Error {
  constructor(
    readonly code: UploadErrorCode,
    readonly status: number,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "UploadRefused";
  }
}

/** A failure worth retrying: offline, a dropped connection or a 5xx. */
class Transient extends Error {}

/** The parts the server could not find on complete. */
class MissingParts extends Error {
  constructor(readonly missing: number[]) {
    super("missing_parts");
  }
}

class Cancelled extends Error {}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type Clock = {
  now(): number;
  /** Resolves after ms, or early when the signal aborts. Never rejects. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
};

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        resolve();
      });
    }),
};

export type Connectivity = {
  isOnline(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
};

export const browserConnectivity: Connectivity = {
  isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine),
  subscribe(listener) {
    const on = () => listener(true);
    const off = () => listener(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  },
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** What a browser remembers about an upload, per match. Never a player name. */
export type RememberedUpload = { videoId: string; fingerprint: string; fileName: string };

const storageKey = (matchId: string) => `wideline.upload.${matchId}`;

export function readRemembered(
  storage: StorageLike | null,
  matchId: string,
): RememberedUpload | null {
  try {
    const raw = storage?.getItem(storageKey(matchId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<RememberedUpload>;
    return v.videoId && v.fingerprint && v.fileName
      ? { videoId: v.videoId, fingerprint: v.fingerprint, fileName: v.fileName }
      : null;
  } catch {
    return null;
  }
}

function remember(storage: StorageLike | null, matchId: string, value: RememberedUpload) {
  try {
    storage?.setItem(storageKey(matchId), JSON.stringify(value));
  } catch {
    // Private windows may refuse storage; the server state is enough to resume.
  }
}

export function forgetUpload(storage: StorageLike | null, matchId: string) {
  try {
    storage?.removeItem(storageKey(matchId));
  } catch {
    // As above.
  }
}

/** sha256 hex of name|size|lastModified, as the server computes it; null without WebCrypto. */
export async function fingerprintFile(file: {
  name: string;
  size: number;
  lastModified: number;
}): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(fingerprintSource(file)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const REFUSAL_BY_STATUS: Record<number, UploadErrorCode> = {
  401: "signed_out",
  403: "signed_out",
  404: "upload_gone",
  410: "upload_gone",
  413: "upload_too_big",
  415: "upload_type",
};

/** The JSON API in src/app/api/matches/[matchId]/upload/. */
export class UploadApi {
  constructor(
    private readonly matchId: string,
    private readonly fetchFn: FetchLike,
  ) {}

  private async call<T>(path: string, init: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(`/api/matches/${this.matchId}/upload${path}`, {
        ...init,
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
      });
    } catch {
      throw new Transient("network");
    }
    if (res.ok) return (await res.json()) as T;
    if (res.status >= 500) throw new Transient(`http ${res.status}`);
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      missing?: number[];
    };
    if (body.error === "missing_parts") throw new MissingParts(body.missing ?? []);
    const known = body.error as UploadErrorCode | undefined;
    const code =
      known && known !== ("server" as string) && known in KNOWN_CODES
        ? known
        : (REFUSAL_BY_STATUS[res.status] ?? "invalid");
    throw new UploadRefused(code, res.status, body.message);
  }

  status() {
    return this.call<{ video: UploadInfo | null }>("", { method: "GET" }).then((r) => r.video);
  }

  start(file: { fileName: string; size: number; type: string; lastModified: number }) {
    return this.call<{ video: UploadInfo }>("", {
      method: "POST",
      body: JSON.stringify(file),
    }).then((r) => r.video);
  }

  presign(videoId: string, partNumbers: number[]) {
    return this.call<{ urls: Record<string, string> }>("/parts", {
      method: "POST",
      body: JSON.stringify({ videoId, partNumbers }),
    }).then((r) => r.urls);
  }

  complete(videoId: string) {
    return this.call<{ status: string; alreadyComplete: boolean }>("/complete", {
      method: "POST",
      body: JSON.stringify({ videoId }),
    });
  }

  cancel(videoId: string) {
    return this.call<{ ok: true }>("", { method: "DELETE", body: JSON.stringify({ videoId }) });
  }
}

const KNOWN_CODES: Record<UploadErrorCode, true> = {
  signed_out: true,
  upload_type: true,
  upload_empty: true,
  upload_too_big: true,
  upload_exists: true,
  upload_gone: true,
  invalid: true,
};

export type UploadPhase =
  | "starting"
  | "uploading"
  | "retrying"
  | "offline"
  | "paused"
  | "finishing"
  | "complete"
  | "cancelled"
  | "error";

export type UploadSnapshot = {
  phase: UploadPhase;
  videoId: string | null;
  fileName: string;
  totalBytes: number;
  /** Bytes in parts the store holds. Never decreases. */
  sentBytes: number;
  /** Whole percent, 0 to 100. Never decreases. */
  percent: number;
  /** Bytes per second over the last 30 s of this session; null in the first 10 s. */
  speedBps: number | null;
  etaSec: number | null;
  /** When the next retry runs (clock ms), while retrying. */
  retryAt: number | null;
  /** The percent an earlier session reached, when this one resumed it. */
  resumedFromPercent: number | null;
  /** The bytes an earlier session sent, when this one resumed it. */
  resumedBytes: number | null;
  /** Complete found missing parts more than once (shown as a notice). */
  missingPartsNotice: boolean;
  error: { code: UploadErrorCode; message: string | null } | null;
};

export type UploadFile = Blob & { name: string; lastModified: number };

export type UploaderOptions = {
  matchId: string;
  file: UploadFile;
  fetch?: FetchLike;
  clock?: Clock;
  connectivity?: Connectivity;
  storage?: StorageLike | null;
  parallel?: number;
  onChange?: (snapshot: UploadSnapshot) => void;
};

/**
 * Uploads one file for one match: start (or resume) on the server, send the
 * missing parts, complete. One instance per attempt; start() resolves when the
 * upload completes, is cancelled or fails with a refusal.
 */
export class MultipartUploader {
  private readonly api: UploadApi;
  private readonly fetchFn: FetchLike;
  private readonly clock: Clock;
  private readonly connectivity: Connectivity;
  private readonly storage: StorageLike | null;
  private readonly parallel: number;
  private readonly file: UploadFile;
  private readonly matchId: string;
  private readonly onChange?: (s: UploadSnapshot) => void;

  private info: UploadInfo | null = null;
  private done = new Set<number>();
  private urls = new Map<number, string>();
  private presigning: Promise<void> | null = null;
  private inflight = new Set<AbortController>();
  private wake = new AbortController();
  private waiters: (() => void)[] = [];
  private sleeping = 0;
  private paused = false;
  private offline = false;
  private cancelled = false;
  private finishing = false;
  private fatal: UploadRefused | null = null;
  private samples: { t: number; bytes: number }[] = [];
  private sessionStart = 0;
  private unsubscribe: (() => void) | null = null;
  private state: UploadSnapshot;

  constructor(opts: UploaderOptions) {
    this.matchId = opts.matchId;
    this.file = opts.file;
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.api = new UploadApi(opts.matchId, this.fetchFn);
    this.clock = opts.clock ?? realClock;
    this.connectivity = opts.connectivity ?? browserConnectivity;
    this.storage = opts.storage === undefined ? safeLocalStorage() : opts.storage;
    this.parallel = opts.parallel ?? PARALLEL_PARTS;
    this.onChange = opts.onChange;
    this.state = {
      phase: "starting",
      videoId: null,
      fileName: opts.file.name,
      totalBytes: opts.file.size,
      sentBytes: 0,
      percent: 0,
      speedBps: null,
      etaSec: null,
      retryAt: null,
      resumedFromPercent: null,
      resumedBytes: null,
      missingPartsNotice: false,
      error: null,
    };
  }

  get snapshot(): UploadSnapshot {
    return this.state;
  }

  /** Runs the upload to the end. Never rejects: the outcome is in the snapshot's phase. */
  async start(): Promise<UploadSnapshot> {
    this.sessionStart = this.clock.now();
    this.offline = !this.connectivity.isOnline();
    this.unsubscribe = this.connectivity.subscribe((online) => this.setOnline(online));
    try {
      await this.run();
    } catch (err) {
      if (err instanceof Cancelled || this.cancelled) {
        this.update({ phase: "cancelled" });
      } else {
        const refusal =
          err instanceof UploadRefused ? err : new UploadRefused("invalid", 0, String(err));
        this.update({
          phase: "error",
          error: {
            code: refusal.code,
            message: refusal.message === refusal.code ? null : refusal.message,
          },
        });
      }
    } finally {
      this.unsubscribe?.();
      this.abortInflight();
    }
    return this.state;
  }

  pause() {
    if (this.terminal()) return;
    this.paused = true;
    this.abortInflight();
    this.refresh();
  }

  resume() {
    this.paused = false;
    this.notify();
    this.refresh();
  }

  /** Ends the backoff waits now. */
  retryNow() {
    this.wake.abort();
    this.wake = new AbortController();
  }

  /** Aborts the upload on the server and throws the parts away. */
  async cancel(): Promise<void> {
    this.cancelled = true;
    this.abortInflight();
    this.retryNow();
    this.notify();
    const id = this.info?.videoId;
    forgetUpload(this.storage, this.matchId);
    if (id) await this.api.cancel(id);
    this.update({ phase: "cancelled" });
  }

  private terminal() {
    return ["complete", "cancelled", "error"].includes(this.state.phase);
  }

  private setOnline(online: boolean) {
    this.offline = !online;
    if (!online) this.abortInflight();
    else {
      this.notify();
      this.retryNow();
    }
    this.refresh();
  }

  private abortInflight() {
    for (const c of this.inflight) c.abort();
    this.inflight.clear();
  }

  private notify() {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  /** Waits while paused or offline; throws once cancelled or after a refusal. */
  private async runnable(): Promise<void> {
    for (;;) {
      if (this.cancelled) throw new Cancelled();
      if (this.fatal) throw this.fatal;
      if (!this.paused && !this.offline) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  private async backoff(attempt: number): Promise<void> {
    const ms = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
    this.sleeping += 1;
    this.update({ retryAt: this.clock.now() + ms });
    this.refresh();
    try {
      await this.clock.sleep(ms, this.wake.signal);
    } finally {
      this.sleeping -= 1;
      if (this.sleeping === 0) this.update({ retryAt: null });
      this.refresh();
    }
  }

  /** Calls the API, retrying transient failures with backoff until it answers. */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.runnable();
      try {
        return await fn();
      } catch (err) {
        if (!(err instanceof Transient)) throw err;
      }
      await this.backoff(attempt);
    }
  }

  private async run(): Promise<void> {
    const f = this.file;
    const info = await this.withRetry(() =>
      this.api.start({
        fileName: f.name,
        size: f.size,
        type: f.type,
        lastModified: f.lastModified,
      }),
    );
    if (info.status !== "uploading") throw new UploadRefused("upload_exists", 409);
    this.info = info;
    remember(this.storage, this.matchId, {
      videoId: info.videoId,
      fingerprint: info.fingerprint,
      fileName: info.fileName,
    });
    for (const p of info.uploadedParts) this.done.add(p.partNumber);
    const already = this.bytesDone();
    this.samples = [{ t: this.clock.now(), bytes: already }];
    this.update({
      videoId: info.videoId,
      totalBytes: info.sizeBytes,
      resumedFromPercent: already > 0 ? this.percentOf(already) : null,
      resumedBytes: already > 0 ? already : null,
    });
    this.progress();

    let missingRounds = 0;
    for (;;) {
      await this.sendParts();
      this.finishing = true;
      this.refresh();
      try {
        await this.withRetry(() => this.api.complete(info.videoId));
        break;
      } catch (err) {
        if (!(err instanceof MissingParts)) throw err;
        missingRounds += 1;
        for (const n of err.missing) this.done.delete(n);
        this.urls.clear();
        this.finishing = false;
        if (missingRounds >= 2) this.update({ missingPartsNotice: true });
        this.refresh();
      }
    }
    forgetUpload(this.storage, this.matchId);
    this.update({ phase: "complete", percent: 100, sentBytes: info.sizeBytes });
  }

  private pending(): number[] {
    const count = this.info!.partCount;
    return Array.from({ length: count }, (_, i) => i + 1).filter((n) => !this.done.has(n));
  }

  private async sendParts(): Promise<void> {
    const queue = this.pending();
    const worker = async () => {
      for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
        await this.sendPart(n);
      }
    };
    const workers = Array.from({ length: Math.min(this.parallel, queue.length) }, worker);
    const results = await Promise.allSettled(workers);
    const failed = results.find((r) => r.status === "rejected");
    if (failed) throw (failed as PromiseRejectedResult).reason;
  }

  private async urlFor(n: number): Promise<string> {
    for (;;) {
      const cached = this.urls.get(n);
      if (cached) return cached;
      if (!this.presigning) {
        const wanted = [n, ...this.pending().filter((p) => p !== n && !this.urls.has(p))].slice(
          0,
          MAX_PRESIGN_BATCH,
        );
        this.presigning = this.api
          .presign(this.info!.videoId, wanted)
          .then((urls) => {
            for (const [k, v] of Object.entries(urls)) this.urls.set(Number(k), v);
          })
          .finally(() => {
            this.presigning = null;
          });
      }
      await this.presigning;
    }
  }

  private async sendPart(n: number): Promise<void> {
    const info = this.info!;
    const { start, end } = partRange(n, info.sizeBytes, info.partSize);
    let failures = 0;
    for (;;) {
      await this.runnable();
      let failed = false;
      try {
        const url = await this.urlFor(n);
        const ctrl = new AbortController();
        this.inflight.add(ctrl);
        try {
          const res = await this.fetchFn(url, {
            method: "PUT",
            body: this.file.slice(start, end),
            signal: ctrl.signal,
          });
          if (res.ok) {
            this.done.add(n);
            this.samples.push({ t: this.clock.now(), bytes: this.bytesDone() });
            this.progress();
            return;
          }
          if (res.status === 403 && failures === 0) {
            // The URL expired: sign again, at once.
            this.urls.delete(n);
            failures += 1;
            continue;
          }
          if (res.status === 403) this.urls.delete(n);
          failed = true;
        } finally {
          this.inflight.delete(ctrl);
        }
      } catch (err) {
        if (err instanceof UploadRefused) {
          this.fatal = err;
          this.abortInflight();
          this.notify();
          throw err;
        }
        // Paused, offline or cancelled mid-part: not a failure; wait and send it again.
        if (this.paused || this.offline || this.cancelled) continue;
        failed = true;
      }
      if (failed) {
        await this.backoff(failures);
        failures += 1;
      }
    }
  }

  private bytesDone(): number {
    const info = this.info!;
    let sum = 0;
    for (const n of this.done) {
      const { start, end } = partRange(n, info.sizeBytes, info.partSize);
      sum += end - start;
    }
    return sum;
  }

  private percentOf(bytes: number): number {
    const total = this.info?.sizeBytes ?? this.file.size;
    return total > 0 ? Math.floor((bytes / total) * 100) : 0;
  }

  private progress() {
    const bytes = Math.max(this.state.sentBytes, this.bytesDone());
    const now = this.clock.now();
    this.samples = this.samples.filter(
      (s, i) => i === this.samples.length - 1 || now - s.t <= SPEED_WINDOW_MS,
    );
    const first = this.samples[0]!;
    const last = this.samples[this.samples.length - 1]!;
    const dt = last.t - first.t;
    const speed =
      dt > 0 && last.bytes > first.bytes ? ((last.bytes - first.bytes) / dt) * 1000 : null;
    const showEta = now - this.sessionStart >= ETA_AFTER_MS && speed !== null;
    const total = this.info?.sizeBytes ?? this.file.size;
    this.update({
      sentBytes: bytes,
      percent: Math.max(this.state.percent, this.percentOf(bytes)),
      speedBps: showEta ? speed : null,
      etaSec: showEta && speed ? Math.max(0, (total - bytes) / speed) : null,
    });
    this.refresh();
  }

  /** Recomputes the phase from the flags. */
  private refresh() {
    if (this.terminal()) return;
    const phase: UploadPhase = this.cancelled
      ? "cancelled"
      : this.paused
        ? "paused"
        : this.offline
          ? "offline"
          : this.sleeping > 0
            ? "retrying"
            : this.finishing
              ? "finishing"
              : this.info
                ? "uploading"
                : "starting";
    if (phase !== this.state.phase) this.update({ phase });
  }

  private update(patch: Partial<UploadSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.onChange?.(this.state);
  }
}

function safeLocalStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

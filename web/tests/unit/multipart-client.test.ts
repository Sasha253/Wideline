import { describe, expect, it } from "vitest";
import {
  MultipartUploader,
  readRemembered,
  type Clock,
  type Connectivity,
  type FetchLike,
  type StorageLike,
  type UploadFile,
  type UploadSnapshot,
} from "@/lib/upload/multipart-client";

// NFR26, MATCH02: the browser uploader, with a fake server, clock and network.

const MATCH = "m1";
const PART = 4;

function file(size: number): UploadFile {
  return Object.assign(new Blob([new Uint8Array(size)]), { name: "match.mp4", lastModified: 1 });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type PutHook = (part: number, attempt: number) => Promise<Response> | Response | undefined;

function fakeServer({
  size,
  uploaded = [] as number[],
  onPut,
  missingOnFirstComplete = [] as number[],
}: {
  size: number;
  uploaded?: number[];
  onPut?: PutHook;
  missingOnFirstComplete?: number[];
}) {
  const count = Math.ceil(size / PART);
  const parts = new Set(uploaded);
  const s = { parts, puts: [] as number[], okPuts: [] as number[], presignCalls: 0, completes: 0 };
  const attempts = new Map<number, number>();
  const info = () => ({
    videoId: "v1",
    status: "uploading",
    fileName: "match.mp4",
    sizeBytes: size,
    partSize: PART,
    partCount: count,
    fingerprint: "fp",
    uploadedParts: [...parts].map((n) => ({
      partNumber: n,
      size: Math.min(size, n * PART) - (n - 1) * PART,
    })),
    uploadedBytes: 0,
  });
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    if (url === `/api/matches/${MATCH}/upload` && method === "POST") return json({ video: info() });
    if (url === `/api/matches/${MATCH}/upload/parts`) {
      s.presignCalls += 1;
      const { partNumbers } = JSON.parse(String(init!.body)) as { partNumbers: number[] };
      return json({
        urls: Object.fromEntries(
          partNumbers.map((n) => [n, `https://s3.test/part/${n}?sig=${s.presignCalls}`]),
        ),
      });
    }
    if (url.startsWith("https://s3.test/part/")) {
      const n = Number(/part\/(\d+)/.exec(url)![1]);
      const attempt = (attempts.get(n) ?? 0) + 1;
      attempts.set(n, attempt);
      s.puts.push(n);
      const custom = await onPut?.(n, attempt);
      if (custom) return custom;
      parts.add(n);
      s.okPuts.push(n);
      return new Response(null, { status: 200 });
    }
    if (url === `/api/matches/${MATCH}/upload/complete`) {
      s.completes += 1;
      if (s.completes === 1 && missingOnFirstComplete.length) {
        for (const n of missingOnFirstComplete) parts.delete(n);
        return json({ error: "missing_parts", missing: missingOnFirstComplete }, 409);
      }
      const missing = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !parts.has(n));
      if (missing.length) return json({ error: "missing_parts", missing }, 409);
      return json({ status: "probing", alreadyComplete: false });
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { fetch, s };
}

function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  const clock: Clock = {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
      await Promise.resolve();
    },
  };
  return { clock, sleeps, advance: (ms: number) => (t += ms) };
}

function fakeNetwork(online = true) {
  const listeners = new Set<(online: boolean) => void>();
  let state = online;
  const connectivity: Connectivity = {
    isOnline: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return {
    connectivity,
    set(next: boolean) {
      state = next;
      for (const l of listeners) l(next);
    },
  };
}

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function uploader(
  size: number,
  server: ReturnType<typeof fakeServer>,
  opts: {
    clock?: Clock;
    connectivity?: Connectivity;
    storage?: StorageLike;
    parallel?: number;
    onChange?: (s: UploadSnapshot) => void;
  } = {},
) {
  return new MultipartUploader({
    matchId: MATCH,
    file: file(size),
    fetch: server.fetch,
    clock: opts.clock ?? fakeClock().clock,
    connectivity: opts.connectivity ?? fakeNetwork().connectivity,
    storage: opts.storage ?? null,
    parallel: opts.parallel ?? 3,
    onChange: opts.onChange,
  });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("MultipartUploader", () => {
  it("uploads every part once and completes", async () => {
    const server = fakeServer({ size: 10 });
    const storage = memoryStorage();
    const end = await uploader(10, server, { storage }).start();
    expect(end.phase).toBe("complete");
    expect(end.percent).toBe(100);
    expect(server.s.okPuts.sort()).toEqual([1, 2, 3]);
    expect(server.s.completes).toBe(1);
    // The remembered upload is cleared once it completes.
    expect(storage.data.size).toBe(0);
  });

  it("retries a failed part with backoff and never sends it twice once it arrived", async () => {
    const server = fakeServer({
      size: 10,
      onPut: (n, attempt) => {
        if (n === 2 && attempt <= 2) throw new TypeError("Failed to fetch");
        return undefined;
      },
    });
    const { clock, sleeps } = fakeClock();
    const end = await uploader(10, server, { clock, parallel: 1 }).start();
    expect(end.phase).toBe("complete");
    expect(sleeps).toEqual([1000, 2000]);
    expect(server.s.puts.filter((n) => n === 2)).toHaveLength(3);
    expect(server.s.okPuts.filter((n) => n === 2)).toHaveLength(1);
    expect(server.s.okPuts.filter((n) => n === 1)).toHaveLength(1);
  });

  it("retries a 5xx from storage the same way", async () => {
    const server = fakeServer({
      size: 10,
      onPut: (n, attempt) =>
        n === 1 && attempt === 1 ? new Response(null, { status: 503 }) : undefined,
    });
    const { clock, sleeps } = fakeClock();
    expect((await uploader(10, server, { clock, parallel: 1 }).start()).phase).toBe("complete");
    expect(sleeps).toEqual([1000]);
  });

  it("resumes: skips the parts the server already holds", async () => {
    const server = fakeServer({ size: 10, uploaded: [1] });
    const seen: UploadSnapshot[] = [];
    const end = await uploader(10, server, { onChange: (s) => seen.push(s) }).start();
    expect(end.phase).toBe("complete");
    expect(server.s.puts.sort()).toEqual([2, 3]);
    expect(end.resumedFromPercent).toBe(40);
    expect(seen.find((s) => s.phase === "uploading")?.sentBytes).toBe(4);
  });

  it("never lets progress go backwards, even when complete finds a part missing", async () => {
    const server = fakeServer({ size: 10, missingOnFirstComplete: [2] });
    const seen: UploadSnapshot[] = [];
    const end = await uploader(10, server, { onChange: (s) => seen.push(s) }).start();
    expect(end.phase).toBe("complete");
    expect(server.s.completes).toBe(2);
    expect(server.s.okPuts.filter((n) => n === 2)).toHaveLength(2);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.percent).toBeGreaterThanOrEqual(seen[i - 1]!.percent);
      expect(seen[i]!.sentBytes).toBeGreaterThanOrEqual(seen[i - 1]!.sentBytes);
    }
    // One round of missing parts is silent; the notice is for a second one.
    expect(end.missingPartsNotice).toBe(false);
  });

  it("pauses while offline and carries on when the browser is back", async () => {
    const network = fakeNetwork();
    const server = fakeServer({
      size: 10,
      onPut: (n, attempt) => {
        if (n === 2 && attempt === 1) {
          network.set(false);
          throw new TypeError("Failed to fetch");
        }
        return undefined;
      },
    });
    const { clock, sleeps } = fakeClock();
    const u = uploader(10, server, { clock, connectivity: network.connectivity, parallel: 1 });
    const done = u.start();
    for (let i = 0; i < 20 && u.snapshot.phase !== "offline"; i++) await tick();
    expect(u.snapshot.phase).toBe("offline");
    const putsWhileOffline = server.s.puts.length;
    await tick();
    expect(server.s.puts.length).toBe(putsWhileOffline);
    network.set(true);
    const end = await done;
    expect(end.phase).toBe("complete");
    // Going offline is not a failure: no backoff was spent on it.
    expect(sleeps).toEqual([]);
    expect(server.s.okPuts.sort()).toEqual([1, 2, 3]);
  });

  it("fetches fresh URLs when a part URL has expired (403)", async () => {
    const server = fakeServer({
      size: 10,
      onPut: (n, attempt) =>
        n === 1 && attempt === 1 ? new Response(null, { status: 403 }) : undefined,
    });
    const { clock, sleeps } = fakeClock();
    const end = await uploader(10, server, { clock, parallel: 1 }).start();
    expect(end.phase).toBe("complete");
    expect(server.s.presignCalls).toBe(2);
    expect(sleeps).toEqual([]);
  });

  it("stops with a refusal the user can act on, such as signed out", async () => {
    const server = fakeServer({ size: 10 });
    const fetch: FetchLike = async (url, init) =>
      url.endsWith("/upload") && init?.method === "POST"
        ? json({ error: "forbidden" }, 401)
        : server.fetch(url, init);
    const end = await new MultipartUploader({
      matchId: MATCH,
      file: file(10),
      fetch,
      clock: fakeClock().clock,
      connectivity: fakeNetwork().connectivity,
      storage: null,
    }).start();
    expect(end.phase).toBe("error");
    expect(end.error?.code).toBe("signed_out");
  });

  it("remembers only the video id, fingerprint and file name per match", async () => {
    const storage = memoryStorage();
    const server = fakeServer({
      size: 10,
      // The first part never answers, so the upload stays open while we look.
      onPut: () => new Promise<Response>(() => {}),
    });
    const u = uploader(10, server, { storage, parallel: 1 });
    void u.start();
    for (let i = 0; i < 10 && storage.data.size === 0; i++) await tick();
    expect(readRemembered(storage, MATCH)).toEqual({
      videoId: "v1",
      fingerprint: "fp",
      fileName: "match.mp4",
    });
    expect(JSON.parse([...storage.data.values()][0]!)).toEqual({
      videoId: "v1",
      fingerprint: "fp",
      fileName: "match.mp4",
    });
    u.pause();
  });
});

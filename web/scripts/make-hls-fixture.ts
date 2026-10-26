// The C07 HLS fixture: runs the worker's ffmpeg ladder (ffmpegArgs) on
// tests/fixtures/footage-short-1080p.mp4 into tests/fixtures/hls/ (git-ignored),
// so the e2e can seed a playable match without waiting on the worker. Run in
// the web container by `make fixtures`; an existing fixture is kept.
//
// ffmpegArgs only opens network protocols, so the clip is served over a
// loopback HTTP server with Range support, as object storage would serve it.
import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import {
  ffmpegArgs,
  INIT_SEGMENT,
  ladderFor,
  MASTER_PLAYLIST,
  MEDIA_PLAYLIST,
  normaliseInitName,
} from "../src/server/transcode/ladder";

const fixtures = join(import.meta.dirname, "../tests/fixtures");
const source = join(fixtures, "footage-short-1080p.mp4");
const outDir = join(fixtures, "hls");

if (existsSync(join(outDir, MASTER_PLAYLIST))) {
  console.log("kept hls/");
  process.exit(0);
}
if (!existsSync(source)) throw new Error("footage-short-1080p.mp4 is missing: run make-footage.sh");

const size = (await stat(source)).size;
const server = createServer((req, res) => {
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
  const start = m ? Number(m[1]) : 0;
  const end = m && m[2] ? Number(m[2]) : size - 1;
  res.writeHead(m ? 206 : 200, {
    "Content-Type": "video/mp4",
    "Content-Length": end - start + 1,
    "Accept-Ranges": "bytes",
    ...(m && { "Content-Range": `bytes ${start}-${end}/${size}` }),
  });
  createReadStream(source, { start, end }).pipe(res);
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/footage.mp4`;

const tmp = `${outDir}.tmp`;
await rm(tmp, { recursive: true, force: true });
await mkdir(tmp, { recursive: true });
const ladder = ladderFor(1080);
try {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", ffmpegArgs(url, tmp, ladder, true), {
      stdio: ["ignore", "ignore", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
  });
} finally {
  server.close();
}
for (const r of ladder) {
  const dir = join(tmp, r.name);
  const init = (await readdir(dir)).find((n) => /^init(?:_\d+)?\.mp4$/.test(n));
  if (init && init !== INIT_SEGMENT) {
    await rename(join(dir, init), join(dir, INIT_SEGMENT));
    const playlist = join(dir, MEDIA_PLAYLIST);
    await writeFile(playlist, normaliseInitName(await readFile(playlist, "utf8"), init));
  }
}
await rename(tmp, outDir);
console.log(`made hls/ (${ladder.map((r) => r.name).join(", ")})`);

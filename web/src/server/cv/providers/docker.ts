import { request } from "node:http";
import { cvConfig } from "../config";
import type { GpuInstanceState, GpuListedInstance, GpuProvider, GpuStartSpec } from "./types";

/**
 * Local CV instances (C08): one container per attempt from the
 * wideline-cv-worker image, through the Docker Engine API on the unix socket
 * (node:http, no extra dependency). Only the cv-dispatcher service mounts the
 * socket, and only in development: it is root-equivalent on the host.
 *
 * Containers carry the labels wideline.cv=1, wideline.instanceId and
 * wideline.processingJobId, so the watchdog can find orphans.
 */

const API = "/v1.43";
export const LABEL = "wideline.cv";
const MEMORY_BYTES = 4 * 1024 * 1024 * 1024;

type DockerResponse = { status: number; body: string };

export type DockerTransport = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<DockerResponse>;

/** One Engine API call over the unix socket. */
export function socketTransport(socketPath: string): DockerTransport {
  return (method, path, body) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        {
          socketPath,
          method,
          path: `${API}${path}`,
          headers: payload
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
            : {},
          timeout: 30_000,
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (c: string) => (data += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
        },
      );
      req.on("timeout", () => req.destroy(new Error(`docker ${method} ${path} timed out`)));
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
}

function fail(what: string, res: DockerResponse): never {
  // The Engine's message is short and holds no secrets (no env is echoed).
  let message = res.body.slice(0, 200);
  try {
    message = (JSON.parse(res.body) as { message?: string }).message ?? message;
  } catch {
    // keep the raw text
  }
  throw new Error(`docker ${what} failed (${res.status}): ${message}`);
}

export function dockerProvider(transport?: DockerTransport): GpuProvider {
  const cfg = cvConfig();
  const call = transport ?? socketTransport(cfg.DOCKER_SOCKET);
  return {
    name: "docker",
    billing: {
      centsPerHour: cfg.CV_DOCKER_CENTS_PER_HOUR,
      currency: cfg.CV_DOCKER_CURRENCY,
      minimumSeconds: 0,
      incrementSeconds: 1,
    },

    async start(spec: GpuStartSpec) {
      const name = `wl-cv-${spec.instanceId}`;
      const created = await call("POST", `/containers/create?name=${encodeURIComponent(name)}`, {
        Image: spec.image,
        Cmd: ["job"],
        Env: Object.entries(spec.env).map(([k, v]) => `${k}=${v}`),
        Labels: {
          [LABEL]: "1",
          "wideline.instanceId": spec.instanceId,
          "wideline.processingJobId": spec.processingJobId,
        },
        HostConfig: {
          NetworkMode: cfg.CV_DOCKER_NETWORK,
          Memory: MEMORY_BYTES,
          AutoRemove: false,
        },
      });
      if (created.status !== 201) fail("create", created);
      const id = (JSON.parse(created.body) as { Id: string }).Id;
      const started = await call("POST", `/containers/${id}/start`);
      if (started.status !== 204 && started.status !== 304) fail("start", started);
      return { providerInstanceId: id };
    },

    async status(id): Promise<GpuInstanceState> {
      const res = await call("GET", `/containers/${id}/json`);
      if (res.status === 404) return "gone";
      if (res.status !== 200) fail("inspect", res);
      const state = (JSON.parse(res.body) as { State?: { Status?: string } }).State?.Status;
      if (state === "running" || state === "restarting" || state === "paused") return "running";
      if (state === "created") return "starting";
      return "exited";
    },

    async destroy(id) {
      const res = await call("DELETE", `/containers/${id}?force=true`);
      if (res.status !== 204 && res.status !== 404) fail("remove", res);
    },

    async list(): Promise<GpuListedInstance[]> {
      const filters = encodeURIComponent(JSON.stringify({ label: [`${LABEL}=1`] }));
      const res = await call("GET", `/containers/json?all=1&filters=${filters}`);
      if (res.status !== 200) fail("list", res);
      const rows = JSON.parse(res.body) as {
        Id: string;
        Created: number;
        Labels?: Record<string, string>;
      }[];
      return rows.map((r) => ({
        providerInstanceId: r.Id,
        instanceId: r.Labels?.["wideline.instanceId"] ?? null,
        createdAt: new Date(r.Created * 1000),
      }));
    },
  };
}

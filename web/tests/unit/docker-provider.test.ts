import { describe, expect, it } from "vitest";
import { dockerProvider, type DockerTransport } from "@/server/cv/providers/docker";

// C08 (CV01, NFR07): the local docker provider speaks the Engine API. A fake
// transport records the calls: create carries the wideline labels, the
// compose network and the job spec as environment; start, inspect, delete
// (404 counts as gone) and the labelled list map onto the provider interface.

type Call = { method: string; path: string; body?: unknown };

function fake(responses: Record<string, { status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const transport: DockerTransport = async (method, path, body) => {
    calls.push({ method, path, body });
    const key = Object.keys(responses).find((k) => `${method} ${path}`.startsWith(k));
    const r = key ? responses[key]! : { status: 500, body: { message: "unexpected" } };
    return { status: r.status, body: JSON.stringify(r.body ?? {}) };
  };
  return { calls, transport };
}

describe("dockerProvider", () => {
  it("creates and starts a labelled container on the compose network", async () => {
    const { calls, transport } = fake({
      "POST /containers/create": { status: 201, body: { Id: "abc" } },
      "POST /containers/abc/start": { status: 204 },
    });
    const p = dockerProvider(transport);
    const started = await p.start({
      instanceId: "inst_1",
      processingJobId: "job_1",
      image: "wideline-cv-worker:dev",
      env: { WIDELINE_JOB: '{"jobId":"job_1"}' },
    });
    expect(started).toEqual({ providerInstanceId: "abc" });
    const create = calls[0]!;
    expect(create.path).toBe("/containers/create?name=wl-cv-inst_1");
    expect(create.body).toMatchObject({
      Image: "wideline-cv-worker:dev",
      Cmd: ["job"],
      Env: ['WIDELINE_JOB={"jobId":"job_1"}'],
      Labels: {
        "wideline.cv": "1",
        "wideline.instanceId": "inst_1",
        "wideline.processingJobId": "job_1",
      },
      HostConfig: { NetworkMode: "wideline_default" },
    });
    expect(calls[1]).toMatchObject({ method: "POST", path: "/containers/abc/start" });
  });

  it("reports a failed create without the environment", async () => {
    const { transport } = fake({
      "POST /containers/create": { status: 404, body: { message: "No such image" } },
    });
    const p = dockerProvider(transport);
    await expect(
      p.start({
        instanceId: "i",
        processingJobId: "j",
        image: "x",
        env: { WIDELINE_JOB: "secret" },
      }),
    ).rejects.toThrow(/create failed \(404\): No such image/);
  });

  it("maps container states", async () => {
    for (const [status, want] of [
      ["running", "running"],
      ["created", "starting"],
      ["exited", "exited"],
      ["dead", "exited"],
    ] as const) {
      const { transport } = fake({
        "GET /containers/c/json": { status: 200, body: { State: { Status: status } } },
      });
      expect(await dockerProvider(transport).status("c")).toBe(want);
    }
    const { transport } = fake({ "GET /containers/c/json": { status: 404 } });
    expect(await dockerProvider(transport).status("c")).toBe("gone");
  });

  it("removes with force, and a missing container counts as destroyed", async () => {
    const ok = fake({ "DELETE /containers/c?force=true": { status: 204 } });
    await dockerProvider(ok.transport).destroy("c");
    expect(ok.calls[0]).toMatchObject({ method: "DELETE", path: "/containers/c?force=true" });
    const gone = fake({ "DELETE /containers/c?force=true": { status: 404 } });
    await expect(dockerProvider(gone.transport).destroy("c")).resolves.toBeUndefined();
    const busy = fake({
      "DELETE /containers/c?force=true": { status: 500, body: { message: "busy" } },
    });
    await expect(dockerProvider(busy.transport).destroy("c")).rejects.toThrow(/remove failed/);
  });

  it("lists only labelled containers", async () => {
    const { calls, transport } = fake({
      "GET /containers/json": {
        status: 200,
        body: [
          { Id: "a", Created: 1_761_652_800, Labels: { "wideline.instanceId": "inst_1" } },
          { Id: "b", Created: 1_761_652_800, Labels: {} },
        ],
      },
    });
    const listed = await dockerProvider(transport).list();
    expect(decodeURIComponent(calls[0]!.path)).toBe(
      '/containers/json?all=1&filters={"label":["wideline.cv=1"]}',
    );
    expect(listed).toEqual([
      { providerInstanceId: "a", instanceId: "inst_1", createdAt: new Date(1_761_652_800_000) },
      { providerInstanceId: "b", instanceId: null, createdAt: new Date(1_761_652_800_000) },
    ]);
  });
});

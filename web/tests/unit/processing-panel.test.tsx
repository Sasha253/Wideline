import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { eventsStep, ProcessingPanel } from "@/app/(app)/matches/[matchId]/ProcessingPanel";
import type { ProcessingStep } from "@/server/processing/summary";

// C08 (MATCH07, NFR27; docs/build/design/C07.md, Surface 2, step 2): the
// Finding events step follows the CV job. Every state has an icon, a word and
// a caption (colour only reinforces), and nothing promises passes, which are v1.

const step = (over: Partial<ProcessingStep>): ProcessingStep => ({
  status: "queued",
  attempts: 0,
  maxAttempts: 3,
  startedAt: null,
  finishedAt: null,
  ...over,
});

describe("eventsStep", () => {
  it.each<[string, ProcessingStep | null, string, string | null, string | undefined]>([
    ["no job", null, "Waiting to start", "Starts in a few minutes.", undefined],
    ["queued", step({}), "Waiting to start", "Starts in a few minutes.", undefined],
    [
      "running, attempt 1",
      step({ status: "running", attempts: 1 }),
      "In progress",
      "Looking for goals, shots and touches in the footage.",
      undefined,
    ],
    [
      "running, attempt 2",
      step({ status: "running", attempts: 2 }),
      "In progress, attempt 2 of 3",
      "The first try did not finish, so we are trying again.",
      "retrying",
    ],
    [
      "waiting for a retry",
      step({ status: "queued", attempts: 1 }),
      "Trying again soon, attempt 2 of 3",
      "The last try did not finish. We try again in a minute.",
      "retrying",
    ],
    [
      "succeeded",
      step({ status: "succeeded", attempts: 1 }),
      "Done",
      "A scout checks the events next.",
      undefined,
    ],
    [
      "failed",
      step({ status: "failed", attempts: 3 }),
      "Failed",
      "We tried 3 times. Wideline staff have been told and will try again.",
      "failed",
    ],
    [
      "settled without a try",
      step({ status: "failed", attempts: 0 }),
      "Not started",
      null,
      undefined,
    ],
  ])("%s", (_name, job, state, caption, tone) => {
    const s = eventsStep(job);
    expect(s.name).toBe("Finding events");
    expect(s.state).toBe(state);
    expect(s.caption).toBe(caption);
    expect(s.tone).toBe(tone);
    expect(s.icon).toBeTruthy();
  });

  it("never mentions passes", () => {
    const all = [
      null,
      step({}),
      step({ status: "running", attempts: 1 }),
      step({ status: "succeeded" }),
    ];
    for (const j of all) expect(JSON.stringify(eventsStep(j))).not.toMatch(/pass/i);
  });
});

describe("ProcessingPanel", () => {
  it("shows both steps, each from its own job", () => {
    const html = renderToStaticMarkup(
      <ProcessingPanel
        steps={{
          transcode: step({ status: "succeeded", attempts: 1 }),
          cv: step({ status: "running", attempts: 1 }),
        }}
      />,
    );
    expect(html).toContain('Preparing playback · <span class="body-strong">Ready</span>');
    expect(html).toContain('Finding events · <span class="body-strong">In progress</span>');
    expect(html.match(/<svg/g)).toHaveLength(2);
  });

  it("says so when the status cannot be read", () => {
    expect(renderToStaticMarkup(<ProcessingPanel steps="unavailable" />)).toContain(
      "Processing status is not available right now.",
    );
  });
});

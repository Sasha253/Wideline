import { Check, CircleDashed, TriangleAlert } from "lucide-react";
import { Fragment } from "react";
import { EmptyState } from "@/components/states/EmptyState";
import { DataTable } from "@/components/templates/DataTable";
import { ListPage } from "@/components/templates/ListPage";
import { ButtonLink } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icons";
import { AUTO_ACCEPT_DEFAULTS } from "@/lib/auto-accept";
import { formatDate } from "@/lib/labels";
import { LAB_ROLES, requirePageRole } from "@/server/auth/session";
import {
  benchmarkByModel,
  isSynthetic,
  versionParts,
  type ModelBenchmark,
} from "@/server/lab/benchmark";
import { meetsTarget, type RecallRow, type RecallRowType } from "@/server/lab/recall";
import {
  RateCell,
  RecallTable,
  rateText,
  SmallSample,
  smallSampleText,
  SyntheticChip,
  ToleranceNote,
} from "../lab-ui";

export const metadata = { title: "Benchmark" };

// Recall by model version against the v0 gate (docs/build/design/C09.md,
// Surface 5): 95% of tagged goals and shots found, pooled across matches.

/** An element id for a version; the index keeps two versions that slug alike apart. */
function slug(version: string, index: number): string {
  const base = version
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${index}-${base}`;
}

function row(v: ModelBenchmark, type: RecallRowType): RecallRow {
  return v.rows.find((r) => r.type === type)!;
}

function Gate({ v }: { v: ModelBenchmark }) {
  const goal = row(v, "goal");
  const shot = row(v, "shot");
  if (goal.tagged === 0 || shot.tagged === 0) {
    return (
      <span className="wl-inline-status wl-inline-status--muted">
        <CircleDashed {...iconProps} />
        Not enough tags
      </span>
    );
  }
  return meetsTarget(goal) && meetsTarget(shot) ? (
    <span className="wl-inline-status wl-inline-status--ok">
      <Check {...iconProps} />
      Passes
    </span>
  ) : (
    <span className="wl-inline-status wl-inline-status--warn">
      <TriangleAlert {...iconProps} />
      Does not pass
    </span>
  );
}

function VersionLink({ v, index }: { v: ModelBenchmark; index: number }) {
  const parts = versionParts(v.modelVersion)!;
  return (
    <span className="flex flex-col gap-1">
      <span className="wl-row">
        <a
          href={`#h-${slug(v.modelVersion, index)}`}
          className="font-semibold break-all text-brand-text underline"
        >
          {parts.detector}
        </a>
        {isSynthetic(v.modelVersion) && <SyntheticChip />}
      </span>
      <span className="text-body-s break-all text-ink-muted">
        {[parts.tracker, parts.events].filter(Boolean).join(" · ")}
      </span>
    </span>
  );
}

export default async function BenchmarkPage() {
  const ctx = await requirePageRole(LAB_ROLES);
  const versions = await benchmarkByModel(ctx);

  const goalShot = (v: ModelBenchmark, type: "goal" | "shot") => {
    const r = row(v, type);
    return (
      <RateCell
        matched={r.matched}
        total={r.tagged}
        small={r.tagged ? smallSampleText(r.tagged, v.matches) : null}
      />
    );
  };

  return (
    <ListPage
      header={{
        eyebrow: "CV Lab",
        title: "Benchmark",
        intro:
          "Recall by model version against the v0 gate: 95% of tagged goals and shots found. Tags are pooled across matches.",
      }}
      isEmpty={versions.length === 0}
      empty={
        <EmptyState
          title="No benchmark results yet"
          body="Import hand tags on a Lab match. Recall appears here once that match has a finished CV run."
          action={
            <ButtonLink href="/lab/matches" variant="primary">
              Go to matches
            </ButtonLink>
          }
        />
      }
    >
      <section aria-labelledby="by-version">
        <h2
          id="by-version"
          className="font-display text-heading-section stretch-wide uppercase mb-4"
        >
          By model version
        </h2>
        <DataTable
          caption="Goal and shot recall by model version, latest first"
          columns={[
            { id: "version", header: "Model version" },
            { id: "matches", header: "Matches", numeric: true },
            { id: "goal", header: "Goal recall", numeric: true },
            { id: "shot", header: "Shot recall", numeric: true },
            { id: "gate", header: "v0 gate" },
            { id: "last", header: "Last run" },
          ]}
          rows={versions.map((v, i) => ({
            id: v.modelVersion,
            cells: [
              <VersionLink key="v" v={v} index={i} />,
              <span key="m">{v.matches}</span>,
              <Fragment key="goal">{goalShot(v, "goal")}</Fragment>,
              <Fragment key="shot">{goalShot(v, "shot")}</Fragment>,
              <Gate key="g" v={v} />,
              <span key="l" className="font-mono text-mono-m tabular-nums whitespace-nowrap">
                {formatDate(v.lastRun)}
              </span>,
            ],
          }))}
          cards={versions.map((v, i) => (
            <li key={v.modelVersion} className="wl-card flex flex-col gap-2">
              <VersionLink v={v} index={i} />
              <dl className="wl-facts">
                <dt className="text-label">Matches</dt>
                <dd className="font-mono text-mono-m tabular-nums">{v.matches}</dd>
                <dt className="text-label">Goal recall</dt>
                <dd className="font-mono text-mono-m tabular-nums">
                  {rateText(row(v, "goal").matched, row(v, "goal").tagged) ?? "No tags"}
                </dd>
                <dt className="text-label">Shot recall</dt>
                <dd className="font-mono text-mono-m tabular-nums">
                  {rateText(row(v, "shot").matched, row(v, "shot").tagged) ?? "No tags"}
                </dd>
                <dt className="text-label">v0 gate</dt>
                <dd>
                  <Gate v={v} />
                </dd>
                <dt className="text-label">Last run</dt>
                <dd className="font-mono text-mono-m tabular-nums">{formatDate(v.lastRun)}</dd>
              </dl>
            </li>
          ))}
        />
      </section>
      {versions.map((v, i) => {
        const parts = versionParts(v.modelVersion)!;
        const perRow = Object.fromEntries(v.rows.map((r) => [r.type, r.matches])) as Record<
          RecallRowType,
          number
        >;
        const fewMatches = smallSampleText(Infinity, v.matches);
        return (
          <section
            key={v.modelVersion}
            id={`v-${slug(v.modelVersion, i)}`}
            className="mt-8"
            aria-labelledby={`h-${slug(v.modelVersion, i)}`}
          >
            <h2
              id={`h-${slug(v.modelVersion, i)}`}
              tabIndex={-1}
              className="font-display text-heading-section stretch-wide uppercase break-all"
            >
              {parts.detector}
            </h2>
            {isSynthetic(v.modelVersion) && (
              <div className="wl-row mt-2">
                <SyntheticChip />
              </div>
            )}
            <p className="text-body-s mt-2 text-ink-muted">
              {v.matches} {v.matches === 1 ? "match" : "matches"} · {row(v, "goal").tagged} tagged
              goals · {row(v, "shot").tagged} tagged shots · last run {formatDate(v.lastRun)}
            </p>
            <p className="font-mono text-mono-m tabular-nums mt-1 break-all text-ink-muted">
              {v.modelVersion}
            </p>
            {fewMatches && (
              <p className="mt-1">
                <SmallSample text={fewMatches} />
              </p>
            )}
            <div className="mt-4">
              <RecallTable
                caption={`Recall by event type for ${parts.detector}`}
                rows={v.rows}
                matchesPerRow={perRow}
                versionMatches={v.matches}
              />
            </div>
            {i === 0 && <ToleranceNote thresholds={AUTO_ACCEPT_DEFAULTS} />}
          </section>
        );
      })}
    </ListPage>
  );
}

import { Hourglass } from "lucide-react";
import { ConsentWording } from "@/components/consent/ConsentWording";
import { DataTable, Missing } from "@/components/templates/DataTable";
import { ConsentBadge } from "@/components/ui/ConsentBadge";
import { iconProps } from "@/components/ui/icons";
import {
  CONSENT_METHOD_LABELS,
  CONSENT_STATE_SENTENCES,
  deciderText,
  fillConsentCopy,
  RELATIONSHIP_LABELS,
  yesNo,
} from "@/lib/consent-rules";
import { formatDate, formatDateTime } from "@/lib/labels";
import type { ConsentRecord } from "@/server/consent/records";
import type { ConsentAudience } from "@/server/consent/wording";
import { Facts, metaText } from "../../shared";

// The server-rendered parts of the player page's consent sections
// (docs/build/design/C05.md, Surfaces 4 and 5). The live parts (banners,
// actions, dialogs, the link copy box) are ConsentActions.

/** The date a row is about: the decision for grants and refusals, the withdrawal otherwise. */
const decidedOn = (r: ConsentRecord) => r.grantedAt ?? r.withdrawnAt ?? r.createdAt;

/** "Club: Yes · Scouts: No". */
const choicesText = (r: ConsentRecord) =>
  `Club: ${yesNo(r.clubStats)} · Scouts: ${yesNo(r.scoutVisible)}`;

/** Who recorded a row: the user, the guardian through a link, or a removed user. */
function recorderText(r: ConsentRecord): string {
  if (r.recordedByName) return r.recordedByName;
  if (r.method === "guardian_link" && r.state !== "requested")
    return "The guardian, through the link";
  return "A former member";
}

const audienceOf = (r: { playerWasMinor: boolean }): ConsentAudience =>
  r.playerWasMinor ? "guardian" : "player";

/**
 * The state line and, when the newest row is a decision, its facts (Surface 4,
 * items 2 to 4).
 */
export function ConsentSummary({
  newest,
  state,
  name,
  firstName,
  clubName,
  noDateOfBirth,
  openUntil,
}: {
  newest: ConsentRecord | null;
  state: ConsentRecord["state"];
  name: string;
  firstName: string;
  clubName: string;
  noDateOfBirth: boolean;
  openUntil: Date | null;
}) {
  const refusal = state === "none" && newest?.state === "none" && newest.grantedBy !== null;
  const decider = newest ? deciderText(newest, firstName) : null;
  const sentence = fillConsentCopy(
    refusal ? CONSENT_STATE_SENTENCES.none_refused : CONSENT_STATE_SENTENCES[state],
    {
      first: firstName,
      club: clubName,
      decider: decider ?? "Someone",
      date: newest ? formatDate(decidedOn(newest)) : "",
    },
  );
  const decision = newest && newest.state !== "requested" ? newest : null;

  return (
    <>
      <div className="wl-row">
        <ConsentBadge state={state} />
        <p className="body">{sentence}</p>
      </div>
      {noDateOfBirth && (
        <p className="caption mt-2 text-ink-muted">
          No date of birth, so {firstName} is treated as under 18. Add it under Details.
        </p>
      )}
      {decision && (
        <div className="mt-4">
          <Facts
            items={[
              ["Club stats", yesNo(decision.clubStats)],
              ["Scouts can see stats", yesNo(decision.scoutVisible)],
              [
                "Decided by",
                decision.relationship === "self" ? (
                  <>
                    <span className="body-strong">{name}</span> (the player)
                  </>
                ) : decision.grantedBy ? (
                  <>
                    <span className="body-strong break-words">{decision.grantedBy}</span>
                    {decision.relationship && ` (${RELATIONSHIP_LABELS[decision.relationship]})`}
                  </>
                ) : null,
              ],
              ["How", decision.method && CONSENT_METHOD_LABELS[decision.method]],
              ["Date", formatDate(decidedOn(decision))],
              ["Recorded by", recorderText(decision)],
              [
                "Wording",
                decision.wordingVersion ? (
                  <>
                    <span>
                      Version <span className="data">{decision.wordingVersion}</span>
                    </span>
                    <details className="mt-1">
                      <summary className="body cursor-pointer text-pitch underline">
                        Show the wording
                      </summary>
                      <ConsentWording
                        version={decision.wordingVersion}
                        audience={audienceOf(decision)}
                        headingLevel={3}
                        framed={false}
                        className="mt-2"
                      />
                    </details>
                  </>
                ) : null,
              ],
            ]}
          />
        </div>
      )}
      {openUntil && (
        <p className="body wl-inline-status mt-4">
          <Hourglass {...iconProps} />A guardian link is open until {formatDate(openUntil)}.
        </p>
      )}
    </>
  );
}

/** Every consent row, newest first (Surface 5). Same view for coaches. */
export function ConsentHistory({ rows, name }: { rows: ConsentRecord[]; name: string }) {
  if (rows.length === 0) {
    return (
      <p className="body text-ink-muted">
        No consent records yet. Records appear here when consent is recorded, requested or
        withdrawn.
      </p>
    );
  }

  const who = (r: ConsentRecord) => {
    if (r.state === "requested") return <Missing />;
    if (r.relationship === "self") {
      return (
        <>
          {name}
          <span className="caption block text-ink-muted">The player</span>
        </>
      );
    }
    if (!r.grantedBy) return <Missing />;
    return (
      <>
        <span className="break-words">{r.grantedBy}</span>
        {r.relationship && (
          <span className="caption block text-ink-muted">
            {RELATIONSHIP_LABELS[r.relationship]}
          </span>
        )}
      </>
    );
  };

  // One wording per version that appears, for the audiences it was shown to.
  const versions = new Map<string, Set<ConsentAudience>>();
  for (const r of rows) {
    if (!r.wordingVersion) continue;
    const set = versions.get(r.wordingVersion) ?? new Set<ConsentAudience>();
    set.add(audienceOf(r));
    versions.set(r.wordingVersion, set);
  }

  return (
    <>
      <DataTable
        caption={`Consent history for ${name}, newest first`}
        columns={[
          { id: "when", header: "When" },
          { id: "state", header: "Consent" },
          { id: "choices", header: "Choices" },
          { id: "who", header: "Decided by" },
          { id: "how", header: "How" },
          { id: "by", header: "Recorded by" },
          { id: "wording", header: "Wording" },
        ]}
        rows={rows.map((r) => ({
          id: r.id,
          cells: [
            <span key="when" className="data">
              {formatDateTime(r.createdAt)}
            </span>,
            <ConsentBadge key="state" state={r.state} />,
            r.state === "requested" ? <Missing key="choices" /> : choicesText(r),
            <span key="who">{who(r)}</span>,
            r.method ? CONSENT_METHOD_LABELS[r.method] : <Missing key="how" />,
            recorderText(r),
            r.wordingVersion ? (
              <span key="wording" className="data">
                {r.wordingVersion}
              </span>
            ) : (
              <Missing key="wording" />
            ),
          ],
        }))}
        cards={rows.map((r) => {
          const decider = r.relationship === "self" ? `${name} (the player)` : deciderText(r, name);
          return (
            <li key={r.id} className="wl-card flex flex-col gap-1">
              <div className="wl-row">
                <ConsentBadge state={r.state} />
                <span className="data text-ink-muted">{formatDateTime(r.createdAt)}</span>
              </div>
              {r.state !== "requested" && (
                <p className="body">
                  Club stats: {yesNo(r.clubStats)} · Scouts: {yesNo(r.scoutVisible)}
                </p>
              )}
              <p className="caption text-ink-muted">
                {r.state === "requested"
                  ? "Guardian link created"
                  : [
                      decider && `Decided by ${decider}`,
                      r.method && CONSENT_METHOD_LABELS[r.method],
                    ]
                      .filter(Boolean)
                      .join(", ")}
              </p>
              <p className="caption text-ink-muted">
                {metaText([
                  `Recorded by ${recorderText(r)}`,
                  r.wordingVersion && `Wording ${r.wordingVersion}`,
                ])}
              </p>
            </li>
          );
        })}
      />
      {versions.size > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {[...versions].map(([version, audiences]) => (
            <details key={version}>
              <summary className="body cursor-pointer text-pitch underline">
                Wording {version}
              </summary>
              <div className="mt-2 flex flex-col gap-4">
                {(["guardian", "player"] as const)
                  .filter((a) => audiences.has(a))
                  .map((a) => (
                    <ConsentWording key={a} version={version} audience={a} headingLevel={3} />
                  ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </>
  );
}

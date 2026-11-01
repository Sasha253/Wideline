"use client";

import { Link2, Play } from "lucide-react";
import { useId, useState } from "react";
import { EmptyState } from "@/components/states/EmptyState";
import { Button } from "@/components/ui/Button";
import { TeamMarker } from "@/components/ui/TeamMarker";
import {
  eventsText,
  type ReviewSide,
  type WorkspaceEntry,
  type WorkspaceEvent,
  type WorkspaceTrack,
} from "@/lib/review-workspace";
import type { ReviewRefusal } from "./actions";
import { ReviewDialog } from "./ReviewDialog";

/**
 * The track-link editor (REVIEW06; docs/build/design/C11.md, Surface 3): the
 * tracks the model followed, unlinked ones with events first, and a dialog
 * that links one to a lineup player, saying how many events move. Saving
 * moves every event of the track in one transaction (relinkTrack). A refused
 * link removes the track; the workspace shows the discard notice.
 */
export function TrackLinkEditor({
  tracks,
  events,
  entries,
  teams,
  readOnly,
  onWatch,
  onLink,
}: {
  tracks: readonly WorkspaceTrack[];
  events: readonly WorkspaceEvent[];
  entries: readonly WorkspaceEntry[];
  teams: Record<ReviewSide, string>;
  readOnly: boolean;
  onWatch: (track: WorkspaceTrack) => void;
  /** Resolves to a refusal, or null once saved (or discarded). */
  onLink: (track: WorkspaceTrack, entryId: string | null) => Promise<ReviewRefusal | null>;
}) {
  const [linking, setLinking] = useState<WorkspaceTrack | null>(null);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const selectId = useId();
  const noLineupId = useId();

  const entryById = new Map(entries.map((e) => [e.id, e]));
  const count = (t: WorkspaceTrack) => events.filter((e) => e.trackId === t.id).length;
  const order = (a: WorkspaceTrack, b: WorkspaceTrack) =>
    Number(a.entryId !== null) - Number(b.entryId !== null) ||
    count(b) - count(a) ||
    a.index - b.index;
  const withEvents = tracks.filter((t) => count(t) > 0).sort(order);
  const empty = tracks.filter((t) => count(t) === 0).sort(order);

  if (tracks.length === 0) {
    return (
      <EmptyState
        art={false}
        headingLevel={2}
        title="No tracks found"
        body="The model did not follow any players in this match. You can still check events and give them to a player one at a time."
      />
    );
  }

  function open(t: WorkspaceTrack) {
    setLinking(t);
    setChoice(t.entryId ?? "");
    setError(null);
  }

  async function save() {
    if (!linking) return;
    setPending(true);
    const refusal = await onLink(linking, choice || null);
    setPending(false);
    if (refusal) setError(refusal.message);
    else setLinking(null);
  }

  const options = (t: WorkspaceTrack) => {
    const bySide = (s: ReviewSide) =>
      entries.filter((e) => e.side === s).sort((a, b) => a.shirtNumber - b.shirtNumber);
    if (t.side) return { flat: bySide(t.side), groups: null };
    return { flat: null, groups: (["home", "away"] as const).map((s) => [s, bySide(s)] as const) };
  };
  const hasLineup = (t: WorkspaceTrack) =>
    t.side ? entries.some((e) => e.side === t.side) : entries.length > 0;

  const effect = (() => {
    if (!linking) return "";
    const n = count(linking);
    if ((choice || null) === linking.entryId) return "No change.";
    if (n === 0) return "This track has no events yet.";
    if (!choice) return `This unlinks the track. Its ${eventsText(n)} go back to the team.`;
    return `This moves ${eventsText(n)} to ${entryById.get(choice)?.label ?? "this player"}.`;
  })();

  const row = (t: WorkspaceTrack) => {
    const n = count(t);
    const linked = t.entryId ? entryById.get(t.entryId) : undefined;
    return (
      <li
        key={t.id}
        data-track-id={t.id}
        className="flex flex-col gap-2 border-b border-line bg-panel p-3 last:border-b-0"
      >
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold">Track {t.index}</span>
          {t.side ? (
            <TeamMarker side={t.side} name={t.side === "home" ? teams.home : teams.away} />
          ) : (
            <span className="text-ink-muted">
              <span className="sr-only">Side not set: </span>side not set
            </span>
          )}
          {linked ? (
            <span>{linked.label}</span>
          ) : (
            <span className="text-ink-muted">Not linked</span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-mono-m text-ink-muted tabular-nums">{eventsText(n)}</span>
          {n > 0 && (
            <Button
              variant="ghost"
              size="s"
              icon={Play}
              aria-label={`Watch track ${t.index}`}
              onClick={() => onWatch(t)}
            >
              Watch
            </Button>
          )}
          {!readOnly &&
            (hasLineup(t) ? (
              <Button
                variant="secondary"
                size="s"
                icon={Link2}
                data-link-track={t.id}
                aria-label={
                  linked ? `Change link for track ${t.index}` : `Link player to track ${t.index}`
                }
                onClick={() => open(t)}
              >
                {linked ? "Change link" : "Link player"}
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  size="s"
                  icon={Link2}
                  aria-disabled="true"
                  aria-describedby={`${noLineupId}-${t.id}`}
                  aria-label={`Link player to track ${t.index}`}
                >
                  Link player
                </Button>
                <span id={`${noLineupId}-${t.id}`} className="text-body-s text-ink-muted">
                  The club has not entered a lineup for this side.
                </span>
              </>
            ))}
        </div>
      </li>
    );
  };

  const opts = linking ? options(linking) : null;

  return (
    <>
      <p className="m-0 text-body-s text-ink-muted">
        A track is one player the model followed. Linking it moves all its events to that player.
      </p>
      {withEvents.length > 0 && (
        <ul aria-label="Tracks" className="m-0 mt-3 list-none border border-line p-0">
          {withEvents.map(row)}
        </ul>
      )}
      {empty.length > 0 && (
        <details className="mt-3">
          <summary className="flex min-h-control-l cursor-pointer items-center font-semibold tablet:min-h-0">
            Tracks with no events ({empty.length})
          </summary>
          <ul
            aria-label="Tracks with no events"
            className="m-0 mt-2 list-none border border-line p-0"
          >
            {empty.map(row)}
          </ul>
        </details>
      )}
      {!readOnly && (
        <ReviewDialog
          open={linking !== null}
          title={linking ? `Link track ${linking.index}` : "Link track"}
          body="Choose the player this track follows."
          formError={error}
          pending={pending}
          submitLabel={choice ? "Link track" : "Unlink track"}
          pendingLabel="Saving…"
          submitDisabled={!linking || (choice || null) === linking.entryId}
          onSubmit={save}
          onClose={() => setLinking(null)}
        >
          {linking && opts && (
            <>
              <div className="flex flex-col gap-2">
                <label htmlFor={selectId} className="text-label">
                  Player
                </label>
                <select
                  id={selectId}
                  className="wl-input"
                  value={choice}
                  onChange={(e) => setChoice(e.target.value)}
                >
                  <option value="">No player (unlink)</option>
                  {opts.flat?.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                  {opts.groups?.map(([s, list]) => (
                    <optgroup key={s} label={`${s === "home" ? "Home" : "Away"} · ${teams[s]}`}>
                      {list.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <p className="m-0" aria-live="polite">
                {effect}
              </p>
            </>
          )}
        </ReviewDialog>
      )}
    </>
  );
}

/** The first event time of a track, for Watch. */
export function firstEventMs(events: readonly WorkspaceEvent[], trackId: string): number | null {
  const times = events.filter((e) => e.trackId === trackId).map((e) => e.timestampMs);
  return times.length ? Math.min(...times) : null;
}

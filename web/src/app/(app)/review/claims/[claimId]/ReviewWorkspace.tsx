"use client";

import {
  ArrowLeft,
  ArrowLeftRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  CirclePlay,
  Clock,
  Keyboard,
  Pencil,
  Plus,
  Star,
  X,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Banner } from "@/components/forms";
import { useSectionAction } from "@/components/section-result";
import { useKeyboardShortcutsEntry } from "@/components/shell/shortcuts";
import { EmptyState } from "@/components/states/EmptyState";
import { Button, ButtonLink, IconButton, Kbd } from "@/components/ui/Button";
import { ConfidenceMeter } from "@/components/ui/ConfidenceMeter";
import { cx } from "@/components/ui/cx";
import { ExpiryBanner } from "@/components/ui/ExpiryBanner";
import { iconProps } from "@/components/ui/icons";
import { Modal } from "@/components/ui/Modal";
import {
  eventDisc,
  LOW_CONFIDENCE,
  ReviewEventListHeader,
  ReviewEventRow,
  SAVED_MS,
} from "@/components/ui/ReviewEventRow";
import { SegmentedFilter } from "@/components/ui/SegmentedFilter";
import { EventStatusChip } from "@/components/ui/StatusChip";
import { TabPanel, Tabs, tabId } from "@/components/ui/Tabs";
import { TeamMarker } from "@/components/ui/TeamMarker";
import { ReviewThemeScopeClient } from "@/components/ui/theme-client";
import type { ThemeChoice } from "@/components/ui/theme-constants";
import { HlsPlayer, type HlsPlayerHandle, type PlayerSource } from "@/components/video/HlsPlayer";
import type { ActionResult } from "@/lib/action-result";
import { keyAction, readSingleKeys, SINGLE_KEYS_STORAGE, type KeyAction } from "@/lib/review-keys";
import {
  applyPatch,
  cueMs,
  eventsText,
  eventTime,
  eventTypeText,
  eventWho,
  hasMatchClock,
  initialSelection,
  neighbourId,
  nextPendingId,
  pendingCount,
  progress,
  visibleEvents,
  type ReviewSide,
  type WorkspaceEvent,
  type WorkspaceFacts,
  type WorkspacePatch,
  type WorkspaceTrack,
} from "@/lib/review-workspace";
import type { WorkspaceData } from "@/server/review/workspace";
import {
  addMissedEventAction,
  confirmEventAction,
  editEventAction,
  favouriteClipAction,
  rejectEventAction,
  relinkTrackAction,
  swapTeamsAction,
  unfavouriteClipAction,
  type ReviewRefusal,
} from "./actions";
import { AddMissedEventPanel } from "./AddMissedEventPanel";
import { EditEventDialog } from "./EditEventDialog";
import type { EventFieldValues } from "./EventFields";
import { ReviewWatermark } from "./ReviewWatermark";
import { SubmitReview } from "./SubmitReview";
import { Timeline, type TimelineHandle } from "./Timeline";
import { firstEventMs, TrackLinkEditor } from "./TrackLinkEditor";
import { WhoLabel } from "./WhoLabel";

/**
 * The review workspace (C11; REVIEW03 to REVIEW09, REVIEW11, PROF08; Floodlight, Screens B
 * "Review workspace"). Always dark unless the user chose Light in the account menu. A
 * compact header (Queue, the fixture, progress ticks, keyboard shortcuts, Mark as
 * reviewed with how many are left), the expiry banner, then an 8/4 split from 1280px:
 * video, its tools and the match timeline on the left; the event list on the right, the
 * selected row open with Confirm Y, Reject N and Edit E. Stacked below 1280px; on phones
 * the selected event becomes a card with 56px buttons and an Up next list.
 *
 * J and K move, Y confirms, N rejects, E edits, A adds a missed event, ? lists the keys,
 * Space and the arrows drive the video; only while focus is in the workspace (A11Y.md 5).
 * Confirm, reject and favourite update at once and roll back if the server refuses; the
 * rest wait for the server. Writes run one after another, in order. The list never
 * reorders. A "Log in as" session is read-only (Q-064): no write control is rendered, and
 * the server refuses them anyway.
 */

type Message = { tone: "ok" | "warn" | "danger"; text: string } | null;
type StatusFilter = "all" | "pending" | "confirmed" | "rejected";

export const IMPERSONATION_REVIEW_REFUSED =
  "You are logged in as this scout. Only the scout can make review decisions.";
const SIDES_UNCONFIRMED =
  "We could not tell which team is home from the footage. Check a few events, and swap home and away if they are the wrong way round.";
const SEEK_STEP_MS = 5000;
/** The most progress ticks in the header; longer lists are shown in proportion. */
const MAX_TICKS = 24;

const SHORTCUTS = [
  ["J", "Next event"],
  ["K", "Previous event"],
  ["Y", "Confirm"],
  ["N", "Reject"],
  ["E", "Edit"],
  ["A", "Add missed event"],
  ["Space", "Play or pause"],
  ["← →", "Move 5 s"],
  ["?", "Keyboard shortcuts"],
] as const;
/** Y, N, E and A decide or edit; a read-only ("Log in as") workspace does not offer them. */
const DECISION_KEYS: ReadonlySet<string> = new Set(["Y", "N", "E", "A"]);

/** The status disc's icon and word (as in ReviewEventRow): never colour alone. */
const DISC_LOOK: Record<ReturnType<typeof eventDisc>, { icon: LucideIcon; label: string }> = {
  confirmed: { icon: Check, label: "Confirmed" },
  pending: { icon: Clock, label: "Pending" },
  rejected: { icon: X, label: "Rejected" },
  auto: { icon: CheckCheck, label: "Auto-accepted" },
  added: { icon: Plus, label: "Added by a scout" },
};

/** A row's own class, so selection can scroll it into view (cuid ids are class-safe). */
const rowClass = (id: string) => `wl-review-ev-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;

const STATE_WORDS: Record<WorkspaceEvent["status"], string> = {
  pending_review: "pending review",
  auto_accepted: "auto-accepted",
  confirmed: "confirmed",
  rejected: "rejected",
  manual: "added by you",
};

const inFilter = (e: WorkspaceEvent, f: StatusFilter) => f === "all" || eventDisc(e.status) === f;

// WCAG 2.1.4 single-key setting, kept per browser in localStorage. A small
// external store, so the workspace reads it with useSyncExternalStore (the
// server and first paint use the default, on). `fallback` holds the value for
// this page when storage is blocked.
const singleKeysListeners = new Set<() => void>();
let singleKeysFallback = true;
function subscribeSingleKeys(cb: () => void) {
  singleKeysListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    singleKeysListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function readSingleKeysSetting(): boolean {
  try {
    const raw = window.localStorage.getItem(SINGLE_KEYS_STORAGE);
    return raw === null ? singleKeysFallback : readSingleKeys(raw);
  } catch {
    return singleKeysFallback;
  }
}
function writeSingleKeysSetting(on: boolean) {
  singleKeysFallback = on;
  try {
    window.localStorage.setItem(SINGLE_KEYS_STORAGE, on ? "on" : "off");
  } catch {
    // Storage blocked: the setting lasts for this page.
  }
  singleKeysListeners.forEach((cb) => cb());
}

type Tick = "confirmed" | "rejected" | "pending";

/** The header's progress ticks: settled to-check events in proportion, pending last. */
function progressTicks(events: readonly WorkspaceEvent[]): Tick[] {
  const set = events.filter((e) => e.toCheck && !e.manual);
  const total = set.length;
  if (total === 0) return [];
  const n = Math.min(total, MAX_TICKS);
  const rejected = set.filter((e) => e.status === "rejected").length;
  const settled = set.filter((e) => e.status !== "pending_review").length;
  const settledTicks = Math.round((settled / total) * n);
  const rejectedTicks = Math.min(
    settledTicks,
    rejected > 0 ? Math.max(1, Math.round((rejected / total) * n)) : 0,
  );
  return Array.from({ length: n }, (_, i): Tick =>
    i < settledTicks - rejectedTicks ? "confirmed" : i < settledTicks ? "rejected" : "pending",
  );
}

export function ReviewWorkspace({
  claimId,
  fixture,
  meta,
  teams,
  data,
  facts,
  hlsUrl,
  clipsOnly,
  rawExpiresAt,
  now,
  scoutName,
  readOnly,
  themeChoice,
}: {
  claimId: string;
  fixture: string;
  /** "12 Oct 2026 · U17 League", missing parts left out. */
  meta: string;
  teams: Record<ReviewSide, string>;
  data: WorkspaceData;
  facts: WorkspaceFacts;
  hlsUrl: string;
  clipsOnly: boolean;
  /** When the raw footage is (or was) deleted: the expiry banner under the header. */
  rawExpiresAt: Date | null;
  /** The server's time at render, for the banner's countdown. */
  now: Date;
  scoutName: string;
  readOnly: boolean;
  /** The stored theme choice (cookie), so the first paint is already right. */
  themeChoice: ThemeChoice;
}) {
  const router = useRouter();
  const ids = useId();
  const tabsId = `${ids}-lists`;
  const rootRef = useRef<HTMLElement>(null);
  const playerRef = useRef<HlsPlayerHandle>(null);
  // Two timelines, switched with CSS: the full one from 768px, the phone strip below.
  const timelineRef = useRef<TimelineHandle>(null);
  const stripRef = useRef<TimelineHandle>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const cuedOnReady = useRef(false);

  // Server data, adopted again whenever the page re-renders (after a swap).
  const [base, setBase] = useState({ data, facts });
  const [events, setEvents] = useState(data.events);
  const [tracks, setTracks] = useState(data.tracks);
  const [counts, setCounts] = useState(facts.counts);
  const [favourites, setFavourites] = useState(() => new Set(facts.favouritedClipIds));
  if (base.data !== data || base.facts !== facts) {
    setBase({ data, facts });
    setEvents(data.events);
    setTracks(data.tracks);
    setCounts(facts.counts);
    setFavourites(new Set(facts.favouritedClipIds));
  }

  const [showAuto, setShowAuto] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [currentId, setCurrentId] = useState(() =>
    initialSelection(visibleEvents(data.events, false)),
  );
  const [tab, setTab] = useState<"events" | "tracks">("events");
  const [message, setMessage] = useState<Message>(null);
  const [announce, setAnnounce] = useState("");
  const [busy, setBusy] = useState<ReadonlyMap<string, number>>(new Map());
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<WorkspaceEvent | null>(null);
  const [adding, setAdding] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // WCAG 2.1.4: single-key shortcuts can be turned off (kept per browser).
  const singleKeys = useSyncExternalStore(subscribeSingleKeys, readSingleKeysSetting, () => true);
  const setSingleKeys = writeSingleKeysSetting;

  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  useKeyboardShortcutsEntry(openShortcuts);

  const entries = data.entries;
  const entryMap = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const trackMap = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const rows = useMemo(() => visibleEvents(events, showAuto), [events, showAuto]);
  const shown = useMemo(() => rows.filter((e) => inFilter(e, filter)), [rows, filter]);
  const current = events.find((e) => e.id === currentId) ?? null;
  const markers = data.video.markers;
  const half = data.match.halfLengthMinutes;
  const clockOk = hasMatchClock(markers, half);
  const autoCount = events.filter((e) => !e.toCheck && !e.manual).length;
  const { checked, total } = progress(events);
  const remaining = pendingCount(events);
  const canAdd = !clipsOnly && data.video.section === "waiting";
  const linkedTracks = tracks.filter((t) => t.entryId !== null).length;
  const ticks = progressTicks(events);
  const durationMs =
    data.video.durationMs ?? Math.max(1, ...events.map((e) => e.timestampMs + 1000));

  const timeOf = useCallback(
    (e: WorkspaceEvent) => eventTime(e.timestampMs, markers, half),
    [markers, half],
  );
  const whoOf = useCallback(
    (e: WorkspaceEvent) => eventWho(e, entryMap, trackMap),
    [entryMap, trackMap],
  );

  function describe(e: WorkspaceEvent, list = shown): string {
    const at = list.findIndex((r) => r.id === e.id) + 1;
    const side = e.side === "home" ? "Home side" : e.side === "away" ? "Away side" : "Side not set";
    const conf = e.confidence === null ? "" : `, ${e.confidence.toFixed(2)} confidence`;
    const state = STATE_WORDS[e.status];
    const of = at > 0 ? `Event ${at} of ${list.length}. ` : "";
    return `${of}${timeOf(e)}, ${eventTypeText(e)}, ${side}, ${whoOf(e)}${conf}, ${state}.`;
  }

  // ---- Video ----------------------------------------------------------------

  const source: PlayerSource | null = useMemo(() => {
    if (!clipsOnly && data.video.hls) return { kind: "hls", url: hlsUrl };
    const clipId = current?.clipId;
    if (!clipId) return null;
    const url = `/api/review/claims/${encodeURIComponent(claimId)}/clips/${encodeURIComponent(clipId)}`;
    return {
      kind: "file",
      url,
      contentType: "video/mp4",
      refresh: async () => `${url}?r=${Date.now()}`,
    };
  }, [clipsOnly, data.video.hls, hlsUrl, claimId, current?.clipId]);
  const fileMode = source?.kind === "file";

  function cue(e: WorkspaceEvent | null) {
    if (!e || fileMode) return;
    playerRef.current?.seekTo(cueMs(e));
  }

  // ---- Selection ------------------------------------------------------------

  function select(
    id: string | null,
    { say, list = shown }: { say?: string; list?: WorkspaceEvent[] } = {},
  ) {
    const e = id ? (events.find((x) => x.id === id) ?? list.find((x) => x.id === id)) : null;
    setCurrentId(id);
    if (e) {
      // An event outside the status filter shows the whole list again.
      if (!inFilter(e, filter)) setFilter("all");
      cue(e);
      requestAnimationFrame(() =>
        document.querySelector(`.${rowClass(e.id)}`)?.scrollIntoView({ block: "nearest" }),
      );
      setAnnounce([say, describe(e, list)].filter(Boolean).join(" "));
    }
  }

  function step(dir: 1 | -1) {
    const next = neighbourId(shown, currentId, dir);
    if (next === null) {
      setAnnounce(dir === 1 ? "Last event." : "First event.");
      return;
    }
    select(next);
  }

  function flash(idsToFlash: string[]) {
    setSaved(new Set());
    requestAnimationFrame(() => setSaved(new Set(idsToFlash)));
    window.setTimeout(() => setSaved(new Set()), SAVED_MS);
  }

  function advanceFrom(fromId: string, list: WorkspaceEvent[], say: string) {
    const next = nextPendingId(list, fromId);
    if (pendingCount(list) === 0) {
      setAnnounce(`${say} All events checked. You can mark the match as reviewed.`);
      return;
    }
    if (next && next !== fromId) select(next, { say, list });
    else setAnnounce(say);
  }

  // ---- Writes ---------------------------------------------------------------

  function markBusy(id: string, delta: 1 | -1) {
    setBusy((b) => {
      const n = new Map(b);
      const v = (n.get(id) ?? 0) + delta;
      if (v > 0) n.set(id, v);
      else n.delete(id);
      return n;
    });
  }

  /** Runs a write after the ones before it. */
  function enqueue<T>(busyId: string | null, task: () => Promise<T>): Promise<T> {
    if (busyId) markBusy(busyId, 1);
    const run = queue.current.then(task);
    queue.current = run.catch(() => undefined);
    return run.finally(() => busyId && markBusy(busyId, -1));
  }

  function settle(patch: WorkspacePatch) {
    setEvents((es) => applyPatch(es, patch));
    if (patch.tracks.length || patch.removedTrackIds.length) {
      const changed = new Map(patch.tracks.map((t) => [t.id, t]));
      setTracks((ts) =>
        ts.filter((t) => !patch.removedTrackIds.includes(t.id)).map((t) => changed.get(t.id) ?? t),
      );
    }
    setCounts(patch.counts);
  }

  function refused(r: ReviewRefusal) {
    setMessage({ tone: r.code === "favourite_cap" ? "warn" : "danger", text: r.message });
  }

  function decide(e: WorkspaceEvent | null, kind: "confirm" | "reject") {
    if (!e || readOnly) return;
    const status = kind === "confirm" ? (e.manual ? "manual" : "confirmed") : "rejected";
    if (e.status === status) return;
    const before = e;
    const list = visibleEvents(
      events.map((x) => (x.id === e.id ? { ...x, status } : x)),
      showAuto,
    );
    setEvents((es) => es.map((x) => (x.id === e.id ? { ...x, status } : x)));
    flash([e.id]);
    advanceFrom(e.id, list, kind === "confirm" ? "Confirmed." : "Rejected.");
    void enqueue(e.id, async () => {
      const r = await (kind === "confirm" ? confirmEventAction : rejectEventAction)(claimId, e.id);
      if (!r?.ok) {
        setEvents((es) => es.map((x) => (x.id === before.id ? before : x)));
        if (r) refused(r);
        return;
      }
      settle(r.result);
      setMessage(null);
    });
  }

  function openEdit(e: WorkspaceEvent | null) {
    if (!e || readOnly) return;
    setCurrentId(e.id);
    setEditing(e);
  }

  async function saveEdit(e: WorkspaceEvent, v: EventFieldValues): Promise<ReviewRefusal | null> {
    const r = await enqueue(e.id, () =>
      editEventAction(claimId, {
        eventId: e.id,
        type: v.type,
        onTarget: v.type === "shot" ? v.onTarget : null,
        side: v.side,
        entryId: v.entryId,
      }),
    );
    if (!r?.ok) return r ?? null;
    const list = visibleEvents(applyPatch(events, r.result), showAuto);
    settle(r.result);
    setMessage(null);
    setEditing(null);
    flash([e.id]);
    advanceFrom(e.id, list, "Saved.");
    return null;
  }

  async function toggleFavourite(e: WorkspaceEvent) {
    const clipId = e.clipId;
    if (!clipId || readOnly) return;
    const on = !favourites.has(clipId);
    const flip = (value: boolean) =>
      setFavourites((f) => {
        const n = new Set(f);
        if (value) n.add(clipId);
        else n.delete(clipId);
        return n;
      });
    flip(on);
    const r = await enqueue(e.id, () =>
      (on ? favouriteClipAction : unfavouriteClipAction)(claimId, clipId),
    );
    if (!r?.ok) {
      flip(!on);
      if (r) refused(r);
    } else {
      setMessage(null);
    }
  }

  async function link(t: WorkspaceTrack, entryId: string | null): Promise<ReviewRefusal | null> {
    const r = await enqueue(null, () => relinkTrackAction(claimId, { trackId: t.id, entryId }));
    if (!r?.ok) return r ?? null;
    settle(r.result);
    if (r.result.discarded) {
      setMessage({
        tone: "warn",
        text: `Track ${t.index} was removed. This player's events cannot be recorded, so its ${eventsText(r.result.moved)} stay with the team.`,
      });
      // Focus the next row's link button, or the Tracks tab.
      requestAnimationFrame(() => {
        const next = document.querySelector<HTMLElement>(`[data-link-track]`);
        (next ?? document.getElementById(tabId(tabsId, "tracks")))?.focus();
      });
    } else {
      setMessage(null);
      flash(r.result.events.map((x) => x.id));
    }
    return null;
  }

  async function addMissed(at: number, v: EventFieldValues): Promise<ReviewRefusal | null> {
    const r = await enqueue(null, () =>
      addMissedEventAction(claimId, {
        timestampMs: at,
        type: v.type,
        onTarget: v.type === "shot" ? v.onTarget : null,
        side: v.side,
        entryId: v.entryId,
      }),
    );
    if (!r?.ok) return r ?? null;
    settle(r.result);
    const added = r.result.added;
    setAdding(false);
    setMessage(
      r.result.notAttributable
        ? {
            tone: "warn",
            text: `Event added to the ${v.side} team. This player's events cannot be recorded.`,
          }
        : null,
    );
    if (added) {
      setFilter("all");
      setCurrentId(added.id);
      flash([added.id]);
      setAnnounce(`Event added at ${eventTime(added.timestampMs, markers, half)}.`);
    }
    return null;
  }

  const swapForm = useSectionAction(
    swapTeamsAction,
    (result: ActionResult) => {
      if (result?.ok) {
        setMessage({ tone: "ok", text: result.message });
        router.refresh();
      }
    },
    { okOnly: true },
  );

  function blockedSubmit() {
    const first =
      rows.find((r) => r.status === "pending_review") ??
      events.find((r) => r.status === "pending_review");
    if (first) {
      if (!rows.some((r) => r.id === first.id)) setShowAuto(true);
      setTab("events");
      select(first.id, { say: `Check the ${eventsText(remaining)} left first.` });
    }
  }

  // ---- Keyboard -------------------------------------------------------------

  const handlers = useRef<Record<KeyAction, () => void>>(null as never);
  useLayoutEffect(() => {
    handlers.current = {
      next: () => step(1),
      previous: () => step(-1),
      confirm: () => decide(current, "confirm"),
      reject: () => decide(current, "reject"),
      edit: () => openEdit(current),
      add: () => {
        if (canAdd && !readOnly) setAdding(true);
      },
      shortcuts: openShortcuts,
      toggle: () => playerRef.current?.toggle(),
      seekBack: () => playerRef.current?.seekBy(-SEEK_STEP_MS),
      seekForward: () => playerRef.current?.seekBy(SEEK_STEP_MS),
    };
  });
  useLayoutEffect(() => {
    function onKey(e: KeyboardEvent) {
      // A11Y.md 5: the single keys work only while focus is in the workspace (or nowhere),
      // never from the shell's nav, the account menu or the claim facts under it.
      const target = e.target as Node | null;
      const nowhere = !target || target === document.body || target === document.documentElement;
      if (!nowhere && !rootRef.current?.contains(target)) return;
      const action = keyAction(
        {
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          target: e.target as HTMLElement | null,
        },
        { readOnly, singleKeys, dialogOpen: document.querySelector("dialog[open]") !== null },
      );
      if (!action) return;
      e.preventDefault();
      handlers.current[action]();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [readOnly, singleKeys]);

  // ---- Render ---------------------------------------------------------------

  const clipsOnlyId = `${ids}-clipsonly`;
  const favourite = current?.clipId ? favourites.has(current.clipId) : false;
  const isBusy = current ? busy.has(current.id) : false;
  const filterCount = (f: StatusFilter) => rows.filter((e) => inFilter(e, f)).length;

  const progressText =
    total === 0 ? (
      "Nothing to check"
    ) : checked === total ? (
      <>
        All <span className="font-mono tabular-nums">{total}</span> checked
      </>
    ) : (
      <>
        <span className="font-mono tabular-nums">{checked}</span> of{" "}
        <span className="font-mono tabular-nums">{total}</span> checked
      </>
    );

  const header = (
    <header
      data-testid="review-header"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-3 py-2 tablet:min-h-13 tablet:flex-nowrap tablet:px-4"
    >
      <ButtonLink variant="secondary" size="m" icon={ArrowLeft} href="/review" className="shrink-0">
        <span className="sr-only">Back to the </span>Queue
      </ButtonLink>
      <h1 className="m-0 flex min-w-0 flex-1 items-center gap-2.5 font-display text-heading-section uppercase stretch-wide">
        <span className="sr-only">{fixture}</span>
        <span aria-hidden="true" className="flex min-w-0 items-center gap-2.5">
          <TeamMarker side="home" name={teams.home} truncate />
          <span className="font-mono text-mono-m font-normal text-ink-muted normal-case">v</span>
          <TeamMarker side="away" name={teams.away} truncate />
        </span>
      </h1>
      {meta && (
        <span className="hidden shrink-0 font-mono text-mono-m text-ink-muted wide:inline">
          {meta}
        </span>
      )}
      {total > 0 && (
        <span className="flex shrink-0 items-center gap-2.5">
          <span className="hidden gap-0.5 desktop:flex" aria-hidden="true">
            {ticks.map((t, i) => (
              <span
                key={i}
                className={cx(
                  "h-4 w-1",
                  t === "confirmed"
                    ? "bg-confirmed"
                    : t === "rejected"
                      ? "bg-rejected"
                      : "bg-line-strong",
                )}
              />
            ))}
          </span>
          <span className="font-mono text-mono-m font-semibold tabular-nums">
            {checked}
            <span className="text-ink-muted">/{total}</span>
            <span className="sr-only"> checked</span>
          </span>
        </span>
      )}
      <IconButton
        icon={Keyboard}
        variant="secondary"
        aria-label="Keyboard shortcuts"
        className="hidden shrink-0 tablet:inline-flex"
        onClick={openShortcuts}
      />
      {!readOnly && (
        <span className="w-full shrink-0 tablet:w-auto">
          <SubmitReview
            claimId={claimId}
            remaining={remaining}
            counts={counts}
            onBlocked={blockedSubmit}
            block
          />
        </span>
      )}
    </header>
  );

  const notices = (
    <div aria-live="polite" className="empty:hidden">
      {message && (
        <div className="px-3 pt-3 tablet:px-4">
          <Banner tone={message.tone}>{message.text}</Banner>
        </div>
      )}
      {facts.sidesUnconfirmed && !readOnly && (
        <div className="px-3 pt-3 tablet:px-4">
          <Banner tone="warn">{SIDES_UNCONFIRMED}</Banner>
        </div>
      )}
      {readOnly && (
        <div className="px-3 pt-3 tablet:px-4">
          <Banner tone="warn">{IMPERSONATION_REVIEW_REFUSED}</Banner>
        </div>
      )}
    </div>
  );

  const video = source ? (
    <HlsPlayer
      ref={playerRef}
      source={source}
      title={`Match video: ${fixture}`}
      keyboard="host"
      overlay={<ReviewWatermark scoutName={scoutName} claimId={claimId} staff={readOnly} />}
      onTimeUpdate={(ms) => {
        timelineRef.current?.setMs(ms);
        stripRef.current?.setMs(ms);
      }}
      onStateChange={(state) => {
        if (state === "ready" && !cuedOnReady.current && source.kind === "hls") {
          cuedOnReady.current = true;
          cue(current);
        }
      }}
    />
  ) : (
    <div className="relative flex aspect-video items-center justify-center bg-sunken p-4">
      <ReviewWatermark scoutName={scoutName} claimId={claimId} staff={readOnly} />
      <p className="m-0 max-w-sm text-center text-ink-muted">
        There is no clip for this event, and the raw footage has been deleted.
      </p>
    </div>
  );

  const videoTools = (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
      <Button
        variant="ghost"
        size="s"
        icon={CirclePlay}
        disabled={!source || !current}
        onClick={() => {
          if (!current) return;
          if (fileMode) playerRef.current?.seekTo(0);
          else playerRef.current?.seekTo(cueMs(current));
          playerRef.current?.play();
        }}
      >
        Replay clip
      </Button>
      {current?.clipId && !readOnly && (
        <Button
          variant="ghost"
          size="s"
          className={cx(favourite && "bg-selected")}
          aria-pressed={favourite}
          onClick={() => void toggleFavourite(current)}
        >
          <Star {...iconProps} fill={favourite ? "currentColor" : "none"} />
          Favourite clip
        </Button>
      )}
      <span className="flex-1" />
      <span
        className="hidden items-center gap-1.5 text-body-s text-ink-muted desktop:flex"
        aria-hidden="true"
      >
        <Kbd>Space</Kbd>play
        <Kbd>← →</Kbd>5 s
      </span>
    </div>
  );

  const currentCard = current && (
    <section
      aria-labelledby={`${ids}-current`}
      aria-busy={isBusy || undefined}
      className="flex flex-col gap-3 bg-selected p-3.5 shadow-[inset_0_0_0_1px_var(--wl-color-focus)]"
    >
      <h4 id={`${ids}-current`} className="sr-only">
        Current event
      </h4>
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-mono-l font-bold tabular-nums">{timeOf(current)}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-title-m font-bold">{eventTypeText(current)}</span>
          <span className="text-body-s text-ink-muted">
            <WhoLabel side={current.side} text={whoOf(current)} />
          </span>
        </span>
        <EventStatusChip state={current.status} />
      </div>
      {current.manual ? (
        <ConfidenceMeter manual size="large" addedBy="you" />
      ) : (
        current.confidence !== null && <ConfidenceMeter value={current.confidence} size="large" />
      )}
      {current.corrected && (
        <span className="flex items-center gap-1.5 text-body-s text-ink-muted">
          <Pencil {...iconProps} size={14} />
          Edited
        </span>
      )}
      {!readOnly && (
        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-1.5">
          <Button
            variant="primary"
            size="xl"
            icon={Check}
            aria-keyshortcuts="Y"
            aria-disabled={
              current.status === (current.manual ? "manual" : "confirmed") || undefined
            }
            onClick={() => decide(current, "confirm")}
          >
            Confirm
          </Button>
          <Button
            variant="secondary"
            size="xl"
            icon={X}
            aria-keyshortcuts="N"
            aria-disabled={current.status === "rejected" || undefined}
            onClick={() => decide(current, "reject")}
          >
            Reject
          </Button>
          <Button
            variant="secondary"
            size="xl"
            icon={Pencil}
            aria-keyshortcuts="E"
            onClick={() => openEdit(current)}
          >
            Edit
          </Button>
        </div>
      )}
    </section>
  );

  const at = current ? shown.findIndex((e) => e.id === current.id) : -1;
  const upNext = shown.slice(at + 1, at + 4);

  const upNextList = upNext.length > 0 && (
    <div className="flex flex-col gap-2">
      <h4 id={`${ids}-next`} className="m-0 font-mono text-overline text-ink-muted uppercase">
        Up next
      </h4>
      <ul aria-labelledby={`${ids}-next`} className="m-0 list-none border-t border-line p-0">
        {upNext.map((e) => {
          const disc = eventDisc(e.status);
          const rejected = disc === "rejected";
          const low = !e.manual && e.confidence !== null && e.confidence < LOW_CONFIDENCE;
          const Disc = DISC_LOOK[disc].icon;
          return (
            <li key={e.id} className="border-b border-line">
              <button
                type="button"
                className="grid min-h-13 w-full grid-cols-[2.75rem_1.25rem_minmax(0,1fr)_2.5rem_1.375rem] items-center gap-2.5 bg-transparent px-0 text-left text-ink"
                onClick={() => select(e.id)}
              >
                <span className="font-mono text-mono-m text-ink-muted tabular-nums">
                  {timeOf(e)}
                </span>
                {e.side ? <TeamMarker side={e.side} size={20} /> : <span />}
                <span className="flex min-w-0 flex-col gap-1">
                  <span className={cx("font-semibold", rejected && "line-through")}>
                    {eventTypeText(e)}
                  </span>
                  <span className="truncate text-body-s text-ink-muted">{whoOf(e)}</span>
                </span>
                <span
                  className={cx(
                    "flex flex-col items-end gap-1 font-mono text-mono-m tabular-nums",
                    low ? "text-pending" : "text-ink-muted",
                  )}
                >
                  {e.manual || e.confidence === null ? "" : e.confidence.toFixed(2)}
                  {/* Under 0.50: the number plus the word, never colour alone (A11Y.md 2). */}
                  {low && (
                    <span className="font-mono text-overline uppercase">
                      <span className="sr-only">, </span>Low
                    </span>
                  )}
                </span>
                <span className={`wl-disc wl-disc--${disc}`} title={DISC_LOOK[disc].label}>
                  <Disc {...iconProps} aria-hidden="true" />
                  <span className="sr-only">, {DISC_LOOK[disc].label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  const addButton =
    !readOnly &&
    (canAdd ? (
      <Button
        ref={addButtonRef}
        variant="secondary"
        size="m"
        icon={Plus}
        className="w-full justify-center border-dashed touch:min-h-12"
        aria-expanded={adding}
        aria-keyshortcuts="A"
        onClick={() => setAdding(true)}
      >
        Add missed event
        <Kbd className="hidden wide:inline-flex">A</Kbd>
      </Button>
    ) : (
      <Button
        variant="secondary"
        size="m"
        icon={Plus}
        className="w-full justify-center border-dashed touch:min-h-12"
        aria-disabled="true"
        aria-describedby={clipsOnlyId}
      >
        Add missed event
      </Button>
    ));

  // Previous and Next: icon-only 48px on phones, "Previous" and "Next" at 120px from 768px,
  // icon plus K or J from 1280px (Screens B, "Workspace" at 375, 768 and 1280).
  const stepButton =
    "touch:size-12 touch:justify-center tablet:w-30 tablet:justify-center wide:w-auto";
  const stepBar = (
    // Pinned under the list from 1280px; below, sticky at the foot of the screen, clear of
    // the shell's phone tab bar so neither the buttons nor their focus ring hide behind it
    // (WCAG 2.4.11).
    <div className="sticky bottom-0 z-10 flex flex-col gap-1.5 border-t border-line bg-panel p-3 touch:bottom-[calc(var(--wl-shell-tabbar)+env(safe-area-inset-bottom))] wide:static">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1.5">
        {addButton || <span />}
        <Button
          variant="secondary"
          size="m"
          icon={ChevronUp}
          className={stepButton}
          aria-label="Previous event"
          aria-keyshortcuts="K"
          onClick={() => step(-1)}
        >
          <span className="hidden tablet:inline wide:hidden">Previous</span>
          <Kbd className="hidden wide:inline-flex">K</Kbd>
        </Button>
        <Button
          variant="secondary"
          size="m"
          icon={ChevronDown}
          className={stepButton}
          aria-label="Next event"
          aria-keyshortcuts="J"
          onClick={() => step(1)}
        >
          <span className="hidden tablet:inline wide:hidden">Next</span>
          <Kbd className="hidden wide:inline-flex">J</Kbd>
        </Button>
      </div>
      {!readOnly && !canAdd && (
        <span id={clipsOnlyId} className="text-body-s text-ink-muted">
          Raw footage deleted. You cannot add missed events.
        </span>
      )}
    </div>
  );

  const eventsPanel = (
    <>
      <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 text-label" aria-live="polite">
            {progressText}
          </p>
          {facts.sidesUnconfirmed && !readOnly && (
            <ConfirmDialog
              trigger={{ label: "Swap home and away", variant: "ghost", icon: ArrowLeftRight }}
              title="Swap home and away?"
              body={
                <>
                  Every event and track in this match changes side.
                  {linkedTracks > 0 &&
                    ` ${linkedTracks === 1 ? "1 track link" : `${linkedTracks} track links`} to players of the other team ${linkedTracks === 1 ? "is" : "are"} removed, so you will need to link those tracks again.`}
                </>
              }
              form={swapForm}
              hidden={{ claimId }}
              submit={{ label: "Swap sides", pendingLabel: "Swapping…", variant: "primary" }}
            />
          )}
        </div>
        {rows.length > 0 && (
          <div data-review-keys="off" className="touch:hidden">
            <SegmentedFilter
              aria-label="Show events"
              fill
              value={filter}
              onValueChange={(v) => setFilter(v as StatusFilter)}
              options={[
                { value: "all", label: "All", count: filterCount("all") },
                { value: "pending", label: "Pending", count: filterCount("pending") },
                { value: "confirmed", label: "Confirmed", count: filterCount("confirmed") },
                { value: "rejected", label: "Rejected", count: filterCount("rejected") },
              ]}
            />
          </div>
        )}
        {autoCount > 0 && (
          <label className="flex min-h-control-l items-center gap-2 tablet:min-h-0">
            <input
              type="checkbox"
              className="size-4"
              checked={showAuto}
              onChange={(e) => setShowAuto(e.target.checked)}
            />
            Show auto-accepted events ({autoCount})
          </label>
        )}
        <p className="m-0 text-body-s text-ink-muted">
          {clockOk
            ? "Times are match times."
            : "The club has not set kickoff, so times are video times."}
        </p>
      </div>
      {events.length === 0 ? (
        <EmptyState
          art={false}
          title="No events found"
          body="The model found no goals, shots or touches in this match. Add any it missed, then mark the match as reviewed."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          art={false}
          title="No events to check"
          body="Every event in this match was above the threshold. You can look through the auto-accepted events, then mark the match as reviewed."
        />
      ) : (
        <>
          {/* 768px and up: the list, the selected row open with its own buttons. From 1280px
              it scrolls on its own, so J and K keep the video in view. Phones: the current
              event as a card, then Up next. Both are rendered and switched with CSS, so the
              first paint already matches the device. */}
          <div
            data-testid="review-event-list"
            className="wl-elist touch:hidden wide:min-h-0 wide:flex-1 wide:overflow-y-auto wide:scroll-pt-8 wide:*:first:sticky wide:*:first:top-0 wide:*:first:z-2"
          >
            <ReviewEventListHeader />
            {shown.length === 0 ? (
              <p className="m-0 px-3.5 py-4 text-ink-muted">No events with this status.</p>
            ) : (
              <ul aria-label="Events" className="m-0 list-none p-0">
                {shown.map((e) => (
                  <ReviewEventRow
                    key={e.id}
                    className={cx(rowClass(e.id), busy.has(e.id) && "opacity-80")}
                    time={timeOf(e)}
                    type={eventTypeText(e)}
                    side={e.side}
                    who={e.side ? whoOf(e) : `${whoOf(e)} · side not set`}
                    edited={e.corrected}
                    source={e.manual ? "scout" : "model"}
                    confidence={e.manual ? null : e.confidence}
                    state={e.status}
                    selected={e.id === currentId}
                    saved={saved.has(e.id)}
                    onSelect={() => select(e.id)}
                    // The selected row opens with its own buttons; none in a "Log in as" session.
                    {...(!readOnly && {
                      onConfirm: () => decide(e, "confirm"),
                      onEdit: () => openEdit(e),
                      onReject: () => decide(e, "reject"),
                    })}
                  />
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-3 p-3 tablet:hidden">
            {currentCard}
            {upNextList}
          </div>
        </>
      )}
    </>
  );

  return (
    <ReviewThemeScopeClient
      initialChoice={themeChoice}
      // From 1280px the workspace is one screen tall (the shell's page padding taken off)
      // and its columns scroll inside it; below, the page scrolls.
      className="border border-line wide:flex wide:h-[calc(100dvh-3.5rem)] wide:min-h-160 wide:flex-col"
    >
      <section
        ref={rootRef}
        aria-labelledby={`${ids}-review`}
        className="wide:flex wide:min-h-0 wide:flex-1 wide:flex-col"
      >
        {header}
        <h2 id={`${ids}-review`} className="sr-only">
          Review
        </h2>
        {rawExpiresAt && (
          <ExpiryBanner
            deletesAt={rawExpiresAt}
            now={now}
            deleted={clipsOnly}
            className="rounded-none border-x-0 border-t-0"
          />
        )}
        {notices}
        <div className="grid wide:min-h-0 wide:flex-1 wide:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] wide:grid-rows-[minmax(0,1fr)]">
          <section
            aria-labelledby={`${ids}-video`}
            className="flex min-w-0 flex-col wide:min-h-0 wide:overflow-y-auto wide:border-r wide:border-line"
            data-adding={adding || undefined}
          >
            <h3 id={`${ids}-video`} className="sr-only">
              Match video
            </h3>
            <div className="bg-sunken">{video}</div>
            {videoTools}
            <div className="pt-1 touch:hidden">
              <Timeline
                ref={timelineRef}
                events={rows}
                selectedId={currentId}
                markers={markers}
                halfLengthMinutes={half}
                durationMs={durationMs}
                clockOk={clockOk}
                timeLabel={(ms) => eventTime(ms, markers, half)}
              />
            </div>
            <div className="px-4 tablet:hidden">
              <Timeline
                ref={stripRef}
                events={rows}
                selectedId={currentId}
                markers={markers}
                halfLengthMinutes={half}
                durationMs={durationMs}
                clockOk={clockOk}
                compact
                timeLabel={(ms) => eventTime(ms, markers, half)}
              />
            </div>
            {adding && (
              <div className="p-3">
                <AddMissedEventPanel
                  player={{
                    currentMs: () => playerRef.current?.currentMs ?? 0,
                    seekTo: (ms) => playerRef.current?.seekTo(ms),
                    pause: () => playerRef.current?.pause(),
                  }}
                  markers={markers}
                  halfLengthMinutes={half}
                  durationMs={data.video.durationMs}
                  entries={entries}
                  teams={teams}
                  onAdd={addMissed}
                  onClose={() => {
                    setAdding(false);
                    requestAnimationFrame(() => addButtonRef.current?.focus());
                  }}
                />
              </div>
            )}
          </section>
          <section
            aria-labelledby={`${ids}-lists-title`}
            className="flex min-w-0 flex-col border-t border-line wide:min-h-0 wide:border-t-0"
          >
            <h3 id={`${ids}-lists-title`} className="sr-only">
              Review lists
            </h3>
            <Tabs
              id={tabsId}
              aria-label="Review lists"
              className="px-3"
              value={tab}
              onValueChange={(v) => setTab(v as "events" | "tracks")}
              items={[
                { value: "events", label: "Events", count: rows.length },
                { value: "tracks", label: "Tracks", count: tracks.length },
              ]}
            />
            <TabPanel
              tabsId={tabsId}
              value="events"
              selected={tab === "events"}
              className="wide:flex wide:min-h-0 wide:flex-1 wide:flex-col"
            >
              {eventsPanel}
            </TabPanel>
            <TabPanel
              tabsId={tabsId}
              value="tracks"
              selected={tab === "tracks"}
              className="p-3 wide:min-h-0 wide:flex-1 wide:overflow-y-auto"
            >
              <TrackLinkEditor
                tracks={tracks}
                events={events}
                entries={entries}
                teams={teams}
                readOnly={readOnly}
                onWatch={(t) => {
                  const first = firstEventMs(events, t.id);
                  const e = events.find((x) => x.trackId === t.id && x.timestampMs === first);
                  if (e) {
                    setTab("events");
                    select(e.id);
                  }
                }}
                onLink={link}
              />
            </TabPanel>
            {stepBar}
          </section>
        </div>
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </section>
      {!readOnly && (
        <EditEventDialog
          event={editing}
          summary={
            editing ? `${eventTypeText(editing)} · ${whoOf(editing)} · ${timeOf(editing)}` : ""
          }
          entries={entries}
          teams={teams}
          onSave={saveEdit}
          onClose={() => setEditing(null)}
        />
      )}
      <Modal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title="Keyboard shortcuts"
        subtitle="Review workspace"
      >
        <dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
          {SHORTCUTS.filter(
            ([k]) => (!readOnly || !DECISION_KEYS.has(k)) && (k !== "A" || canAdd),
          ).map(([k, v]) => (
            <div key={k} className="contents">
              <dt>
                <Kbd>{k}</Kbd>
              </dt>
              <dd className="m-0">{v}</dd>
            </div>
          ))}
        </dl>
        <label className="mt-6 flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={singleKeys}
            onChange={(ev) => setSingleKeys(ev.target.checked)}
          />
          <span>
            <span className="block font-semibold">Single-key shortcuts</span>
            <span className="block text-ink-muted">
              {readOnly ? "J, K and ? work" : "J, K, Y, N, E, A and ? work"} without a modifier key.
              Turn this off if you use speech input or tend to press keys by accident. The buttons
              always work.
            </span>
          </span>
        </label>
      </Modal>
    </ReviewThemeScopeClient>
  );
}

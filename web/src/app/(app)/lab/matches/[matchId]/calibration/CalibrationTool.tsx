"use client";

import { Check, CircleAlert, Plus, RotateCw, Trash2, TriangleAlert } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Field, FormErrorBanner, useFocusFirstInvalid } from "@/components/forms";
import { useSectionAction } from "@/components/section-result";
import { Workspace } from "@/components/templates/Workspace";
import { Banner } from "@/components/forms";
import { Button, IconButton } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icons";
import type { ActionResult } from "@/lib/action-result";
import {
  fitHomography,
  invert,
  landmarkById,
  PITCH_LANDMARKS,
  pitchLines,
  residuals,
  type Matrix3,
  type Vec2,
} from "@/lib/homography";
import { formatCount, formatVideoTime } from "@/lib/labels";
import { saveCalibrationAction } from "../actions";

/**
 * The calibration tool (docs/build/design/C09.md, Surface 4). Points live in
 * image pixels of the video; the overlay's viewBox is the image, so pointer
 * positions map straight to pixels. The fit and the drawn lines come from
 * src/lib/homography.ts; the server fits again before it saves. Points are not
 * preloaded (Q-049): a stored calibration keeps its matrix only.
 */

const MAX_POINTS = 12;
const MIN_POINTS = 4;
const LIMIT_M = 1.5;
const GROUPS = [...new Set(PITCH_LANDMARKS.map((l) => l.group))];

/** x or y is null while its field is empty: the fit waits and the server reports it. */
type Point = { key: number; landmark: string; x: number | null; y: number | null };

/** An empty number field is null, not 0. */
function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Pitch metres to image pixels through H⁻¹; null behind the camera. */
function toImage(inv: Matrix3, [x, y]: Vec2): Vec2 | null {
  const w = inv[2][0] * x + inv[2][1] * y + inv[2][2];
  if (!(w > 1e-9)) return null;
  return [
    (inv[0][0] * x + inv[0][1] * y + inv[0][2]) / w,
    (inv[1][0] * x + inv[1][1] * y + inv[1][2]) / w,
  ];
}

function linePaths(h: Matrix3 | null): string[] {
  if (!h) return [];
  let inv: Matrix3;
  try {
    inv = invert(h);
  } catch {
    return [];
  }
  return pitchLines().map((line) => {
    let d = "";
    let pen = false;
    // Densify so straight pitch lines stay straight in perspective and clip cleanly.
    for (let i = 0; i < line.length - 1; i++) {
      const [a, b] = [line[i]!, line[i + 1]!];
      const steps = 12;
      for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
        const t = s / steps;
        const p = toImage(inv, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        if (!p) {
          pen = false;
          continue;
        }
        d += `${pen ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
        pen = true;
      }
    }
    return d;
  });
}

type Fit =
  | { kind: "few"; n: number }
  | { kind: "landmarks" }
  | { kind: "coords" }
  | { kind: "bad" }
  | { kind: "ok"; homography: Matrix3; errorM: number; residuals: number[] };

function fitOf(points: Point[]): Fit {
  if (points.length < MIN_POINTS) return { kind: "few", n: points.length };
  if (points.some((p) => !landmarkById(p.landmark))) return { kind: "landmarks" };
  if (points.some((p) => p.x === null || p.y === null)) return { kind: "coords" };
  const pairs = points.map((p) => ({
    image: [p.x!, p.y!] as Vec2,
    pitch: landmarkById(p.landmark)!.pitch,
  }));
  try {
    const { homography, errorM } = fitHomography(pairs);
    return { kind: "ok", homography, errorM, residuals: residuals(homography, pairs) };
  } catch {
    return { kind: "bad" };
  }
}

export function CalibrationTool({
  matchId,
  imageWidth,
  imageHeight,
  stillUrl,
  stillMs,
  current,
  expectedCurrentId,
  venue,
  storedPoints,
  storedEvents,
}: {
  matchId: string;
  imageWidth: number;
  imageHeight: number;
  stillUrl: string;
  stillMs: number;
  current: { homography: Matrix3; manual: boolean } | null;
  expectedCurrentId: string | null;
  venue: string | null;
  storedPoints: number;
  storedEvents: number;
}) {
  const [points, setPoints] = useState<Point[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [scale, setScale] = useState(1);
  const [coarse, setCoarse] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [result, setResult] = useState<ActionResult>(null);
  const nextKey = useRef(1);
  const svgRef = useRef<SVGSVGElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const selectRefs = useRef(new Map<number, HTMLSelectElement>());
  const pointsRef = useRef<HTMLOListElement>(null);
  const form = useSectionAction(saveCalibrationAction, setResult);
  // A failed save closes the dialog (closeOnError); focus goes to the first
  // point field the server marked.
  useFocusFirstInvalid(pointsRef, result);

  // The live fit; the status card shows it 500 ms after the last change.
  const fit = useMemo(() => fitOf(points), [points]);
  const [shownFit, setShownFit] = useState<Fit>(fit);
  useEffect(() => {
    const t = setTimeout(() => setShownFit(fit), 500);
    return () => clearTimeout(t);
  }, [fit]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const update = () => {
      const r = svg.getBoundingClientRect();
      if (r.width > 0) setScale(Math.min(r.width / imageWidth, r.height / imageHeight));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(svg);
    const mq = window.matchMedia("(pointer: coarse)");
    setCoarse(mq.matches);
    return () => ro.disconnect();
  }, [imageWidth, imageHeight]);

  useEffect(() => {
    if (points.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [points.length]);

  const focusLandmark = useCallback((key: number | undefined) => {
    requestAnimationFrame(() => {
      if (key === undefined) addRef.current?.focus();
      else selectRefs.current.get(key)?.focus();
    });
  }, []);

  function addPoint(x: number, y: number) {
    if (points.length >= MAX_POINTS) return;
    const key = nextKey.current++;
    const p = { key, landmark: "", x: Math.round(x), y: Math.round(y) };
    setPoints((ps) => [...ps, p]);
    setSelected(key);
    setAnnounce(`Point ${points.length + 1} added at ${p.x}, ${p.y}. Choose its landmark.`);
    focusLandmark(key);
  }

  function removePoint(key: number) {
    const i = points.findIndex((p) => p.key === key);
    const rest = points.filter((p) => p.key !== key);
    setPoints(rest);
    setAnnounce(`Point ${i + 1} removed.`);
    const next = rest[i] ?? rest[i - 1];
    setSelected(next?.key ?? null);
    focusLandmark(next?.key);
  }

  function update(key: number, patch: Partial<Point>) {
    setPoints((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function toPixels(e: PointerEvent<SVGElement>): Vec2 | null {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    const x = Math.min(imageWidth, Math.max(0, p.x));
    const y = Math.min(imageHeight, Math.max(0, p.y));
    return [x, y];
  }

  function onBackground(e: PointerEvent<SVGSVGElement>) {
    if (e.target !== e.currentTarget && !(e.target as Element).classList.contains("wl-calib__bg")) {
      return;
    }
    const p = toPixels(e);
    if (p) addPoint(p[0], p[1]);
  }

  function onPointDown(e: PointerEvent<SVGGElement>, key: number) {
    e.stopPropagation();
    setSelected(key);
    setDragging(key);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function onPointMove(e: PointerEvent<SVGGElement>, key: number) {
    if (dragging !== key) return;
    const p = toPixels(e);
    if (p) update(key, { x: Math.round(p[0]), y: Math.round(p[1]) });
  }

  function stepKey(e: KeyboardEvent<HTMLInputElement>, key: number, axis: "x" | "y") {
    if (!e.shiftKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const max = axis === "x" ? imageWidth : imageHeight;
    const p = points.find((q) => q.key === key)!;
    const v = Math.min(max, Math.max(0, (p[axis] ?? 0) + (e.key === "ArrowUp" ? 10 : -10)));
    update(key, { [axis]: v });
  }

  const currentPaths = useMemo(() => linePaths(current?.homography ?? null), [current]);
  const fitPaths = useMemo(() => (fit.kind === "ok" ? linePaths(fit.homography) : []), [fit]);
  const r = (px: number) => px / Math.max(scale, 1e-6);
  const fieldErr = (name: string) =>
    result && !result.ok ? result.fieldErrors?.[name] : undefined;
  const used = new Map(points.map((p, i) => [p.landmark, i]));

  const overlayLabel = [
    "Pitch lines drawn over the still:",
    current ? "dashed for the current calibration," : null,
    fit.kind === "ok" ? "solid for the new fit." : null,
    `${points.length} points placed.`,
  ]
    .filter(Boolean)
    .join(" ");

  const still = (
    <>
      <div
        className="wl-calib"
        style={{ ["--wl-aspect" as string]: `${imageWidth} / ${imageHeight}` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a presigned still, not a static asset */}
        <img
          className="wl-calib__img"
          src={stillUrl}
          alt={`Still from the match footage at ${formatVideoTime(stillMs, 0)}`}
          onError={() => setImgFailed(true)}
        />
        <svg
          ref={svgRef}
          className="wl-calib__overlay"
          viewBox={`0 0 ${imageWidth} ${imageHeight}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={overlayLabel}
          onPointerDown={onBackground}
        >
          <rect
            className="wl-calib__bg"
            x="0"
            y="0"
            width={imageWidth}
            height={imageHeight}
            fill="transparent"
          />
          {currentPaths.map((d, i) => (
            <g key={`c${i}`}>
              <path className="wl-calib__line wl-calib__line--halo" d={d} />
              <path className="wl-calib__line wl-calib__line--current" d={d} />
            </g>
          ))}
          {fitPaths.map((d, i) => (
            <g key={`f${i}`}>
              <path className="wl-calib__line wl-calib__line--fit-halo" d={d} />
              <path className="wl-calib__line wl-calib__line--fit" d={d} />
            </g>
          ))}
          {/* A point with an empty X or Y field is not drawn until it has both. */}
          {points.map((p, i) =>
            p.x === null || p.y === null ? null : (
              <g
                key={p.key}
                className="wl-calib__point"
                data-selected={selected === p.key ? "true" : undefined}
                data-dragging={dragging === p.key ? "true" : undefined}
                onPointerDown={(e) => onPointDown(e, p.key)}
                onPointerMove={(e) => onPointMove(e, p.key)}
                onPointerUp={() => setDragging(null)}
                onPointerCancel={() => setDragging(null)}
              >
                <circle className="wl-calib__hit" cx={p.x} cy={p.y} r={r(coarse ? 22 : 12)} />
                <circle cx={p.x} cy={p.y} r={r(10)} />
                <text x={p.x} y={p.y} fontSize={r(11)}>
                  {i + 1}
                </text>
              </g>
            ),
          )}
        </svg>
        {imgFailed && (
          <div className="wl-calib__message">
            <CircleAlert {...iconProps} />
            <p className="body-strong">The still did not load.</p>
            <Button variant="secondary" icon={RotateCw} onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        )}
      </div>
      <div className="wl-legend">
        {current && (
          <span className="mr-4 inline-flex items-center gap-2">
            <svg className="wl-calib__swatch" viewBox="0 0 24 8" aria-hidden="true">
              <path className="wl-calib__line wl-calib__line--halo" d="M1 4H23" />
              <path className="wl-calib__line wl-calib__line--current" d="M1 4H23" />
            </svg>
            Current calibration
          </span>
        )}
        {fit.kind === "ok" && (
          <span className="inline-flex items-center gap-2">
            <svg className="wl-calib__swatch" viewBox="0 0 24 8" aria-hidden="true">
              <path className="wl-calib__line wl-calib__line--fit" d="M1 4H23" />
            </svg>
            New fit
          </span>
        )}
      </div>
      <div className="wl-row mt-3">
        <Button
          ref={addRef}
          variant="secondary"
          size="sm"
          icon={Plus}
          disabled={points.length >= MAX_POINTS}
          onClick={() => addPoint(imageWidth / 2, imageHeight / 2)}
        >
          Add point
        </Button>
        {points.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            onClick={() => {
              setPoints([]);
              setSelected(null);
              setAnnounce("All points removed.");
              focusLandmark(undefined);
            }}
          >
            Remove all points
          </Button>
        )}
      </div>
      {points.length >= MAX_POINTS ? (
        <p className="caption mt-2 text-ink-muted">
          12 points is the most. Remove one to add another.
        </p>
      ) : (
        <p className="caption mt-2 text-ink-muted">
          Click the still to add a point. Drag a point to move it.
        </p>
      )}
    </>
  );

  const status = (() => {
    switch (shownFit.kind) {
      case "few":
        return <p className="body">Place at least 4 points. {shownFit.n} placed.</p>;
      case "landmarks":
        return <p className="body">Choose a landmark for every point to see the fit.</p>;
      case "coords":
        return <p className="body">Enter X and Y for every point to see the fit.</p>;
      case "bad":
        return (
          <span className="wl-inline-status wl-inline-status--warn">
            <TriangleAlert {...iconProps} />
            These points do not fit a pitch. Spread them out, not along one line.
          </span>
        );
      case "ok":
        return (
          <>
            <p className="data">
              {shownFit.errorM.toFixed(1)} m error · {points.length} points
            </p>
            {shownFit.errorM <= LIMIT_M ? (
              <span className="wl-inline-status wl-inline-status--ok">
                <Check {...iconProps} />
                Within the 1.5 m limit
              </span>
            ) : (
              <span className="wl-inline-status wl-inline-status--warn">
                <TriangleAlert {...iconProps} />
                Over the 1.5 m limit. Move or remove the points with the largest error.
              </span>
            )}
          </>
        );
    }
  })();

  const side = (
    <>
      <div className="wl-card" aria-live="polite">
        {status}
      </div>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
      <p className="caption mt-4 text-ink-muted">
        Left and right as the camera sees the pitch. Near is the touchline closest to the camera.
      </p>
      <svg
        className="wl-pitch wl-calib__map mt-3"
        viewBox="-2 -2 109 72"
        role="img"
        aria-label={`Pitch map: ${points.filter((p) => p.landmark).length} of 23 landmarks used.`}
      >
        <rect className="turf" x="-2" y="-2" width="109" height="72" />
        {pitchLines().map((line, i) => (
          <polyline
            key={i}
            className="chalk"
            points={line.map(([x, y]) => `${x},${68 - y}`).join(" ")}
            style={{ strokeWidth: 0.4 }}
          />
        ))}
        {PITCH_LANDMARKS.map((l) => {
          const i = used.get(l.id);
          const isSel = i !== undefined && points[i]?.key === selected;
          return (
            <g key={l.id}>
              <circle
                className={`lm${i !== undefined ? " lm--used" : ""}${isSel ? " lm--selected" : ""}`}
                cx={l.pitch[0]}
                cy={68 - l.pitch[1]}
                r={1.3}
              />
              {i !== undefined && (
                <text className="dot-label" x={l.pitch[0] + 1.8} y={68 - l.pitch[1] - 1.2}>
                  {i + 1}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <ol ref={pointsRef} className="wl-calib__points mt-4" aria-label="Points">
        {points.map((p, i) => {
          const residual = fit.kind === "ok" ? fit.residuals[i] : undefined;
          const residualHint =
            residual === undefined ? undefined : residual > LIMIT_M ? (
              <span className="wl-inline-status wl-inline-status--warn">
                <TriangleAlert {...iconProps} />
                <span className="data">{residual.toFixed(1)} m</span>
              </span>
            ) : (
              <span className="data">{residual.toFixed(1)} m</span>
            );
          return (
            <li key={p.key} data-selected={selected === p.key ? "true" : undefined}>
              <fieldset onFocus={() => setSelected(p.key)}>
                <legend className="body-strong">
                  Point {i + 1}
                  {selected === p.key && <span className="sr-only">, selected</span>}
                </legend>
                <Field
                  label="Landmark"
                  className="wl-calib__landmark"
                  error={fieldErr(`points.${i}.landmark`)}
                >
                  {(fp) => (
                    <select
                      {...fp}
                      ref={(el) => {
                        if (el) selectRefs.current.set(p.key, el);
                        else selectRefs.current.delete(p.key);
                      }}
                      className="wl-input"
                      value={p.landmark}
                      onChange={(e) => update(p.key, { landmark: e.target.value })}
                    >
                      <option value="">Choose a landmark</option>
                      {GROUPS.map((g) => (
                        <optgroup key={g} label={g}>
                          {PITCH_LANDMARKS.filter((l) => l.group === g).map((l) => {
                            const other = used.get(l.id);
                            const taken = other !== undefined && other !== i;
                            return (
                              <option key={l.id} value={l.id} disabled={taken}>
                                {l.label}
                                {taken ? ` (point ${other + 1})` : ""}
                              </option>
                            );
                          })}
                        </optgroup>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="X (px)" error={fieldErr(`points.${i}.x`)}>
                  {(fp) => (
                    <input
                      {...fp}
                      className="wl-input data"
                      type="number"
                      inputMode="numeric"
                      step={1}
                      min={0}
                      max={imageWidth}
                      value={p.x ?? ""}
                      onKeyDown={(e) => stepKey(e, p.key, "x")}
                      onChange={(e) => update(p.key, { x: numberOrNull(e.target.value) })}
                    />
                  )}
                </Field>
                <Field label="Y (px)" hint={residualHint} error={fieldErr(`points.${i}.y`)}>
                  {(fp) => (
                    <input
                      {...fp}
                      className="wl-input data"
                      type="number"
                      inputMode="numeric"
                      step={1}
                      min={0}
                      max={imageHeight}
                      value={p.y ?? ""}
                      onKeyDown={(e) => stepKey(e, p.key, "y")}
                      onChange={(e) => update(p.key, { y: numberOrNull(e.target.value) })}
                    />
                  )}
                </Field>
                <IconButton
                  icon={Trash2}
                  aria-label={`Remove point ${i + 1}`}
                  onClick={() => removePoint(p.key)}
                />
              </fieldset>
            </li>
          );
        })}
      </ol>
      <div className="mt-4">
        <Banner tone="warn">
          Saving re-projects this match&apos;s stored positions and events, and recomputes distance
          covered. Positions that land off the pitch are removed.
        </Banner>
      </div>
      <div className="mt-4 flex flex-col gap-3">
        <FormErrorBanner result={result} />
        {/* A div so the column does not stretch the trigger past phone width. */}
        <div>
          <ConfirmDialog
            trigger={{ label: "Save calibration", variant: "primary", block: true }}
            title="Save this calibration?"
            body={
              <>
                <p className="body">
                  This re-projects {formatCount(storedPoints)} position points and{" "}
                  {formatCount(storedEvents)} events for this match. Points that land off the pitch
                  are removed, and distance covered is worked out again.
                </p>
                {venue && (
                  <p className="body mt-2">
                    Later matches at {venue} filmed at {imageWidth} × {imageHeight} use it from now
                    on. The current calibration is replaced.
                  </p>
                )}
              </>
            }
            form={form}
            hidden={{
              matchId,
              expectedCurrentId: expectedCurrentId ?? "",
              points: JSON.stringify(points.map(({ landmark, x, y }) => ({ landmark, x, y }))),
            }}
            submit={{ label: "Save and re-project", pendingLabel: "Saving…", variant: "primary" }}
            closeOnError
          />
        </div>
      </div>
    </>
  );

  return (
    <Workspace
      primary={{ title: "Still", content: still }}
      side={{ title: "Landmarks", content: side }}
    />
  );
}

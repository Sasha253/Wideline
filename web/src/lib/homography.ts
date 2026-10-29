/**
 * Pitch calibration maths (C09; CV05), client-safe: the Lab's calibration
 * tool fits live in the browser and the server checks the same fit before it
 * saves. A port of cv_worker/wideline_cv/calibration.py fit_homography (the
 * normalised DLT); both are tested against
 * tests/fixtures/cv/homography-cases.json.
 *
 * Homographies map video pixels to pitch metres (105 x 68, camera-fixed: x = 0
 * at the goal on the camera's left, y = 0 on the near touchline, Q-043).
 */

export type Matrix3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];
export type Vec2 = [number, number];
export type Correspondence = { image: Vec2; pitch: Vec2 };

export class HomographyError extends Error {
  constructor(readonly code: "too_few" | "degenerate") {
    super(code === "too_few" ? "at least 4 points are needed" : "points are degenerate");
  }
}

export function applyHomography(h: Matrix3, [x, y]: Vec2): Vec2 {
  const w = h[2][0] * x + h[2][1] * y + h[2][2];
  return [(h[0][0] * x + h[0][1] * y + h[0][2]) / w, (h[1][0] * x + h[1][1] * y + h[1][2]) / w];
}

export function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  const out = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ] as Matrix3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      out[i]![j] = a[i]![0] * b[0]![j]! + a[i]![1] * b[1]![j]! + a[i]![2] * b[2]![j]!;
  return out;
}

export function invert(h: Matrix3): Matrix3 {
  const [[a, b, c], [d, e, f], [g, k, l]] = h;
  const A = e * l - f * k;
  const B = -(d * l - f * g);
  const C = d * k - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-15) throw new HomographyError("degenerate");
  const inv: Matrix3 = [
    [A / det, -(b * l - c * k) / det, (b * f - c * e) / det],
    [B / det, (a * l - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * k - b * g) / det, (a * e - b * d) / det],
  ];
  return normalise(inv);
}

/** Scales H so its last entry is 1. */
export function normalise(h: Matrix3): Matrix3 {
  const s = h[2][2];
  if (Math.abs(s) < 1e-15) return h;
  return h.map((row) => row.map((v) => v / s)) as Matrix3;
}

export function isMatrix3(value: unknown): value is Matrix3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (row) =>
        Array.isArray(row) &&
        row.length === 3 &&
        row.every((v) => typeof v === "number" && Number.isFinite(v)),
    )
  );
}

function normaliser(pts: Vec2[]): Matrix3 {
  const cx = pts.reduce((n, p) => n + p[0], 0) / pts.length;
  const cy = pts.reduce((n, p) => n + p[1], 0) / pts.length;
  const mean = pts.reduce((n, p) => n + Math.hypot(p[0] - cx, p[1] - cy), 0) / pts.length;
  if (mean < 1e-9) throw new HomographyError("degenerate");
  const s = Math.SQRT2 / mean;
  return [
    [s, 0, -s * cx],
    [0, s, -s * cy],
    [0, 0, 1],
  ];
}

/** Eigen-decomposition of a symmetric matrix (cyclic Jacobi). Ascending eigenvalues. */
function symmetricEigen(m: number[][]): { values: number[]; vectors: number[][] } {
  const n = m.length;
  const a = m.map((r) => [...r]);
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p]![q]! ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[i]![i]! - a[j]![j]!);
  return {
    values: order.map((i) => a[i]![i]!),
    vectors: order.map((i) => v.map((row) => row[i]!)),
  };
}

/**
 * Fits H (image pixels to pitch metres) by normalised DLT. Returns H with its
 * last entry 1 and the RMS reprojection error in metres. Throws
 * HomographyError for fewer than 4 points or a degenerate set (points on one
 * line, or repeated).
 */
export function fitHomography(points: readonly Correspondence[]): {
  homography: Matrix3;
  errorM: number;
} {
  if (points.length < 4) throw new HomographyError("too_few");
  const src = points.map((p) => p.image);
  const dst = points.map((p) => p.pitch);
  const ts = normaliser(src);
  const td = normaliser(dst);
  const ata = Array.from({ length: 9 }, () => Array<number>(9).fill(0));
  const addRow = (r: number[]) => {
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) ata[i]![j]! += r[i]! * r[j]!;
  };
  for (let i = 0; i < points.length; i++) {
    const [x, y] = applyHomography(ts, src[i]!);
    const [u, v] = applyHomography(td, dst[i]!);
    addRow([-x, -y, -1, 0, 0, 0, u * x, u * y, u]);
    addRow([0, 0, 0, -x, -y, -1, v * x, v * y, v]);
  }
  const { values, vectors } = symmetricEigen(ata);
  const top = values[8]!;
  if (!(top > 0) || values[1]! < 1e-10 * top) throw new HomographyError("degenerate");
  const h = vectors[0]!;
  const hn: Matrix3 = [
    [h[0]!, h[1]!, h[2]!],
    [h[3]!, h[4]!, h[5]!],
    [h[6]!, h[7]!, h[8]!],
  ];
  const full = multiply(multiply(invert(td), hn), ts);
  if (Math.abs(full[2][2]) < 1e-12) throw new HomographyError("degenerate");
  const homography = normalise(full);
  let sum = 0;
  for (const p of points) {
    const [px, py] = applyHomography(homography, p.image);
    if (!Number.isFinite(px) || !Number.isFinite(py)) throw new HomographyError("degenerate");
    sum += (px - p.pitch[0]) ** 2 + (py - p.pitch[1]) ** 2;
  }
  return { homography, errorM: Math.sqrt(sum / points.length) };
}

/** Per-point error in metres for a fitted H. */
export function residuals(h: Matrix3, points: readonly Correspondence[]): number[] {
  return points.map((p) => {
    const [x, y] = applyHomography(h, p.image);
    return Math.hypot(x - p.pitch[0], y - p.pitch[1]);
  });
}

const L = 105;
const W = 68;
const C = W / 2;
const BOX_HALF = 20.16;
const AREA_HALF = 9.16;

export type Landmark = { id: string; label: string; group: string; pitch: Vec2 };

function side(prefix: "left" | "right"): Landmark[] {
  const x0 = prefix === "left" ? 0 : L;
  const d = prefix === "left" ? 1 : -1;
  const word = prefix === "left" ? "Left" : "Right";
  const rows: [string, string, number, number][] = [
    ["box", "penalty box", 16.5, BOX_HALF],
    ["area", "goal area", 5.5, AREA_HALF],
  ];
  return rows.flatMap(([key, name, depth, half]) => {
    const group = `${word} ${name}`;
    return [
      {
        id: `${prefix}_${key}_near_goal`,
        label: `${group}, near goal-line corner`,
        group,
        pitch: [x0, C - half] as Vec2,
      },
      {
        id: `${prefix}_${key}_near_front`,
        label: `${group}, near front corner`,
        group,
        pitch: [x0 + d * depth, C - half] as Vec2,
      },
      {
        id: `${prefix}_${key}_far_front`,
        label: `${group}, far front corner`,
        group,
        pitch: [x0 + d * depth, C + half] as Vec2,
      },
      {
        id: `${prefix}_${key}_far_goal`,
        label: `${group}, far goal-line corner`,
        group,
        pitch: [x0, C + half] as Vec2,
      },
    ];
  });
}

/** The 23 named landmarks a platform admin can place (design C09, Surface 4). */
export const PITCH_LANDMARKS: readonly Landmark[] = [
  { id: "corner_near_left", label: "Corner, near left", group: "Corners", pitch: [0, 0] },
  { id: "corner_far_left", label: "Corner, far left", group: "Corners", pitch: [0, W] },
  { id: "corner_near_right", label: "Corner, near right", group: "Corners", pitch: [L, 0] },
  { id: "corner_far_right", label: "Corner, far right", group: "Corners", pitch: [L, W] },
  {
    id: "halfway_near",
    label: "Halfway line, near touchline",
    group: "Halfway line",
    pitch: [L / 2, 0],
  },
  {
    id: "halfway_far",
    label: "Halfway line, far touchline",
    group: "Halfway line",
    pitch: [L / 2, W],
  },
  { id: "centre_spot", label: "Centre spot", group: "Halfway line", pitch: [L / 2, C] },
  ...side("left"),
  ...side("right"),
];

export function landmarkById(id: string): Landmark | undefined {
  return PITCH_LANDMARKS.find((l) => l.id === id);
}

/** The pitch markings as polylines in metres: outline, halfway line, centre circle, boxes. */
export function pitchLines(): Vec2[][] {
  const lines: Vec2[][] = [
    [
      [0, 0],
      [L, 0],
      [L, W],
      [0, W],
      [0, 0],
    ],
    [
      [L / 2, 0],
      [L / 2, W],
    ],
  ];
  const circle: Vec2[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * 2 * Math.PI;
    circle.push([L / 2 + 9.15 * Math.cos(t), C + 9.15 * Math.sin(t)]);
  }
  lines.push(circle);
  for (const [x0, d] of [
    [0, 1],
    [L, -1],
  ] as const) {
    for (const [depth, half] of [
      [16.5, BOX_HALF],
      [5.5, AREA_HALF],
    ] as const) {
      lines.push([
        [x0, C - half],
        [x0 + d * depth, C - half],
        [x0 + d * depth, C + half],
        [x0, C + half],
      ]);
    }
  }
  return lines;
}

import { Rng, TAU, wrapAngle } from '../../engine/math';

export interface TrackSpec { seed: number; closed: boolean; radius: number; wobble: number; elevation: number; width: number; knots: number; length?: number;
  /** Closed circuits: number of inward bends (0 = plain oval), how deep they cut (0..0.5), and how far the loop is stretched. */ lobes?: number; depth?: number; stretch?: number }
export interface Track {
  spec: TrackSpec; closed: boolean; n: number; step: number; length: number; width: number;
  x: Float32Array; y: Float32Array; z: Float32Array; tx: Float32Array; tz: Float32Array; curv: Float32Array;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number) { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); }

function generate(spec: TrackSpec, wobble: number, relax = 1): Track {
  const rng = new Rng(spec.seed), lobes = spec.closed ? spec.lobes ?? 0 : 0, depth = (spec.depth ?? 0) * relax; const K = Math.max(spec.knots, lobes * 5); const cx: number[] = [], cy: number[] = [], cz: number[] = [];
  if (spec.closed) {
    // lobes pull the loop inward at intervals, giving hairpins, esses and straights instead of one long bend
    const stretch = spec.stretch ?? 1, sx = rng.range(0.85, 1.3) * stretch, sz = rng.range(0.85, 1.3) / Math.sqrt(stretch), phase = rng.range(0, TAU);
    for (let i = 0; i < K; i++) {
      const a = ((i + rng.range(-0.22, 0.22) * (lobes ? 0.5 : 1)) / K) * TAU, r = spec.radius * (1 + depth * Math.cos(lobes * a + phase)) * (1 + wobble * rng.range(-0.5, 0.5) * (lobes ? 0.5 : 1));
      cx.push(Math.cos(a) * r * sx); cz.push(Math.sin(a) * r * sz); cy.push(spec.elevation * rng.range(-1, 1));
    }
    cy[0] = 0; cy[1] *= 0.3; cy[K - 1] *= 0.3; // gentle start straight
  } else {
    const L = spec.length ?? 1400, seg = L / (K - 1); let x = 0;
    for (let i = 0; i < K; i++) { if (i > 1) x += rng.range(-1, 1) * seg * wobble * 1.1; cx.push(x); cz.push(i * seg); cy.push(i < 2 ? 0 : spec.elevation * rng.range(-1, 1)); }
  }
  // dense sampling, then resample at an even ~2 m arc-length spacing
  const dense: number[] = []; const segs = spec.closed ? K : K - 1, SUB = 40;
  const at = (i: number) => (spec.closed ? (i + K) % K : Math.max(0, Math.min(K - 1, i)));
  for (let s = 0; s < segs; s++) for (let j = 0; j < SUB; j++) { const t = j / SUB; dense.push(catmull(cx[at(s - 1)], cx[at(s)], cx[at(s + 1)], cx[at(s + 2)], t), catmull(cy[at(s - 1)], cy[at(s)], cy[at(s + 1)], cy[at(s + 2)], t), catmull(cz[at(s - 1)], cz[at(s)], cz[at(s + 1)], cz[at(s + 2)], t)); }
  if (!spec.closed) dense.push(cx[K - 1], cy[K - 1], cz[K - 1]);
  const m = dense.length / 3; const acc = [0];
  for (let i = 1; i <= (spec.closed ? m : m - 1); i++) { const a = (i - 1) * 3, b = (i % m) * 3; acc.push(acc[i - 1] + Math.hypot(dense[b] - dense[a], dense[b + 2] - dense[a + 2])); }
  const length = acc[acc.length - 1]; const n = Math.max(32, Math.round(length / 2)); const step = length / (spec.closed ? n : n - 1);
  const t: Track = { spec, closed: spec.closed, n, step, length, width: spec.width, x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), tx: new Float32Array(n), tz: new Float32Array(n), curv: new Float32Array(n) };
  let k = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.min(length - 1e-4, i * step); while (k < acc.length - 2 && acc[k + 1] < d) k++;
    const f = (d - acc[k]) / Math.max(1e-6, acc[k + 1] - acc[k]), a = k * 3, b = ((k + 1) % m) * 3;
    t.x[i] = dense[a] + (dense[b] - dense[a]) * f; t.y[i] = dense[a + 1] + (dense[b + 1] - dense[a + 1]) * f; t.z[i] = dense[a + 2] + (dense[b + 2] - dense[a + 2]) * f;
  }
  const idx = (i: number) => (spec.closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i)));
  for (let i = 0; i < n; i++) { const a = idx(i - 1), b = idx(i + 1); const dx = t.x[b] - t.x[a], dz = t.z[b] - t.z[a], l = Math.hypot(dx, dz) || 1; t.tx[i] = dx / l; t.tz[i] = dz / l; }
  for (let i = 0; i < n; i++) { const a = idx(i - 1), b = idx(i + 1); t.curv[i] = wrapAngle(Math.atan2(t.tx[b], t.tz[b]) - Math.atan2(t.tx[a], t.tz[a])) / (2 * step); }
  // smooth elevation so ramps stay rideable
  for (let pass = 0; pass < 6; pass++) { const c = t.y.slice(); for (let i = 0; i < n; i++) t.y[i] = (c[idx(i - 2)] + c[idx(i - 1)] + c[i] + c[idx(i + 1)] + c[idx(i + 2)]) / 5; }
  return t;
}

/** Navigability checks: corners wide enough for the ribbon and no near self-overlap. */
export function validateTrack(t: Track): string[] {
  const issues: string[] = []; let maxC = 0; for (let i = 0; i < t.n; i++) maxC = Math.max(maxC, Math.abs(t.curv[i]));
  if (maxC > 1 / (t.width * 0.62)) issues.push('corner tighter than track width allows');
  const gap = Math.ceil((t.width * 2.2) / t.step), minD = t.width + 3;
  outer: for (let i = 0; i < t.n; i += 3) for (let j = i + gap; j < t.n; j += 3) {
    if (t.closed && t.n - j + i < gap) continue;
    if (Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]) < minD && Math.abs(t.y[i] - t.y[j]) < 6) { issues.push('track overlaps itself'); break outer; }
  }
  if (t.length < 300) issues.push('track too short');
  return issues;
}

/** Builds a track and relaxes it until it validates, so no generated circuit reaches the player unchecked. */
export function buildTrack(spec: TrackSpec): Track {
  let w = spec.wobble, k = 1, t = generate(spec, w, k);
  for (let i = 0; i < 12 && validateTrack(t).length; i++) { w *= 0.8; k *= 0.86; t = generate(spec, w, k); }
  return t;
}

export function wrapIdx(t: Track, i: number) { return t.closed ? ((i % t.n) + t.n) % t.n : Math.max(0, Math.min(t.n - 1, i)); }
/** Nearest centre-line sample, searched in a window around a hint index. */
export function nearestIdx(t: Track, x: number, z: number, hint: number, window = 14): number {
  let best = hint, bd = Infinity;
  for (let k = -window; k <= window; k++) { const i = wrapIdx(t, hint + k); const d = (t.x[i] - x) ** 2 + (t.z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}
/** Lateral offset (right positive) relative to the centre line at sample i. */
export function lateral(t: Track, i: number, x: number, z: number) { return (x - t.x[i]) * -t.tz[i] + (z - t.z[i]) * t.tx[i]; }
export function trackPoint(t: Track, i: number, d: number, out: { x: number; y: number; z: number }) { i = wrapIdx(t, i); out.x = t.x[i] - t.tz[i] * d; out.y = t.y[i]; out.z = t.z[i] + t.tx[i] * d; return out; }

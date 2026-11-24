import { Rng, TAU, wrapAngle } from '../../engine/math';

/** Built sections of trackside world. The simulation ignores them; they drive what gets built around the ribbon. */
export type FeatureKind = 'tunnel' | 'bridge' | 'canyon';
export interface TrackFeature { kind: FeatureKind; i0: number; i1: number }

export interface TrackSpec { seed: number; closed: boolean; radius: number; wobble: number; elevation: number; width: number; knots: number; length?: number;
  /** Closed circuits: number of inward bends (0 = plain oval), how deep they cut (0..0.5), and how far the loop is stretched. */ lobes?: number; depth?: number; stretch?: number;
  /** Rolling terrain: crest-to-dip height in metres and how many crests the lap carries. Smooth, unlike `elevation`. */ hills?: number; hillCount?: number;
  /** Trackside sections to build: enclosed tunnels, elevated bridge spans, and city canyons walled by towers. */ tunnels?: number; bridges?: number; canyons?: number;
  /** Corner banking: peak cross-slope (rise per metre of lateral offset) the outside of a corner is lifted by. */ bank?: number }
export interface Track {
  spec: TrackSpec; closed: boolean; n: number; step: number; length: number; width: number;
  x: Float32Array; y: Float32Array; z: Float32Array; tx: Float32Array; tz: Float32Array; curv: Float32Array;
  /** Cross-slope at each sample: the surface height at lateral offset d is y[i] + bank[i] * d. */ bank: Float32Array;
  features: TrackFeature[];
}
/** Surface height at a lateral offset, with the corner's cross-slope applied. */
export function surfaceY(t: Track, i: number, d: number) { return t.y[i] + t.bank[i] * d; }
/** True where sample i sits inside a built section of the given kind. */
export function inFeature(t: Track, i: number, kind: FeatureKind) {
  for (const f of t.features) if (f.kind === kind && ((i >= f.i0 && i <= f.i1) || (f.i1 >= t.n && i + t.n >= f.i0 && i + t.n <= f.i1))) return true;
  return false;
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
  const t: Track = { spec, closed: spec.closed, n, step, length, width: spec.width, x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), tx: new Float32Array(n), tz: new Float32Array(n), curv: new Float32Array(n), bank: new Float32Array(n), features: [] };
  let k = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.min(length - 1e-4, i * step); while (k < acc.length - 2 && acc[k + 1] < d) k++;
    const f = (d - acc[k]) / Math.max(1e-6, acc[k + 1] - acc[k]), a = k * 3, b = ((k + 1) % m) * 3;
    t.x[i] = dense[a] + (dense[b] - dense[a]) * f; t.y[i] = dense[a + 1] + (dense[b + 1] - dense[a + 1]) * f; t.z[i] = dense[a + 2] + (dense[b + 2] - dense[a + 2]) * f;
  }
  const idx = (i: number) => (spec.closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i)));
  for (let i = 0; i < n; i++) { const a = idx(i - 1), b = idx(i + 1); const dx = t.x[b] - t.x[a], dz = t.z[b] - t.z[a], l = Math.hypot(dx, dz) || 1; t.tx[i] = dx / l; t.tz[i] = dz / l; }
  for (let i = 0; i < n; i++) { const a = idx(i - 1), b = idx(i + 1); t.curv[i] = wrapAngle(Math.atan2(t.tx[b], t.tz[b]) - Math.atan2(t.tx[a], t.tz[a])) / (2 * step); }
  // Rolling terrain: a long sine profile gives crests and dips a rider can read and commit to, where the knot noise
  // above only ever gave bumps. Two harmonics keep a lap from feeling like one repeated hump.
  const hills = (spec.hills ?? 0) * relax;
  if (hills > 0.01) {
    const hc = Math.max(1, Math.round(spec.hillCount ?? 3)), ph = rng.range(0, TAU), ph2 = rng.range(0, TAU);
    for (let i = 0; i < n; i++) {
      // open courses run the profile along distance; a closed lap must come back to its own start height
      const u = spec.closed ? (i / n) * TAU : (i / (n - 1)) * TAU * hc * 0.5;
      const a = spec.closed ? hc * u : u, b = spec.closed ? hc * 2 * u : u * 2;
      let h = Math.sin(a + ph) * 0.68 + Math.sin(b + ph2) * 0.32;
      if (!spec.closed) h -= Math.sin(ph) * 0.68 + Math.sin(ph2) * 0.32; // a sprint starts level
      t.y[i] += h * hills;
    }
    // a closed lap uses whole harmonics of the loop, so the profile meets its own start height exactly
  }
  // smooth elevation so ramps stay rideable; rougher profiles get more passes so nothing turns into judder underwheel
  const passes = 6 + Math.round(Math.min(10, spec.elevation * 0.5));
  for (let pass = 0; pass < passes; pass++) { const c = t.y.slice(); for (let i = 0; i < n; i++) t.y[i] = (c[idx(i - 2)] + c[idx(i - 1)] + c[i] + c[idx(i + 1)] + c[idx(i + 2)]) / 5; }
  // corner banking: the outside of a bend is lifted, so a committed line through it is rewarded instead of punished
  const bank = (spec.bank ?? 0) * relax;
  if (bank > 0.001) {
    for (let i = 0; i < n; i++) t.bank[i] = Math.max(-bank, Math.min(bank, t.curv[i] * bank * 70));
    for (let pass = 0; pass < 8; pass++) { const c = t.bank.slice(); for (let i = 0; i < n; i++) t.bank[i] = (c[idx(i - 2)] + c[idx(i - 1)] + c[i] + c[idx(i + 1)] + c[idx(i + 2)]) / 5; }
    // a banked lap must still meet itself level at the line
    if (spec.closed) { const ramp = Math.min(n / 5, Math.round(70 / step)); for (let k = 0; k < ramp; k++) { const w = k / ramp; t.bank[k] *= w; t.bank[idx(-1 - k)] *= w; } }
  }
  t.features = placeFeatures(t, spec, rng);
  return t;
}

/**
 * Lays out the built sections round a lap: enclosed tunnels, elevated bridge spans and tower-walled city canyons.
 * They never overlap, never sit on the start straight, and are only placed where the ribbon has room for them.
 */
function placeFeatures(t: Track, spec: TrackSpec, rng: Rng): TrackFeature[] {
  const out: TrackFeature[] = []; const n = t.n, step = t.step;
  const want: [FeatureKind, number, number][] = [ // kind, count, length in metres
    ['tunnel', Math.round(spec.tunnels ?? 0), 110],
    ['bridge', Math.round(spec.bridges ?? 0), 150],
    ['canyon', Math.round(spec.canyons ?? 0), 210],
  ];
  const total = want.reduce((s, w) => s + w[1], 0); if (!total) return out;
  // keep the start straight clear so a rider can see the grid, the gantry and the first corner
  const lo = Math.round(55 / step), hi = n - Math.round(45 / step);
  const usable = hi - lo; if (usable < 40) return out;
  // round-robin the kinds so a lap alternates rather than running three tunnels back to back
  const queues = want.filter((w) => w[1] > 0).map(([kind, count, metres]) => ({ kind, left: count, len: Math.max(16, Math.round(metres / step)) }));
  const woven: { kind: FeatureKind; len: number }[] = [];
  while (queues.some((q) => q.left > 0)) for (const q of queues) if (q.left > 0) { q.left--; woven.push({ kind: q.kind, len: q.len }); }
  const gap = Math.round(60 / step), need = woven.reduce((s, w) => s + w.len + gap, 0);
  const scale = need > usable ? usable / need : 1;
  let cursor = lo + Math.round(rng.range(0, 20));
  for (const s of woven) {
    const len = Math.max(14, Math.round(s.len * scale)), i0 = cursor, i1 = i0 + len;
    if (i1 > hi) break;
    out.push({ kind: s.kind, i0, i1 }); cursor = i1 + Math.max(10, Math.round(gap * scale));
  }
  return out;
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
export function trackPoint(t: Track, i: number, d: number, out: { x: number; y: number; z: number }) { i = wrapIdx(t, i); out.x = t.x[i] - t.tz[i] * d; out.y = t.y[i] + t.bank[i] * d; out.z = t.z[i] + t.tx[i] * d; return out; }

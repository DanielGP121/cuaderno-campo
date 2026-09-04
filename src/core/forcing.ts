/**
 * Forcing-chamber arithmetic: bud counts per tube, the share of buds that have left
 * dormancy, the per-tree mean across replicate tubes, the drops between consecutive
 * samplings that flag a reading error, and the linear CP50 interpolation the group's
 * R pipeline uses.
 *
 * Why it matters: CP50 is the chilling requirement of each cultivar, the number the
 * whole MOSAIC phenotyping exists to produce. In 2025-2026 the R pipeline found 42
 * drops in 31 trees after the fact; the app checks them at the moment of the reading.
 */
import { BUD_STAGE_KEYS, BUD_STAGES_RELEASED, type BudStageKey } from "./scales";

export type BudCounts = Record<BudStageKey, number>;

export function emptyCounts(): BudCounts {
  return { AorB: 0, BC: 0, C: 0, D: 0, E: 0, F: 0 };
}

export function totalBuds(c: BudCounts): number {
  return BUD_STAGE_KEYS.reduce((s, k) => s + (c[k] ?? 0), 0);
}

/** Buds at stage BC or later, the ones counted as released from dormancy. */
export function releasedBuds(c: BudCounts): number {
  return BUD_STAGES_RELEASED.reduce((s, k) => s + (c[k] ?? 0), 0);
}

/**
 * Fraction of buds beyond stage B-C (the workbook's `%Nb>BC`), or null when the tube
 * has no buds. Kept as a fraction 0..1; the exporter formats it as the sheet expects.
 */
export function fractionReleased(c: BudCounts): number | null {
  const t = totalBuds(c);
  return t === 0 ? null : releasedBuds(c) / t;
}

/** Fraction of buds at each stage, as the consolidated CP workbook lists them. */
export function stageFractions(c: BudCounts): Record<BudStageKey, number | null> {
  const t = totalBuds(c);
  const out = {} as Record<BudStageKey, number | null>;
  for (const k of BUD_STAGE_KEYS) out[k] = t === 0 ? null : (c[k] ?? 0) / t;
  return out;
}

/** Arithmetic mean of the replicate fractions that have a value (tubes without buds are skipped). */
export function meanReleased(tubes: BudCounts[]): number | null {
  const vals = tubes.map(fractionReleased).filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export interface CurvePoint {
  samplingNumber: number;
  /** Chill portions at the cut date. */
  cp: number;
  /** Mean fraction released across tubes, null when no tube had buds. */
  fraction: number | null;
}

export type DropSeverity = "leve" | "moderado" | "severo";

export interface Drop {
  from: CurvePoint;
  to: CurvePoint;
  delta: number;
  severity: DropSeverity;
}

/**
 * Drops between consecutive samplings. A tree that was 90 % released one week and 20 %
 * the next has a reading, tube or code problem, not biology. Any decrease counts. The
 * severity bands and the arithmetic mirror the R pipeline (`Analisis_cp50_v3.Rmd` §8.1):
 * magnitude below 0.05 leve, below 0.10 moderado, otherwise severo, compared without
 * tolerance so that both give the same label on the same numbers.
 */
export function detectDrops(
  curve: CurvePoint[],
  thresholds: { moderado: number; severo: number } = { moderado: 0.05, severo: 0.1 },
): Drop[] {
  const pts = [...curve].sort((a, b) => a.samplingNumber - b.samplingNumber);
  const drops: Drop[] = [];
  let prev: CurvePoint | null = null;
  for (const p of pts) {
    if (p.fraction === null) continue;
    if (prev && prev.fraction !== null) {
      const delta = p.fraction - prev.fraction;
      if (delta < 0) {
        const mag = -delta;
        // A magnitude sitting on a band edge belongs to the lower band: R's mean() carries
        // extended precision, so 0.10 there can be 0.0999... here. 1e-9 absorbs that.
        const eps = 1e-9;
        const severity: DropSeverity = mag < thresholds.moderado + eps ? "leve" : mag < thresholds.severo + eps ? "moderado" : "severo";
        drops.push({ from: prev, to: p, delta, severity });
      }
    }
    prev = p;
  }
  return drops;
}

export type Cp50Method = "linear_2pts" | "first_sampling" | "never_50pct" | "no_data";

export interface Cp50Result {
  cp50: number | null;
  method: Cp50Method;
  /** The two points used for the interpolation, when applicable. */
  bracket?: [CurvePoint, CurvePoint];
}

/**
 * Linear CP50 as the group defines it: find the first sampling whose mean fraction
 * reaches 0.5, interpolate on the straight line from the previous sampling.
 * Edge cases follow the workflow document: already >= 0.5 at the first sampling gives
 * that sampling's CP; never reaching 0.5 gives null.
 */
export function cp50Linear(curve: CurvePoint[], threshold = 0.5): Cp50Result {
  const pts = [...curve].filter((p) => p.fraction !== null).sort((a, b) => a.samplingNumber - b.samplingNumber);
  if (pts.length === 0) return { cp50: null, method: "no_data" };
  const first = pts[0]!;
  if ((first.fraction as number) >= threshold) return { cp50: first.cp, method: "first_sampling" };
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    if ((p.fraction as number) >= threshold) {
      const q = pts[i - 1]!;
      const m = ((p.fraction as number) - (q.fraction as number)) / (p.cp - q.cp);
      const cp50 = q.cp + (threshold - (q.fraction as number)) / m;
      return { cp50, method: "linear_2pts", bracket: [q, p] };
    }
  }
  return { cp50: null, method: "never_50pct" };
}

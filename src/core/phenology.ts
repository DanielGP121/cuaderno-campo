/**
 * Field phenology: from the stage observed at each visit to the dates the group
 * reports (F10, F50, F80, C10, C90), plus the order checks that catch the typos the
 * 2026 season had (F50 before F10, F80 before F50, month 02 for 03).
 *
 * Why it matters: F50 in Julian days is the flowering-date phenotype that feeds the
 * GWAS and the multisite comparison; a derived date cannot carry a typing error.
 */
import { FLOWER_STAGES_EEAD, rankOf } from "./scales";
import type { ScaleCategory } from "./types";

export interface StageVisit {
  /** ISO date of the visit (YYYY-MM-DD). */
  date: string;
  /** Raw stage label as observed. */
  stage: string;
}

/** Thresholds the group reports, with the rank they correspond to on the EEAD scale. */
export const REPORTED_THRESHOLDS: { key: string; rank: number }[] = [
  { key: "F10", rank: 10 },
  { key: "F50", rank: 50 },
  { key: "F80", rank: 80 },
  { key: "C10", rank: 110 },
  { key: "C90", rank: 190 },
];

/**
 * First visit date at which the tree had reached each reported threshold, or null when
 * the threshold was never observed. Visits with unknown labels ("?") are ignored.
 * The result is what the `Fecha_F10 .. Fecha_C90` columns hold.
 */
export function deriveThresholdDates(
  visits: StageVisit[],
  categories: ScaleCategory[] = FLOWER_STAGES_EEAD,
  thresholds = REPORTED_THRESHOLDS,
): Record<string, string | null> {
  const ranked = visits
    .map((v) => ({ date: v.date, rank: rankOf(categories, v.stage) }))
    .filter((v): v is { date: string; rank: number } => v.rank !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: Record<string, string | null> = {};
  for (const t of thresholds) {
    const hit = ranked.find((v) => v.rank >= t.rank);
    out[t.key] = hit ? hit.date : null;
  }
  return out;
}

export interface DateOrderIssue {
  earlier: string;
  later: string;
  message: string;
}

/**
 * Check that reported dates are in biological order (F10 <= F50 <= F80 <= C10 <= C90).
 * Used on import of hand-typed sheets and before export; derived dates cannot fail it.
 */
export function checkDateOrder(dates: Record<string, string | null>, thresholds = REPORTED_THRESHOLDS): DateOrderIssue[] {
  const issues: DateOrderIssue[] = [];
  const keys = thresholds.map((t) => t.key);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = dates[keys[i]!];
      const b = dates[keys[j]!];
      if (a && b && b < a) {
        issues.push({ earlier: keys[i]!, later: keys[j]!, message: `${keys[j]} (${b}) is before ${keys[i]} (${a})` });
      }
    }
  }
  return issues;
}

/**
 * What a visit label of the EEAD lists actually encodes. The people in the field write
 * compact codes such as `F0`, `DE-F1`, `F5-10`, `F95-C5`, `C30`, `F100-C10-20`:
 * optional pre-bloom Baggiolini letters, the percentage of open flowers (F) and the
 * percentage of fallen petals (C). Ranges are read as their midpoint.
 */
export interface ParsedStage {
  /** Pre-bloom letters as written ("DE", "CD"), empty when none. */
  pre: string;
  /** Percentage of open flowers, 0..100. */
  open: number;
  /** Percentage of petal fall, 0..100. A bare "C" (fall started) counts as 1. */
  fall: number;
  raw: string;
}

const RANGE = String.raw`(\d{1,3})(?:\s*-\s*(\d{1,3}))?`;
// Pre-bloom letters A..E (Baggiolini) in any combination, then F<pct>, then C<pct>.
// "F-90" (a stray dash) is accepted as F90.
const LABEL_RE = new RegExp(`^([A-E]{1,3})?\\s*-?\\s*(?:F\\s*-?\\s*${RANGE})?\\s*-?\\s*(?:C\\s*(?:${RANGE})?)?$`, "i");

function mid(a: string | undefined, b: string | undefined): number | null {
  if (a === undefined) return null;
  const x = Number(a);
  const y = b === undefined ? x : Number(b);
  // a range that goes down ("C100-20") is a typo, not a range
  if (!Number.isFinite(x) || !Number.isFinite(y) || x > 100 || y > 100 || y < x) return null;
  return (x + y) / 2;
}

/** Parse a visit label; null for anything that is not a stage ("Tratam", "?", dates, typos). */
export function parseStageLabel(label: string): ParsedStage | null {
  const raw = label.trim();
  // "F40-F50" and "C5-C10" are ranges with the letter repeated; read them as F40-50 and C5-10.
  const s = raw
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/F(\d{1,3})-F(\d{1,3})/g, "F$1-$2")
    .replace(/C(\d{1,3})-C(\d{1,3})/g, "C$1-$2");
  if (s === "") return null;
  const m = LABEL_RE.exec(s);
  if (!m) return null;
  const pre = m[1] ?? "";
  const hasF = m[2] !== undefined;
  const rest = s.replace(/^[A-E]{1,3}-?/, "").replace(/F-?\d+(-\d+)?/, "");
  const hasC = /C(?:\d|$)/.test(rest) || /-C$/.test(s) || /^C\d/.test(s);
  const open = hasF ? mid(m[2], m[3]) : null;
  const fallNum = m[4] !== undefined ? mid(m[4], m[5]) : null;
  if (!hasF && !hasC && pre === "") return null;
  if (hasF && open === null) return null;
  if (m[4] !== undefined && fallNum === null) return null;
  let fall = 0;
  if (fallNum !== null) fall = fallNum;
  else if (hasC) fall = 1;
  let openPct = open ?? 0;
  // A bare petal-fall code implies full bloom was reached.
  if (!hasF && hasC) openPct = 100;
  return { pre, open: openPct, fall, raw };
}

export interface LabelVisit {
  date: string;
  label: string;
}

/**
 * Reported dates from visit labels: first visit with open flowers at or above 10, 50
 * and 80 %, and with petal fall at or above 10 and 90 %. Unparseable labels are skipped
 * and returned so the person can fix them.
 */
export function deriveDatesFromLabels(visits: LabelVisit[]): { dates: Record<string, string | null>; unparsed: LabelVisit[] } {
  const parsed: { date: string; stage: ParsedStage }[] = [];
  const unparsed: LabelVisit[] = [];
  for (const v of visits) {
    const p = parseStageLabel(v.label);
    if (p) parsed.push({ date: v.date, stage: p });
    else if (v.label.trim() !== "") unparsed.push(v);
  }
  parsed.sort((a, b) => a.date.localeCompare(b.date));
  const first = (pred: (s: ParsedStage) => boolean) => parsed.find((p) => pred(p.stage))?.date ?? null;
  return {
    dates: {
      F10: first((s) => s.open >= 10),
      F50: first((s) => s.open >= 50),
      F80: first((s) => s.open >= 80),
      C10: first((s) => s.fall >= 10),
      C90: first((s) => s.fall >= 90),
    },
    unparsed,
  };
}

/** Compact label in the group's style from percentages, for the export. */
export function formatStageLabel(s: { pre?: string; open: number; fall: number }): string {
  const parts: string[] = [];
  if (s.pre) parts.push(s.pre.toUpperCase());
  if (s.open > 0 || !s.pre) parts.push(`F${Math.round(s.open)}`);
  if (s.fall > 0) parts.push(`C${Math.round(s.fall)}`);
  return parts.join("-");
}

/** Day of year (1..366) for an ISO date, what the sheets call JD. */
export function dayOfYear(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const start = Date.UTC(y, 0, 1);
  const day = Date.UTC(y, m - 1, d);
  return Math.round((day - start) / 86_400_000) + 1;
}

/** Days between two ISO dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

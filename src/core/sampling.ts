/**
 * Planning a sampling day: which trees to cut, how many tubes each, and the tube
 * codes and units that come out of it. Replaces the hand-drawn sampling maps
 * (`Peach Collection_EEAD_Field_J4-7_Full sampling.pdf`).
 *
 * Rules taken from the 2025-2026 season: full samplings take every reference tree
 * with three tubes (A, B, C); early samplings, run between two full ones, take only
 * the early-flowering group; trees marked with fewer replicates get fewer tubes.
 */
import { replicateLetters, tubeCode, ulid } from "./ids";
import type { ObservationUnit, Sampling } from "./types";

export interface SamplingPlanOptions {
  number: number;
  cutDate: string;
  /** "full" takes every reference tree; "early" only the early group. */
  kind: "full" | "early";
  /** Default replicates per tree. */
  replicates?: number;
  site?: string;
  chillPortions?: number;
  /** Explicit tree ids, overriding the reference/early rule. */
  treeIds?: string[];
}

export interface PlannedTube {
  treeId: string;
  code: string;
  replicate: string | undefined;
}

export interface SamplingPlan {
  sampling: Sampling;
  tubes: PlannedTube[];
}

/** Replicates a tree gets: its own `replicates` attribute if set, else the default. */
export function replicatesFor(tree: ObservationUnit, fallback: number): number {
  const v = tree.attributes?.["replicates"];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Trees a sampling of this kind should include. */
export function treesForSampling(trees: ObservationUnit[], kind: "full" | "early"): ObservationUnit[] {
  return trees.filter((t) => t.level === "tree" && t.isReference && (kind === "full" || t.earlyGroup));
}

export function planSampling(trees: ObservationUnit[], opts: SamplingPlanOptions): SamplingPlan {
  const reps = opts.replicates ?? 3;
  const chosen = opts.treeIds ? trees.filter((t) => opts.treeIds!.includes(t.id)) : treesForSampling(trees, opts.kind);
  const sampling: Sampling = {
    id: ulid(),
    number: opts.number,
    cutDate: opts.cutDate,
    replicates: replicateLetters(reps),
    treeIds: chosen.map((t) => t.id),
  };
  if (opts.site) sampling.site = opts.site;
  if (opts.chillPortions !== undefined) sampling.chillPortions = opts.chillPortions;
  const tubes: PlannedTube[] = [];
  for (const t of chosen) {
    const n = replicatesFor(t, reps);
    const code = t.cultivarCode ?? t.name;
    if (n <= 1) tubes.push({ treeId: t.id, code: tubeCode(code, opts.number), replicate: undefined });
    else for (const r of replicateLetters(n)) tubes.push({ treeId: t.id, code: tubeCode(code, opts.number, r), replicate: r });
  }
  return { sampling, tubes };
}

/** Materialise the planned tubes as units, ready to be logged. */
export function tubesAsUnits(plan: SamplingPlan): ObservationUnit[] {
  return plan.tubes.map((t) => {
    const u: ObservationUnit = {
      id: ulid(),
      name: t.code,
      level: "tube",
      parentId: t.treeId,
      cutDate: plan.sampling.cutDate,
      attributes: { samplingNumber: plan.sampling.number, samplingId: plan.sampling.id },
    };
    if (t.replicate) {
      u.rep = t.replicate.charCodeAt(0) - 64;
      u.attributes!["replicate"] = t.replicate;
    }
    if (plan.sampling.chillPortions !== undefined) u.chillPortions = plan.sampling.chillPortions;
    return u;
  });
}

/**
 * Walking order for the field list: by plot, row and position when known, else by
 * cultivar code as a number, else by name. Rows alternate direction (serpentine) so
 * the person never walks back along an empty row.
 */
export function walkingOrder(trees: ObservationUnit[], serpentine = true): ObservationUnit[] {
  const key = (t: ObservationUnit) => [t.plot ?? "", t.row ?? Number.MAX_SAFE_INTEGER, t.position ?? Number.MAX_SAFE_INTEGER, Number(t.cultivarCode) || Number.MAX_SAFE_INTEGER, t.name] as const;
  const sorted = [...trees].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      const x = ka[i]!;
      const y = kb[i]!;
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  });
  if (!serpentine) return sorted;
  const out: ObservationUnit[] = [];
  let i = 0;
  let flip = false;
  while (i < sorted.length) {
    const t = sorted[i]!;
    let j = i;
    while (j < sorted.length && sorted[j]!.plot === t.plot && sorted[j]!.row === t.row) j++;
    const rowTrees = sorted.slice(i, j);
    out.push(...(flip ? rowTrees.reverse() : rowTrees));
    flip = !flip;
    i = j;
  }
  return out;
}

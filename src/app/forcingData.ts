/**
 * Views over the project state for the chamber screens and the export: the dataset
 * the exporter wants, the curve of each tree across samplings, and the mean of a
 * sampling with and without a provisional reading.
 */
import type { ProjectState } from "@core/events";
import { latestReadings, type ForcingDataset } from "@core/exporters/forcingWorkbook";
import { detectDrops, fractionReleased, type BudCounts, type CurvePoint, type Drop } from "@core/forcing";
import type { ObservationUnit, Sampling } from "@core/types";

export function datasetFromState(state: ProjectState): ForcingDataset {
  const live = (u: ObservationUnit) => !state.retiredUnits.has(u.id);
  const units = [...state.units.values()].filter(live);
  return {
    trees: units.filter((u) => u.level === "tree"),
    tubes: units.filter((u) => u.level === "tube"),
    samplings: [...state.samplings.values()],
    observations: [...state.observations.values()],
  };
}

export function samplingOfTube(state: ProjectState, tube: ObservationUnit): Sampling | undefined {
  const sid = tube.attributes?.["samplingId"];
  if (typeof sid === "string") {
    const s = state.samplings.get(sid);
    if (s) return s;
  }
  const sn = tube.attributes?.["samplingNumber"];
  if (typeof sn === "number") return [...state.samplings.values()].find((s) => s.number === sn);
  return undefined;
}

/** Tubes of a tree in a sampling, in replicate order. */
export function tubesOf(state: ProjectState, tree: ObservationUnit, sampling: Sampling): ObservationUnit[] {
  return [...state.units.values()]
    .filter((u) => u.level === "tube" && u.parentId === tree.id && !state.retiredUnits.has(u.id) && samplingOfTube(state, u)?.id === sampling.id)
    .sort((a, b) => (a.rep ?? 0) - (b.rep ?? 0) || a.name.localeCompare(b.name));
}

/**
 * Curve of a tree: mean fraction beyond B-C per sampling, using the latest reading of
 * each tube. `provisional` replaces (or adds) one tube's reading before it is saved,
 * so the screen can warn about a drop while the person still has the tube in hand.
 */
export function treeCurve(state: ProjectState, tree: ObservationUnit, provisional?: { tubeId: string; counts: BudCounts }): CurvePoint[] {
  const readings = latestReadings([...state.observations.values()]);
  const perSampling = new Map<string, { sampling: Sampling; vals: number[] }>();
  for (const tube of [...state.units.values()]) {
    if (tube.level !== "tube" || tube.parentId !== tree.id || state.retiredUnits.has(tube.id)) continue;
    const sampling = samplingOfTube(state, tube);
    if (!sampling) continue;
    let f: number | null = null;
    if (provisional && provisional.tubeId === tube.id) f = fractionReleased(provisional.counts);
    else f = readings.get(tube.id)?.fraction ?? null;
    if (f === null) continue;
    const g = perSampling.get(sampling.id) ?? { sampling, vals: [] };
    g.vals.push(f);
    perSampling.set(sampling.id, g);
  }
  return [...perSampling.values()]
    .map(({ sampling, vals }) => {
      const tubeCp = [...state.units.values()].find((u) => u.level === "tube" && u.parentId === tree.id && samplingOfTube(state, u)?.id === sampling.id && u.chillPortions !== undefined)?.chillPortions;
      return { samplingNumber: sampling.number, cp: tubeCp ?? sampling.chillPortions ?? sampling.number, fraction: vals.reduce((a, b) => a + b, 0) / vals.length };
    })
    .sort((a, b) => a.samplingNumber - b.samplingNumber);
}

/** The drop that ends at the given sampling, if any. */
export function dropAt(curve: CurvePoint[], samplingNumber: number): Drop | undefined {
  return detectDrops(curve).find((d) => d.to.samplingNumber === samplingNumber);
}

export function previousPoint(curve: CurvePoint[], samplingNumber: number): CurvePoint | undefined {
  return [...curve].filter((p) => p.samplingNumber < samplingNumber).sort((a, b) => b.samplingNumber - a.samplingNumber)[0];
}

/** Which tubes of a sampling have a reading. */
export function readTubeIds(state: ProjectState): Set<string> {
  return new Set(latestReadings([...state.observations.values()]).keys());
}

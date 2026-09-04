/**
 * Export of a forcing season in the group's own workbook layout, plus the consolidated
 * sheet the R pipeline (`Analisis_cp50_v3.Rmd`) reads, plus a long table for R.
 *
 * Why it matters: from November 2026 this export IS the official workbook. Every
 * column name and order below is copied from `Peach_Branches_Breaking Dormancy_EEAD_
 * MOSAIC_2025.xlsx` (sheet `12_Sampling`, the most complete) and from `MOSAIC_2025_
 * EEAD_peach_CP_data DEF.xlsx` (sheet `2025-2026`), so that the season's analysis
 * runs unchanged on the file this produces.
 */
import { BUD_STAGE_KEYS } from "../scales";
import { fractionReleased, releasedBuds, totalBuds, type BudCounts } from "../forcing";
import { dayOfYear, daysBetween } from "../phenology";
import type { Observation, ObservationUnit, Sampling } from "../types";
import { writeWorkbook, type OutCell, type OutSheet } from "../xlsx/writer";

export interface ForcingDataset {
  trees: ObservationUnit[];
  tubes: ObservationUnit[];
  samplings: Sampling[];
  observations: Observation[];
}

export interface TubeReading {
  counts: BudCounts | null;
  /** Fraction beyond B-C: from the counts when present, else the recorded fraction. */
  fraction: number | null;
  note?: string;
  observedAt?: string;
}

const READING_VARIABLES = new Set(["budStageCounts", "budReleasedFraction"]);

/**
 * Latest valid reading per tube. Observations that have been superseded by a
 * correction are ignored; among the rest, the most recent timestamp wins, ties by id.
 */
export function latestReadings(observations: Observation[]): Map<string, TubeReading> {
  const superseded = new Set(observations.map((o) => o.supersedes).filter((s): s is string => Boolean(s)));
  const best = new Map<string, Observation>();
  for (const o of observations) {
    if (!READING_VARIABLES.has(o.variableId) || superseded.has(o.id)) continue;
    const cur = best.get(o.unitId);
    if (!cur || o.observationTimeStamp > cur.observationTimeStamp || (o.observationTimeStamp === cur.observationTimeStamp && o.id > cur.id)) {
      best.set(o.unitId, o);
    }
  }
  const out = new Map<string, TubeReading>();
  for (const [unitId, o] of best) {
    const r: TubeReading = { counts: null, fraction: null };
    if (o.variableId === "budStageCounts" && o.value && typeof o.value === "object") {
      r.counts = o.value as BudCounts;
      r.fraction = fractionReleased(r.counts);
    } else if (typeof o.value === "number") {
      r.fraction = o.value;
    }
    if (o.note) r.note = o.note;
    if (o.observationTimeStamp) r.observedAt = o.observationTimeStamp;
    out.set(unitId, r);
  }
  return out;
}

/** Header of a per-sampling sheet, in the group's order. */
export const SAMPLING_SHEET_HEADER = [
  "Sample_code", "Sampling_number", "Date Sampling", "Date Sampling_JD", "Date Reading_JD", "Days_Nb", "CP", "REP",
  "Cultivar_code", "Accession", "Accession number", "Origin", "Early", "ID GWAS Mas-Gomez", "Origin",
  "Total_Nb_Buds", "Nb_AorB", "Nb_B-C*", "Nb_C", "Nb_D", "Nb_E", "Nb_F", "Total_non-B", "Observ",
  "Nb_AorB", "Nb_B-C*", "Nb_C", "Nb_D", "Nb_E", "Nb_F", "%Nb>BC", "%Nb>BC_mean",
];

/** Header of the consolidated sheet the R pipeline reads. */
export const CONSOLIDATED_HEADER = [
  "Cultivar_code", "Accession", "Accession number", "Origin", "Sampling_number", "Date Sampling", "Date Sampling_JD",
  "Days_Nb", "CP", "REP", "Total N buds", "%Nb_AorB", "%Nb_B-C*", "%Nb_C", "%Nb_D", "%Nb_E", "%Nb_F", "%Nb>BC",
];

function numOrNull(v: number | null | undefined): number | null {
  return v === null || v === undefined || !Number.isFinite(v) ? null : v;
}

/** Cultivar codes are numbers in the sheets; keep them numeric when they parse as such. */
function codeCell(code: string | undefined): OutCell {
  if (!code) return null;
  return /^\d+$/.test(code) ? Number(code) : code;
}

interface TubeRow {
  tube: ObservationUnit;
  tree: ObservationUnit;
  sampling: Sampling;
  reading: TubeReading | undefined;
}

function tubeRows(ds: ForcingDataset): TubeRow[] {
  const treeById = new Map(ds.trees.map((t) => [t.id, t]));
  const samplingById = new Map(ds.samplings.map((s) => [s.id, s]));
  const samplingByNumber = new Map(ds.samplings.map((s) => [s.number, s]));
  const readings = latestReadings(ds.observations);
  const rows: TubeRow[] = [];
  for (const tube of ds.tubes) {
    const tree = tube.parentId ? treeById.get(tube.parentId) : undefined;
    if (!tree) continue;
    const sn = tube.attributes?.["samplingNumber"];
    const sampling = typeof sn === "number" ? samplingByNumber.get(sn) : undefined;
    const s2 = sampling ?? (typeof tube.attributes?.["samplingId"] === "string" ? samplingById.get(tube.attributes["samplingId"] as string) : undefined);
    if (!s2) continue;
    rows.push({ tube, tree, sampling: s2, reading: readings.get(tube.id) });
  }
  const order = (r: TubeRow) => [r.sampling.number, Number(r.tree.cultivarCode) || 0, r.tree.name, r.tube.rep ?? 0, r.tube.name] as const;
  rows.sort((a, b) => {
    const oa = order(a);
    const ob = order(b);
    for (let i = 0; i < oa.length; i++) {
      const x = oa[i]!;
      const y = ob[i]!;
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  });
  return rows;
}

function meanFractionByTreeSampling(rows: TubeRow[]): Map<string, number | null> {
  const acc = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${r.tree.id}:${r.sampling.number}`;
    const f = r.reading?.fraction;
    if (f === null || f === undefined) continue;
    const list = acc.get(key) ?? [];
    list.push(f);
    acc.set(key, list);
  }
  const out = new Map<string, number | null>();
  for (const [k, v] of acc) out.set(k, v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  return out;
}

/** Rows of one per-sampling sheet (header included). */
export function samplingSheet(ds: ForcingDataset, sampling: Sampling): OutSheet {
  const all = tubeRows(ds);
  const rows = all.filter((r) => r.sampling.id === sampling.id);
  const means = meanFractionByTreeSampling(rows);
  const out: OutCell[][] = [SAMPLING_SHEET_HEADER];
  for (const r of rows) {
    const c = r.reading?.counts ?? null;
    const total = c ? totalBuds(c) : null;
    const released = c ? releasedBuds(c) : null;
    const f = r.reading?.fraction ?? null;
    const frac = (k: keyof BudCounts): OutCell => (c && total ? { percent: c[k] / total } : k === "AorB" && f !== null ? { percent: 1 - f } : null);
    const cut = r.tube.cutDate || sampling.cutDate || null;
    const read = r.tube.readDate || sampling.readDate || (r.reading?.observedAt ? r.reading.observedAt.slice(0, 10) : null);
    out.push([
      r.tube.name,
      sampling.number,
      cut ? { date: cut } : null,
      cut ? dayOfYear(cut) : null,
      read ? { date: read } : null,
      cut && read ? daysBetween(cut, read) : null,
      numOrNull(r.tube.chillPortions ?? sampling.chillPortions),
      (r.tube.attributes?.["replicate"] as string | undefined) ?? (r.tube.rep ? String.fromCharCode(64 + r.tube.rep) : null),
      codeCell(r.tree.cultivarCode),
      r.tree.accession ?? null,
      r.tree.accessionNumber ?? null,
      r.tree.origin ?? null,
      r.tree.earlyGroup ? "Early" : null,
      (r.tree.attributes?.["gwasId"] as string | number | undefined) ?? null,
      r.tree.origin ?? null,
      total,
      c ? c.AorB : null,
      c ? c.BC : null,
      c ? c.C : null,
      c ? c.D : null,
      c ? c.E : null,
      c ? c.F : null,
      released,
      r.reading?.note ?? null,
      frac("AorB"),
      frac("BC"),
      frac("C"),
      frac("D"),
      frac("E"),
      frac("F"),
      f === null ? null : { percent: f },
      (() => {
        const m = means.get(`${r.tree.id}:${sampling.number}`);
        return m === null || m === undefined ? null : { percent: m };
      })(),
    ]);
  }
  return { name: `${sampling.number}_Sampling`, rows: out, freezeRows: 1, widths: { 0: 12, 9: 22, 10: 12, 23: 24 } };
}

/** The consolidated sheet: one row per tube and sampling, fractions per stage and `%Nb>BC`. */
export function consolidatedSheet(ds: ForcingDataset, name = "Consolidado"): OutSheet {
  const rows = tubeRows(ds);
  const out: OutCell[][] = [CONSOLIDATED_HEADER];
  for (const r of rows) {
    const c = r.reading?.counts ?? null;
    const total = c ? totalBuds(c) : null;
    const f = r.reading?.fraction ?? null;
    const cut = r.tube.cutDate || r.sampling.cutDate || null;
    const read = r.tube.readDate || r.sampling.readDate || null;
    const frac = (k: keyof BudCounts): OutCell => (c && total ? { percent: c[k] / total } : k === "AorB" && f !== null ? { percent: 1 - f } : f !== null ? { percent: 0 } : null);
    out.push([
      codeCell(r.tree.cultivarCode),
      r.tree.accession ?? null,
      r.tree.accessionNumber ?? null,
      r.tree.origin ?? null,
      r.sampling.number,
      cut ? { date: cut } : null,
      cut ? dayOfYear(cut) : null,
      cut && read ? daysBetween(cut, read) : null,
      numOrNull(r.tube.chillPortions ?? r.sampling.chillPortions),
      (r.tube.attributes?.["replicate"] as string | undefined) ?? null,
      total,
      ...BUD_STAGE_KEYS.map((k) => frac(k)),
      f === null ? null : { percent: f },
    ]);
  }
  return { name, rows: out, freezeRows: 1, widths: { 1: 22 } };
}

/** Long table: one row per observation, what R wants. */
export function longSheet(ds: ForcingDataset): OutSheet {
  const tubeById = new Map(ds.tubes.map((t) => [t.id, t]));
  const treeById = new Map(ds.trees.map((t) => [t.id, t]));
  const samplingById = new Map(ds.samplings.map((s) => [s.id, s]));
  const out: OutCell[][] = [[
    "observation_id", "unit_level", "unit_name", "tree", "accession", "sampling_number", "replicate", "variable", "key", "value",
    "timestamp", "collector", "device", "supersedes", "data_flag", "note",
  ]];
  for (const o of ds.observations) {
    const tube = tubeById.get(o.unitId);
    const tree = tube?.parentId ? treeById.get(tube.parentId) : treeById.get(o.unitId);
    const sampling = o.samplingId ? samplingById.get(o.samplingId) : undefined;
    const base: OutCell[] = [
      o.id,
      tube ? "tube" : "tree",
      tube?.name ?? tree?.name ?? o.unitId,
      codeCell(tree?.cultivarCode),
      tree?.accession ?? null,
      sampling?.number ?? null,
      (tube?.attributes?.["replicate"] as string | undefined) ?? null,
      o.variableId,
    ];
    const tail: OutCell[] = [o.observationTimeStamp, o.collector ?? null, o.deviceId, o.supersedes ?? null, o.dataFlag ?? 0, o.note ?? null];
    if (o.value && typeof o.value === "object") {
      for (const [k, v] of Object.entries(o.value)) out.push([...base, k, v, ...tail]);
    } else {
      out.push([...base, null, o.value as OutCell, ...tail]);
    }
  }
  return { name: "Registro_largo", rows: out, freezeRows: 1 };
}

const STAGES_SHEET: OutSheet = {
  name: "Stages",
  rows: [
    ["Estado", "Descripción"],
    ["A", "Yema no hinchada"],
    ["B", "Hinchada"],
    ["B-C", "Punta de sépalos visible (verde)"],
    ["C", "Sépalos visibles"],
    ["D", "Pétalos visibles"],
    ["E", "Estambres visibles"],
    ["F", "Flor abierta"],
    ["%Nb>BC", "Fracción de yemas en B-C o superior; el árbol sale del letargo al 50 %"],
  ],
};

/** The whole workbook: stages legend, one sheet per sampling, consolidated, long table. */
export function exportForcingWorkbook(ds: ForcingDataset, opts: { consolidatedName?: string } = {}): Uint8Array {
  const samplings = [...ds.samplings].sort((a, b) => a.number - b.number);
  const sheets: OutSheet[] = [STAGES_SHEET, ...samplings.map((s) => samplingSheet(ds, s)), consolidatedSheet(ds, opts.consolidatedName ?? "Consolidado"), longSheet(ds)];
  return writeWorkbook(sheets);
}

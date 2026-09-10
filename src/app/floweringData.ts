/**
 * Views over the project state for the plot screen and the flowering export: the
 * label of an observation as the group writes it, the latest label per tree and day,
 * the dataset the flowering exporter wants for one season, and the long CSV.
 *
 * A season is the calendar year of the visit dates: flowering runs from February to
 * April, so a year never straddles two seasons. Undone observations (a null value
 * that supersedes the undone one) are invisible everywhere here.
 */
import type { ProjectState } from "@core/events";
import type { FloweringDataset, ReportedDatesByTree } from "@core/exporters/floweringWorkbook";
import type { FieldEvent, VisitColumn } from "@core/importers/mosaicFlowering";
import type { PlotLayout } from "@core/layout";
import { formatStageLabel, parseStageLabel, type ParsedStage } from "@core/phenology";
import type { FieldVisit, Observation, ObservationUnit } from "@core/types";

export const STAGE_VARIABLE = "flowerStageLabel";
/** A word written in a visit cell instead of a stage ("Tratam", "Poda", "NO"). */
export const NOTE_VARIABLE = "fieldNote";
/** Dates the group types by hand on the sheet, one variable per threshold. */
export const TYPED_DATE_KEYS = ["F10", "F50", "F80", "C10", "C90"] as const;
export type TypedDateKey = (typeof TYPED_DATE_KEYS)[number];
export const typedDateVariable = (key: TypedDateKey): string => `reported${key}`;
export const DESCRIPTOR_KEYS = ["flowerBudDensity", "flowerType", "petalsPerFlower"] as const;
export type DescriptorKey = (typeof DESCRIPTOR_KEYS)[number];

export function seasonOf(date: string): number {
  return Number(date.slice(0, 4));
}

export function dateOf(o: Observation): string {
  return o.observationTimeStamp.slice(0, 10);
}

/** Pre-bloom letters kept in the note of a stage observation ("pre:DE"). */
export function preOf(o: Observation): string {
  return /(?:^|;)pre:([^;]*)/.exec(o.note ?? "")?.[1] ?? "";
}

/** The label as written in the field: the raw text when imported, else rebuilt from the value. */
export function stageLabelOf(o: Observation): string {
  const raw = /(?:^|;)raw:([^;]*)/.exec(o.note ?? "")?.[1];
  if (raw !== undefined) return raw;
  if (typeof o.value === "string") return o.value;
  if (o.value && typeof o.value === "object") {
    const v = o.value as Record<string, number>;
    return formatStageLabel({ pre: preOf(o), open: v["open"] ?? 0, fall: v["fall"] ?? 0 });
  }
  return "";
}

/** Parsed stage of an observation, from its value or, failing that, its raw label. */
export function stageOf(o: Observation): ParsedStage | null {
  if (o.value && typeof o.value === "object") {
    const v = o.value as Record<string, number>;
    return { pre: preOf(o), open: v["open"] ?? 0, fall: v["fall"] ?? 0, raw: stageLabelOf(o) };
  }
  return parseStageLabel(stageLabelOf(o));
}

/** Observations still standing: not superseded by a later one and not an undo. */
export function liveObservations(state: ProjectState): Observation[] {
  const superseded = new Set<string>();
  for (const o of state.observations.values()) if (o.supersedes) superseded.add(o.supersedes);
  return [...state.observations.values()].filter((o) => !superseded.has(o.id) && o.value !== null);
}

function later(a: Observation, b: Observation): boolean {
  return a.observationTimeStamp > b.observationTimeStamp || (a.observationTimeStamp === b.observationTimeStamp && a.id > b.id);
}

/** Latest stage observation of every tree on every day. */
export function stagesByTreeAndDate(state: ProjectState): Map<string, Map<string, Observation>> {
  const out = new Map<string, Map<string, Observation>>();
  for (const o of liveObservations(state)) {
    if (o.variableId !== STAGE_VARIABLE) continue;
    let byDate = out.get(o.unitId);
    if (!byDate) {
      byDate = new Map();
      out.set(o.unitId, byDate);
    }
    const cur = byDate.get(dateOf(o));
    if (!cur || later(o, cur)) byDate.set(dateOf(o), o);
  }
  return out;
}

/** Latest value of a variable per tree (descriptors, status, typed dates). */
export function latestByTree(state: ProjectState, variableId: string): Map<string, Observation> {
  const out = new Map<string, Observation>();
  for (const o of liveObservations(state)) {
    if (o.variableId !== variableId) continue;
    const cur = out.get(o.unitId);
    if (!cur || later(o, cur)) out.set(o.unitId, o);
  }
  return out;
}

/** Seasons with any visit or stage observation, newest first. */
export function seasonsAvailable(state: ProjectState): number[] {
  const years = new Set<number>();
  for (const v of state.visits.values()) years.add(seasonOf(v.date));
  for (const o of state.observations.values()) if (o.variableId === STAGE_VARIABLE && o.value !== null) years.add(seasonOf(dateOf(o)));
  return [...years].sort((a, b) => b - a);
}

export function layoutOfPlot(state: ProjectState, plot: string): PlotLayout | undefined {
  for (const l of state.layouts.values()) {
    const layout = l.layout as PlotLayout;
    if (layout.plot === plot) return layout;
  }
  return undefined;
}

/** Row order as drawn on the map when there is one, else numbers ascending, else letters. */
function rowRank(layout: PlotLayout | undefined, tree: ObservationUnit): number {
  const label = tree.rowLabel ?? (tree.row !== undefined ? String(tree.row) : "");
  if (layout) {
    const i = layout.rows.findIndex((r) => r.name.trim().toLowerCase() === label.trim().toLowerCase());
    if (i >= 0) return i;
  }
  const n = Number(label);
  if (Number.isFinite(n) && label !== "") return 1000 + n;
  return label ? 2000 + label.toUpperCase().charCodeAt(0) : 9999;
}

/** Field order: plot, row as drawn, position; trees without a position close their plot. */
export function fieldOrder(state: ProjectState, trees: ObservationUnit[]): ObservationUnit[] {
  const layoutByPlot = new Map<string, PlotLayout | undefined>();
  const rank = (t: ObservationUnit) => {
    const plot = t.plot ?? "";
    if (!layoutByPlot.has(plot)) layoutByPlot.set(plot, layoutOfPlot(state, plot));
    return [plot, rowRank(layoutByPlot.get(plot), t), t.position ?? Number.MAX_SAFE_INTEGER, Number(t.cultivarCode) || Number.MAX_SAFE_INTEGER, t.name] as const;
  };
  return [...trees].sort((a, b) => {
    const ka = rank(a);
    const kb = rank(b);
    for (let i = 0; i < ka.length; i++) {
      const x = ka[i]!;
      const y = kb[i]!;
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  });
}

/**
 * Positions that can be phenotyped: trees and guards, not fillers or empty holes,
 * unless a flowering list put a tree on a position the map left undrawn.
 */
export function isPhenotypable(tree: ObservationUnit): boolean {
  const kind = tree.attributes?.["layoutKind"];
  const listed = tree.attributes?.["sheet"] !== undefined;
  return tree.level === "tree" && ((kind !== "empty" && kind !== "filler") || listed);
}

/**
 * Rows of a season sheet: trees phenotyped that season and the trees a flowering list
 * carried (the group's own roster, guards under their block code included). When no
 * list was ever loaded, every tree with a MOSAIC code is a row.
 */
function onSheet(tree: ObservationUnit, staged: Set<string>, anyListed: boolean): boolean {
  if (staged.has(tree.id)) return true;
  if (!tree.cultivarCode) return false;
  return anyListed ? tree.attributes?.["sheet"] !== undefined : true;
}

/** Live tree units, in field order. */
export function fieldTrees(state: ProjectState, plots?: string[]): ObservationUnit[] {
  const wanted = plots && plots.length ? new Set(plots) : null;
  const trees = [...state.units.values()].filter((u) => u.level === "tree" && !state.retiredUnits.has(u.id) && (!wanted || wanted.has(u.plot ?? "")));
  return fieldOrder(state, trees);
}

function visitCovers(v: FieldVisit, plots: Set<string> | null): boolean {
  if (!plots || !v.plots || v.plots.length === 0) return true;
  return v.plots.some((p) => plots.has(p));
}

const MONTHS_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const EVENT_WORD: Record<string, string> = { flight: "DRON", pruning: "PODA", treatment: "TRATAM", irrigation: "RIEGO", frost: "HELADA", other: "EVENTO" };

/** Default column label of a visit that has none: the date for a visit, the group's words for events. */
export function visitLabel(v: FieldVisit): string {
  if (v.label) return v.label;
  if (v.kind === "visit") return v.date;
  const [, m, d] = v.date.split("-").map(Number) as [number, number, number];
  return `${EVENT_WORD[v.kind] ?? "EVENTO"} ${d} ${MONTHS_ES[m - 1] ?? ""}`;
}

/**
 * Attributes as the sheet of one season wants them: the "not phenotyped" grey belongs
 * to the season it was imported from, and a tree the app marked dead or missing gets
 * the dark grey of the dead rows.
 */
function sheetAttributes(tree: ObservationUnit, season: number): ObservationUnit {
  const a = { ...(tree.attributes ?? {}) };
  if (a["notPhenotyped"] === true && a["notPhenotypedSeason"] !== undefined && a["notPhenotypedSeason"] !== season) {
    delete a["notPhenotyped"];
    delete a["rowFill"];
    delete a["positionFill"];
  }
  if (a["status"] === "dead" || a["status"] === "missing") a["listStatus"] = "dead";
  return { ...tree, attributes: a };
}

/**
 * The dataset of one season for the flowering exporter: trees of the plots asked for,
 * their stage observations of that year, the visit and flight columns, the events
 * between them, the dates typed by hand when the season has them (else the exporter
 * derives them from the visits) and the event words written per tree.
 */
export function floweringDatasetFromState(state: ProjectState, season: number, plots?: string[]): FloweringDataset {
  const wanted = plots && plots.length ? new Set(plots) : null;
  const stagedThisSeason = new Set(liveObservations(state).filter((o) => o.variableId === STAGE_VARIABLE && seasonOf(dateOf(o)) === season).map((o) => o.unitId));
  const all = fieldTrees(state, plots);
  const anyListed = all.some((t) => t.attributes?.["sheet"] !== undefined);
  const trees = all.filter((t) => isPhenotypable(t) && onSheet(t, stagedThisSeason, anyListed)).map((t) => sheetAttributes(t, season));
  const treeIds = new Set(trees.map((t) => t.id));
  const nameOf = new Map(trees.map((t) => [t.id, t.name]));
  const live = liveObservations(state).filter((o) => treeIds.has(o.unitId) && seasonOf(dateOf(o)) === season);
  const observations = live.filter((o) => o.variableId === STAGE_VARIABLE);

  const visits: VisitColumn[] = [];
  const events: FieldEvent[] = [];
  const seenDates = new Set<string>();
  for (const v of [...state.visits.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    if (seasonOf(v.date) !== season || !visitCovers(v, wanted)) continue;
    const sheet = v.plots?.join(",") || "app";
    if (v.kind === "visit" || v.kind === "flight") {
      if (seenDates.has(v.date)) continue;
      seenDates.add(v.date);
      const col: VisitColumn = { sheet, date: v.date };
      if (v.kind === "flight") col.flight = visitLabel(v);
      if (v.temperature) col.temperature = v.temperature;
      visits.push(col);
    } else {
      events.push({ sheet, label: visitLabel(v), date: v.date, flight: false });
    }
  }
  // a day with labels but no visit record still needs its column
  for (const o of observations) {
    const d = dateOf(o);
    if (!seenDates.has(d)) {
      seenDates.add(d);
      visits.push({ sheet: "app", date: d });
    }
  }
  visits.sort((a, b) => a.date.localeCompare(b.date));

  const reported = new Map<string, ReportedDatesByTree>();
  for (const key of TYPED_DATE_KEYS) {
    for (const [treeId, o] of latestByTree(state, typedDateVariable(key))) {
      if (!treeIds.has(treeId) || typeof o.value !== "string" || seasonOf(o.value) !== season) continue;
      const cur = reported.get(treeId) ?? {};
      cur[key] = o.value;
      reported.set(treeId, cur);
    }
  }
  const treeEvents = live
    .filter((o) => o.variableId === NOTE_VARIABLE && typeof o.value === "string")
    .map((o) => ({ tree: nameOf.get(o.unitId) ?? "", date: dateOf(o), label: String(o.value) }));

  const ds: FloweringDataset = { trees, observations, visits, events, treeEvents };
  if (reported.size) ds.reported = reported;
  return ds;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Variables tied to a day in the field; the season filter of the CSV applies to these only. */
const SEASONAL_VARIABLES = new Set<string>([STAGE_VARIABLE, NOTE_VARIABLE, "treeStatus", ...TYPED_DATE_KEYS.map(typedDateVariable)]);

/**
 * Long table, one observation per line, for R: every live observation on a tree
 * (stages as the group writes them, descriptors, status, notes), with the identity
 * and the current UPOV descriptors of the tree repeated on each line. A season keeps
 * the dated variables of that year and every descriptor, whenever it was scored.
 */
export function longCsv(state: ProjectState, season?: number, plots?: string[]): string {
  const trees = fieldTrees(state, plots);
  const byId = new Map(trees.map((t) => [t.id, t]));
  const header = ["plot", "row", "position", "tree", "cultivar_code", "accession", "accession_number", "bud_density", "flower_type", "petals", "date", "timestamp", "variable", "value", "label", "data_flag", "note", "device", "collector"];
  const lines = [header.join(",")];
  const rows = liveObservations(state)
    .filter((o) => byId.has(o.unitId) && (season === undefined || !SEASONAL_VARIABLES.has(o.variableId) || seasonOf(dateOf(o)) === season))
    .sort((a, b) => a.observationTimeStamp.localeCompare(b.observationTimeStamp) || a.id.localeCompare(b.id));
  for (const o of rows) {
    const t = byId.get(o.unitId)!;
    const a = t.attributes ?? {};
    const label = o.variableId === STAGE_VARIABLE ? stageLabelOf(o) : "";
    const value = o.variableId === STAGE_VARIABLE && o.value && typeof o.value === "object" ? label : o.value;
    lines.push(
      [t.plot, t.rowLabel ?? t.row, t.position, t.name, t.cultivarCode, t.accession, t.accessionNumber, a["flowerBudDensity"], a["flowerType"], a["petalsPerFlower"], dateOf(o), o.observationTimeStamp, o.variableId, value, label, o.dataFlag ?? 0, o.note, o.deviceId, o.collector]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

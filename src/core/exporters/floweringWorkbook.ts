/**
 * Export of field phenology in the two layouts the group already uses:
 *
 *  - the sheet by drone flight (`DRON_floracion_melocotonero_2026.xlsx`): one row per
 *    tree, identity, the three UPOV descriptors, the reported dates F10 to C90 with
 *    their intervals in days, and one column per flight holding the stage that day,
 *    written in red when it was estimated rather than observed;
 *  - the sheet by visit (`Peach_2026_Listado floración.xlsx`): the same identity and
 *    dates, then one column per visit date, with the event columns (PODA, DRON)
 *    interleaved by date.
 *
 * Column names, order, colours and the legend are copied from the 2026 files so the
 * output opens as "the Excel of always" and feeds the R pipelines unchanged.
 */
import { daysBetween, deriveDatesFromLabels } from "../phenology";
import type { Observation, ObservationUnit } from "../types";
import { writeWorkbook, type OutCell, type OutSheet, type StyledCell } from "../xlsx/writer";
import type { FieldEvent, VisitColumn } from "../importers/mosaicFlowering";

export interface ReportedDatesByTree {
  F10?: string | null;
  F50?: string | null;
  F80?: string | null;
  C10?: string | null;
  C90?: string | null;
}

export interface FloweringDataset {
  /** Trees in the order the sheet should list them. */
  trees: ObservationUnit[];
  /** Stage observations (`flowerStageLabel`), any order. */
  observations: Observation[];
  /** Visit columns to write, in date order; flights carry their label and the day's temperatures. */
  visits: VisitColumn[];
  /** Field events that are not flights (pruning, treatments), placed by date between visits. */
  events?: FieldEvent[];
  /** Dates typed by the group per tree id; when absent for a tree they are derived from its visits. */
  reported?: Map<string, ReportedDatesByTree>;
  /** Event words per tree and visit ("Tratam"), written in the visit cell. */
  treeEvents?: { tree: string; date: string; label: string }[];
}

export const FLIGHT_LEGEND = "* En color negro los datos fenotipados en ese dia, y en rojo los estimados";
const TEMPERATURE_HEADER = "Tªmax-Tª min";
const RED = "FFFF0000";
const DARK_GREY = "FFA6A6A6";
const GREY = "FFD9D9D9";
const HEADER_FILL_IDENTITY = "FFA3FFA3";
const HEADER_FILL_DESCRIPTOR = "FFCFE2F3";
const HEADER_FILL_DATE = "FFFFCCFF";
const HEADER_FILL_INTERVAL = "FFEAD1DC";
const HEADER_FILL_FLIGHT = "FFFFFF00";

const DESCRIPTOR_HEADERS: [string, string][] = [
  ["Density of flower buds 1,3,5,7,o,9", "flowerBudDensity"],
  ["Flower type C/R", "flowerType"],
  ["Petals_flower 5, >5", "petalsPerFlower"],
];

function num(v: string | number | boolean | null | undefined): OutCell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v;
  return /^\d+$/.test(v.trim()) ? Number(v) : v;
}

function attr(tree: ObservationUnit, key: string): string | number | boolean | null | undefined {
  return tree.attributes?.[key];
}

function styled(v: OutCell, style: Omit<StyledCell, "v">): OutCell {
  const plain = typeof v === "object" && v !== null && "v" in v ? v.v : v;
  return Object.keys(style).length ? { v: plain, ...style } : plain;
}

/** Raw label of an observation as written in the field, or its value when it was typed. */
function rawLabel(o: Observation): string {
  const m = /(?:^|;)raw:([^;]*)/.exec(o.note ?? "");
  if (m) return m[1]!;
  return typeof o.value === "string" ? o.value : "";
}

interface Cell {
  label: string;
  estimated: boolean;
}

/** For every tree, the label written at each visit date (latest observation of that day). */
function labelsByTreeAndDate(observations: Observation[]): Map<string, Map<string, Cell>> {
  const superseded = new Set(observations.map((o) => o.supersedes).filter((s): s is string => Boolean(s)));
  const out = new Map<string, Map<string, Cell>>();
  const seen = new Map<string, Observation>();
  for (const o of observations) {
    if (o.variableId !== "flowerStageLabel" || superseded.has(o.id) || o.value === null) continue;
    const date = o.observationTimeStamp.slice(0, 10);
    const key = `${o.unitId}|${date}`;
    const cur = seen.get(key);
    if (cur && (cur.observationTimeStamp > o.observationTimeStamp || (cur.observationTimeStamp === o.observationTimeStamp && cur.id > o.id))) continue;
    seen.set(key, o);
    let byDate = out.get(o.unitId);
    if (!byDate) {
      byDate = new Map();
      out.set(o.unitId, byDate);
    }
    byDate.set(date, { label: rawLabel(o), estimated: o.dataFlag === 3 });
  }
  return out;
}

/**
 * Dates to write for a tree: the ones the group typed when the dataset carries them
 * (a tree without typed dates stays empty, as in the source), else derived from the
 * visits, which is how the app produces them for a new season.
 */
function reportedFor(tree: ObservationUnit, ds: FloweringDataset, labels: Map<string, Cell>): ReportedDatesByTree {
  if (ds.reported) return ds.reported.get(tree.id) ?? {};
  const visits = [...labels.entries()].map(([date, c]) => ({ date, label: c.label }));
  return deriveDatesFromLabels(visits).dates;
}

function dateCell(d: string | null | undefined): OutCell {
  return d ? { date: d } : null;
}

function interval(a: string | null | undefined, b: string | null | undefined): OutCell {
  return a && b ? daysBetween(a, b) : null;
}

/** The sheet by drone flight, in the layout of `DRON_floracion_melocotonero_2026.xlsx`. */
export function buildFlightSheet(ds: FloweringDataset, sheetName = "MOSAIC_Ppersica_25 26"): OutSheet {
  const flights = ds.visits.filter((v) => v.flight);
  const labels = labelsByTreeAndDate(ds.observations);
  const identity = ["Cultivar_code", "Accession", "Accession number", "ID GWAS Mas-Gomez", "Origin", "Parcela", "Fila", "Arbol"];
  const dates = ["F10_date", "F50_date", "F80_date", "C10_date", "C90_date"];
  const intervals = ["F10_F80_dias", "F10_C10_dias", "F10_C90_dias"];
  const header: OutCell[] = [
    ...identity.map((h, i) => (i === 0 ? h : styled(h, { fillRgb: HEADER_FILL_IDENTITY }))),
    ...DESCRIPTOR_HEADERS.map(([h]) => styled(h, { fillRgb: HEADER_FILL_DESCRIPTOR })),
    ...dates.map((h) => (["F10_date", "F50_date", "C90_date"].includes(h) ? styled(h, { fillRgb: HEADER_FILL_DATE }) : h)),
    ...intervals.map((h) => (h === "F10_C90_dias" ? styled(h, { fillRgb: HEADER_FILL_INTERVAL }) : h)),
    ...flights.map((f) => styled(f.flight!, { fillRgb: HEADER_FILL_FLIGHT })),
  ];
  const firstFlight = identity.length + DESCRIPTOR_HEADERS.length + dates.length + intervals.length;
  const top: OutCell[] = [FLIGHT_LEGEND];
  while (top.length < firstFlight - 1) top.push(null);
  top.push(styled(TEMPERATURE_HEADER, { fillRgb: "FF00FFFF" }));
  for (const f of flights) top.push(f.temperature ?? null);

  const rows: OutCell[][] = [top, header];
  for (const tree of ds.trees) {
    const byDate = labels.get(tree.id) ?? new Map<string, Cell>();
    const rep = reportedFor(tree, ds, byDate);
    const dead = attr(tree, "listStatus") === "dead";
    const notPhenotyped = attr(tree, "notPhenotyped") === true;
    const rowFill = typeof attr(tree, "rowFill") === "string" ? String(attr(tree, "rowFill")) : GREY;
    const positionFill = typeof attr(tree, "positionFill") === "string" ? String(attr(tree, "positionFill")) : undefined;
    const accFill = typeof attr(tree, "accessionFill") === "string" ? String(attr(tree, "accessionFill")) : undefined;
    const identityCells: OutCell[] = [
      num(tree.cultivarCode ?? null),
      tree.accession ?? null,
      num(tree.accessionNumber ?? null),
      num(attr(tree, "gwasId")),
      tree.origin ?? null,
      tree.plot ?? null,
      tree.rowLabel !== undefined ? num(tree.rowLabel) : tree.row ?? null,
      tree.position ?? null,
    ];
    const row: OutCell[] = identityCells.map((v, i) => {
      const style: Omit<StyledCell, "v"> = {};
      if (dead && i <= 4) style.fillRgb = DARK_GREY;
      if (i === 1 && accFill) style.fillRgb = accFill;
      if (notPhenotyped && i === 7 && positionFill) style.fillRgb = positionFill;
      return styled(v, style);
    });
    const greyStyle: Omit<StyledCell, "v"> = notPhenotyped ? { fillRgb: rowFill } : {};
    for (const [, key] of DESCRIPTOR_HEADERS) row.push(styled(num(attr(tree, key)), greyStyle));
    row.push(styled(dateCell(rep.F10), greyStyle), styled(dateCell(rep.F50), greyStyle), styled(dateCell(rep.F80), greyStyle), styled(dateCell(rep.C10), greyStyle), styled(dateCell(rep.C90), greyStyle));
    row.push(styled(interval(rep.F10, rep.F80), greyStyle), styled(interval(rep.F10, rep.C10), greyStyle), styled(interval(rep.F10, rep.C90), greyStyle));
    for (const f of flights) {
      const cell = byDate.get(f.date);
      const style: Omit<StyledCell, "v"> = { ...greyStyle };
      if (cell?.estimated) style.fontRgb = RED;
      row.push(styled(cell?.label ?? null, style));
    }
    rows.push(row);
  }
  return { name: sheetName, rows, freezeRows: 0 };
}

/**
 * The sheet by visit, in the layout of the flowering lists: identity, replicate,
 * reported dates and intervals, then a column per visit date with the events of the
 * season interleaved where they fall.
 */
export function buildVisitSheet(ds: FloweringDataset, sheetName: string): OutSheet {
  const labels = labelsByTreeAndDate(ds.observations);
  type Column = { kind: "visit"; visit: VisitColumn } | { kind: "event"; event: FieldEvent };
  const columns: Column[] = ds.visits.filter((v) => !v.flight).map((visit) => ({ kind: "visit", visit }));
  for (const e of ds.events ?? []) if (e.date) columns.push({ kind: "event", event: e });
  for (const v of ds.visits) if (v.flight) columns.push({ kind: "event", event: { sheet: v.sheet, label: v.flight, date: v.date, flight: true } });
  columns.sort((a, b) => {
    const da = a.kind === "visit" ? a.visit.date : a.event.date ?? "";
    const db = b.kind === "visit" ? b.visit.date : b.event.date ?? "";
    return da === db ? (a.kind === "event" ? -1 : 1) : da.localeCompare(db);
  });
  const identity = ["Cultivar_code", "Accession", "Accession number", "ID GWAS Mas-Gomez", "Origin", "Parcela", "Fila", "Arbol", null, "Rep_Tree"];
  const dates = ["Fecha_F10", "Fecha_F50", "Fecha_F80", "Fecha_C10", "Fecha_C90", "F10_C10_dias", "F10_C90_dias"];
  const header: OutCell[] = [...identity, ...dates, ...columns.map((c) => (c.kind === "visit" ? { date: c.visit.date } : c.event.label))];
  const top: OutCell[] = [FLIGHT_LEGEND];
  while (top.length < identity.length + dates.length - 1) top.push(null);
  top.push(TEMPERATURE_HEADER);
  for (const c of columns) top.push(c.kind === "visit" ? c.visit.temperature ?? null : ds.visits.find((v) => v.flight === c.event.label)?.temperature ?? null);
  const treeEvents = new Map<string, string>();
  for (const e of ds.treeEvents ?? []) treeEvents.set(`${e.tree}|${e.date}`, e.label);

  const rows: OutCell[][] = [top, header];
  for (const tree of ds.trees) {
    const byDate = labels.get(tree.id) ?? new Map<string, Cell>();
    const rep = reportedFor(tree, ds, byDate);
    const row: OutCell[] = [
      num(tree.cultivarCode ?? null),
      tree.accession ?? null,
      num(tree.accessionNumber ?? null),
      num(attr(tree, "gwasId")),
      tree.origin ?? null,
      tree.plot ?? null,
      tree.rowLabel !== undefined ? num(tree.rowLabel) : tree.row ?? null,
      tree.position ?? null,
      tree.earlyGroup ? "Early" : null,
      tree.rep ?? null,
      dateCell(rep.F10),
      dateCell(rep.F50),
      dateCell(rep.F80),
      dateCell(rep.C10),
      dateCell(rep.C90),
      interval(rep.F10, rep.C10),
      interval(rep.F10, rep.C90),
    ];
    for (const c of columns) {
      const date = c.kind === "visit" ? c.visit.date : c.event.date ?? "";
      const cell = byDate.get(date);
      const word = treeEvents.get(`${tree.name}|${date}`);
      const style: Omit<StyledCell, "v"> = cell?.estimated ? { fontRgb: RED } : {};
      row.push(styled(cell?.label ?? word ?? null, style));
    }
    rows.push(row);
  }
  return { name: sheetName, rows, freezeRows: 0 };
}

/** Workbook with the flight sheet (and optionally one visit sheet per plot). */
export function writeFloweringWorkbook(ds: FloweringDataset, opts: { flightSheet?: boolean; visitSheetsByPlot?: boolean } = {}): Uint8Array {
  const sheets: OutSheet[] = [];
  if (opts.flightSheet !== false) sheets.push(buildFlightSheet(ds));
  if (opts.visitSheetsByPlot) {
    const plots = [...new Set(ds.trees.map((t) => t.plot ?? "sin parcela"))];
    for (const plot of plots) {
      const trees = ds.trees.filter((t) => (t.plot ?? "sin parcela") === plot);
      sheets.push(buildVisitSheet({ ...ds, trees }, plot));
    }
  }
  return writeWorkbook(sheets);
}

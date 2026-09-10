/**
 * Importer for the flowering sheets of MOSAIC: the lists by visit
 * (`Peach_2026_Listado floración.xlsx`, one sheet per plot, one column per visit date
 * with the stage label written in the field) and the compact list by drone flight
 * (`DRON_floracion_melocotonero_2026.xlsx`, one column per flight with the stage on
 * that day, estimated values in red). Both share the identity columns (Cultivar_code,
 * Accession, Parcela, Fila, Arbol, Rep_Tree), the typed summary dates (F10 to C90)
 * and the UPOV descriptors of the tree.
 *
 * Visit columns are recognised by a date header; `DRON 17 Feb` columns are visits on
 * the flight day and also field events; `PODA 24 feb` and the like are events only.
 * Red labels come back with `dataFlag` 3 (interpolated by the person, not observed);
 * greyed rows are trees that were not phenotyped; the dark grey rows are dead trees.
 *
 * Why it matters: the first visit at or above 10, 50 and 80 % open flowers is the
 * flowering-date phenotype of the GWAS, and the stage on each flight day is the ground
 * truth for the drone images. Neither can carry a typing error or a silent estimate.
 */
import { ulid, treeName } from "../ids";
import { positionName } from "../layout";
import { parseStageLabel } from "../phenology";
import type { Observation, ObservationUnit } from "../types";
import { cellText, findHeader, isRed, readWorkbook, styleAt, type CellValue, type Sheet } from "../xlsx/reader";

export interface FieldEvent {
  sheet: string;
  label: string;
  /** ISO date when it could be read from the label ("DRON 17 Feb" + season year). */
  date: string | null;
  /** True for drone flights, whose column also holds the stage of every tree that day. */
  flight: boolean;
}

/** A visit column of a sheet: the day, the flight label if it was one, and the temperatures written above it. */
export interface VisitColumn {
  sheet: string;
  date: string;
  flight?: string;
  /** "Tªmax-Tª min" of the day as written above the header ("16,1-6,1"). */
  temperature?: string;
}

export interface ReportedDates {
  treeId: string;
  F10: string | null;
  F50: string | null;
  F80: string | null;
  C10: string | null;
  C90: string | null;
}

export interface FloweringImport {
  trees: ObservationUnit[];
  observations: Observation[];
  reported: ReportedDates[];
  events: FieldEvent[];
  /** The visit columns of every sheet, in date order, with the day's temperatures. */
  visits: VisitColumn[];
  /** Labels that could not be parsed, with where they were. */
  unparsed: { sheet: string; tree: string; date: string; label: string }[];
  /** Visit cells holding an event word ("Tratam", "Poda") instead of a stage, per tree and day. */
  treeEvents: { sheet: string; tree: string; date: string; label: string }[];
  warnings: string[];
}

export interface FloweringImportOptions {
  /** Year of the season, used for flight labels when no dated column gives it away. */
  seasonYear?: number;
}

const IMPORT_DEVICE = "import:xlsx";
const MONTHS: Record<string, number> = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
const GREY_FILLS = new Set(["FFD9D9D9", "FFCCCCCC", "D9D9D9", "CCCCCC"]);
const DARK_GREY_FILLS = new Set(["FFA6A6A6", "A6A6A6"]);
/** Words written in a visit cell that record what happened that day, not a stage. */
const EVENT_LABEL = /^(tratam\w*|poda|riego|helada|no)$/i;

function at(row: CellValue[], i: number | undefined): CellValue {
  return i === undefined ? null : (row[i] ?? null);
}

function isoDate(v: CellValue): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

/** "DRON 17 Feb", " DRON4- 4 Mar" -> 2026-02-17 / 2026-03-04 given the season year. */
export function eventDate(label: string, year: number): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]{3})/.exec(label);
  if (!m || !year) return null;
  const month = MONTHS[m[2]!.toLowerCase()];
  if (!month) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
}

/**
 * Plot as written, undoing what Excel did to "1-4": typed in the CITA sheet, it became
 * the date 2026-04-01, so a date-looking plot is read back as `day.month`.
 */
export function plotName(v: CellValue, fallback: string): string {
  const t = cellText(v);
  if (!t) return fallback;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${Number(m[3])}.${Number(m[2])}`;
  return t;
}

function findColumn(c: Map<string, number>, ...names: (string | RegExp)[]): number | undefined {
  for (const n of names) {
    if (typeof n === "string") {
      const i = c.get(n);
      if (i !== undefined) return i;
    } else {
      const key = [...c.keys()].find((k) => n.test(k));
      if (key !== undefined) return c.get(key);
    }
  }
  return undefined;
}

export function importFloweringList(bytes: Uint8Array, opts: FloweringImportOptions = {}): FloweringImport {
  const wb = readWorkbook(bytes, { styles: true });
  const out: FloweringImport = { trees: [], observations: [], reported: [], events: [], visits: [], unparsed: [], treeEvents: [], warnings: [] };
  for (const sheet of wb.sheets) {
    const h = findHeader(sheet, { require: ["Cultivar_code"], any: ["Fecha_F50", "Date_F50", "F50_date", "Fecha_F10", "Date_F10", "F10_date"] });
    if (!h) continue;
    importSheet(sheet, h.rowIndex, h.columns, out, opts);
  }
  return out;
}

function importSheet(sheet: Sheet, headerRow: number, c: Map<string, number>, out: FloweringImport, opts: FloweringImportOptions): void {
  const header = sheet.rows[headerRow] ?? [];
  const iCode = c.get("Cultivar_code");
  const iAcc = c.get("Accession");
  const iAccNo = c.get("Accession number");
  const iGwas = c.get("ID GWAS Mas-Gomez");
  const iOrigin = c.get("Origin");
  const iSpecies = findColumn(c, "Specie", "Species", "Especie");
  const iPlot = c.get("Parcela");
  const iRow = c.get("Fila");
  const iPos = c.get("Arbol");
  const iRep = findColumn(c, "Rep_Tree", "Rep_Arbol", "Rep");
  const iEarly = iPos !== undefined && (header[iPos + 1] === null || header[iPos + 1] === undefined) ? iPos + 1 : undefined;
  const dateCols: Record<string, number | undefined> = {
    F10: findColumn(c, "Fecha_F10", "Date_F10", "F10_date"),
    F50: findColumn(c, "Fecha_F50", "Date_F50", "F50_date"),
    F80: findColumn(c, "Fecha_F80", "Date_F80", "F80_date"),
    C10: findColumn(c, "Fecha_C10", "Date_C10", "C10_date"),
    C90: findColumn(c, "Fecha_C90", "Date_C90", "C90_date"),
  };
  const descriptors: { key: string; index: number }[] = [];
  const addDescriptor = (key: string, ...names: (string | RegExp)[]) => {
    const i = findColumn(c, ...names);
    if (i !== undefined) descriptors.push({ key, index: i });
  };
  addDescriptor("flowerBudDensity", /^Density of flower buds/i);
  addDescriptor("flowerType", /^Flower type/i);
  addDescriptor("petalsPerFlower", /^Petals_flower/i);
  addDescriptor("vegetativeBud", /^Yema Veget/i);
  addDescriptor("trunkDiameter", /^Di[aá]metro tronco/i);
  addDescriptor("chillPortionsSeason", /^CP_\d{4}$/i);
  addDescriptor("clusterFaststructure", "Cluster Faststructure");
  addDescriptor("clusterDapc", "DAPC Cluster");
  addDescriptor("observation", "Observ");

  // Visit columns: header is a date. Flight columns ("DRON 17 Feb") are visits on the
  // flight day and events; the other event columns (PODA, TRAT...) are events only.
  const visits: { index: number; date: string; flight?: string }[] = [];
  let year = 0;
  header.forEach((v, i) => {
    const d = isoDate(v);
    if (d) {
      visits.push({ index: i, date: d });
      year = Number(d.slice(0, 4));
    }
  });
  if (!year) {
    for (let r = headerRow + 1; r < sheet.rows.length && !year; r++) {
      const row = sheet.rows[r] ?? [];
      for (const key of Object.keys(dateCols)) {
        const d = isoDate(at(row, dateCols[key]));
        if (d) {
          year = Number(d.slice(0, 4));
          break;
        }
      }
    }
  }
  if (!year && opts.seasonYear) year = opts.seasonYear;
  header.forEach((v, i) => {
    const t = cellText(v);
    if (/^DRON/i.test(t)) {
      const date = eventDate(t, year);
      out.events.push({ sheet: sheet.name, label: t, date, flight: true });
      if (date) visits.push({ index: i, date, flight: t });
      else out.warnings.push(`${sheet.name}: flight column "${t}" has no readable date (season year unknown)`);
    } else if (/^(PODA|TRAT|RIEGO|HELADA)/i.test(t)) out.events.push({ sheet: sheet.name, label: t, date: eventDate(t, year), flight: false });
  });
  visits.sort((a, b) => a.date.localeCompare(b.date));
  const lastVisitIndex = visits.reduce((m, v) => Math.max(m, v.index), iPos ?? 0);
  // the row above the header carries the day's maximum and minimum temperature per visit
  const tempRow = headerRow > 0 ? (sheet.rows[headerRow - 1] ?? []) : [];
  // rows without a position are named by code and replicate; a repeat gets a counter so no two trees share a name
  const usedNames = new Map<string, number>();
  for (const v of visits) {
    const vc: VisitColumn = { sheet: sheet.name, date: v.date };
    if (v.flight) vc.flight = v.flight.trim();
    const t = cellText(tempRow[v.index] ?? null);
    if (/\d/.test(t)) vc.temperature = t;
    out.visits.push(vc);
  }

  for (let r = headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    const code = cellText(at(row, iCode));
    const acc = cellText(at(row, iAcc));
    if (code === "" && acc === "") continue;
    const plot = plotName(at(row, iPlot), sheet.name);
    const rowText = cellText(at(row, iRow));
    const rowN = Number(rowText);
    const posN = Number(at(row, iPos));
    const rep = Number(at(row, iRep));
    const hasPos = Number.isFinite(posN) && posN > 0;
    const hasRow = rowText !== "" && rowText !== "?";
    const base = hasRow && hasPos ? positionName(plot, rowText, posN) : `${code || acc}${Number.isFinite(rep) && rep > 0 ? `-R${rep}` : ""}`;
    const seenTimes = (usedNames.get(base) ?? 0) + 1;
    usedNames.set(base, seenTimes);
    const name = seenTimes === 1 ? base : `${base}#${seenTimes}`;
    const tree: ObservationUnit = { id: ulid(), name, level: "tree", attributes: { sheet: sheet.name } };
    if (code) tree.cultivarCode = code;
    if (acc) tree.accession = acc;
    const accNo = cellText(at(row, iAccNo));
    if (accNo) tree.accessionNumber = accNo;
    const origin = cellText(at(row, iOrigin));
    if (origin) tree.origin = origin;
    const species = cellText(at(row, iSpecies));
    if (species) tree.species = species;
    tree.plot = plot;
    if (hasRow) {
      tree.rowLabel = rowText;
      if (Number.isInteger(rowN) && rowN > 0) tree.row = rowN;
    }
    if (hasPos) tree.position = posN;
    if (Number.isFinite(rep) && rep > 0) tree.rep = rep;
    if (/early/i.test(cellText(at(row, iEarly)))) tree.earlyGroup = true;
    const gwas = cellText(at(row, iGwas));
    if (gwas) tree.attributes!["gwasId"] = gwas;
    for (const d of descriptors) {
      const v = at(row, d.index);
      if (v !== null && cellText(v) !== "") tree.attributes![d.key] = typeof v === "number" ? v : cellText(v);
    }
    if (plot === "?" || !hasPos) out.warnings.push(`${sheet.name}: ${name} (${acc || code}) has no position in the list`);

    // Row colours: dark grey marks a dead tree; a row greyed from the position column
    // onwards is a replicate nobody phenotyped (a stray label may still sit in it).
    let dark = false;
    const greys = new Map<string, number>();
    for (let col = iCode ?? 0; col <= lastVisitIndex; col++) {
      const f = styleAt(sheet, r, col)?.fillRgb;
      if (!f) continue;
      if (DARK_GREY_FILLS.has(f)) dark = true;
      else if (GREY_FILLS.has(f) && col !== iPos) greys.set(f, (greys.get(f) ?? 0) + 1);
    }
    const greyCount = [...greys.values()].reduce((a, b) => a + b, 0);
    if (dark) tree.attributes!["listStatus"] = "dead";
    if (greyCount >= 3) {
      tree.attributes!["notPhenotyped"] = true;
      // the shade used most along the row, and the one on the position cell when it differs
      tree.attributes!["rowFill"] = [...greys.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      const posFill = iPos === undefined ? undefined : styleAt(sheet, r, iPos)?.fillRgb;
      if (posFill && GREY_FILLS.has(posFill)) tree.attributes!["positionFill"] = posFill;
    }
    // the accession cell is coloured by hand (shared or unique between centres); kept as written
    const accFill = iAcc === undefined ? undefined : styleAt(sheet, r, iAcc)?.fillRgb;
    if (accFill && !GREY_FILLS.has(accFill) && !DARK_GREY_FILLS.has(accFill)) tree.attributes!["accessionFill"] = accFill;
    out.trees.push(tree);

    for (const v of visits) {
      const label = cellText(at(row, v.index));
      if (label === "") continue;
      if (EVENT_LABEL.test(label)) {
        out.treeEvents.push({ sheet: sheet.name, tree: name, date: v.date, label });
        continue;
      }
      const parsed = parseStageLabel(label);
      const noteParts = [parsed?.pre ? `pre:${parsed.pre}` : "", `raw:${label}`, v.flight ? `flight:${v.flight.trim()}` : ""].filter(Boolean);
      const obs: Observation = {
        id: ulid(),
        unitId: tree.id,
        variableId: "flowerStageLabel",
        value: parsed ? { open: parsed.open, fall: parsed.fall } : label,
        observationTimeStamp: `${v.date}T12:00:00Z`,
        deviceId: IMPORT_DEVICE,
        note: noteParts.join(";"),
      };
      if (isRed(styleAt(sheet, r, v.index)?.fontRgb)) obs.dataFlag = 3;
      out.observations.push(obs);
      if (!parsed) out.unparsed.push({ sheet: sheet.name, tree: name, date: v.date, label });
    }

    // a typed date that is not a date ("8,/3/2026") is exactly the error the app exists to stop
    for (const key of Object.keys(dateCols)) {
      const v = at(row, dateCols[key]);
      if (v !== null && cellText(v) !== "" && isoDate(v) === null) out.warnings.push(`${sheet.name}: ${name}: ${key} holds "${cellText(v)}", which is not a date`);
    }
    const rep2: ReportedDates = {
      treeId: tree.id,
      F10: isoDate(at(row, dateCols["F10"])),
      F50: isoDate(at(row, dateCols["F50"])),
      F80: isoDate(at(row, dateCols["F80"])),
      C10: isoDate(at(row, dateCols["C10"])),
      C90: isoDate(at(row, dateCols["C90"])),
    };
    if (rep2.F10 || rep2.F50 || rep2.F80 || rep2.C10 || rep2.C90) out.reported.push(rep2);
  }
}

export { treeName };

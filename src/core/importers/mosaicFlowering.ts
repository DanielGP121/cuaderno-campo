/**
 * Importer for the flowering lists (`Peach_2026_Listado floración.xlsx`): one sheet
 * per plot, one row per tree (Parcela, Fila, Arbol, Rep_Tree), one column per visit
 * date holding the stage label written in the field, plus the typed summary dates
 * (Fecha_F10 .. Fecha_C90) and per-tree descriptors.
 *
 * Visit columns are recognised by their header being a date; columns such as
 * `DRON 17 Feb` or `PODA 24 feb` become field events, not observations.
 */
import { ulid, treeName } from "../ids";
import { parseStageLabel } from "../phenology";
import type { Observation, ObservationUnit } from "../types";
import { cellText, findHeader, readWorkbook, type CellValue, type Sheet } from "../xlsx/reader";

export interface FieldEvent {
  sheet: string;
  label: string;
  /** ISO date when it could be read from the label ("DRON 17 Feb" + season year). */
  date: string | null;
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
  /** Labels that could not be parsed, with where they were. */
  unparsed: { sheet: string; tree: string; date: string; label: string }[];
  warnings: string[];
}

const IMPORT_DEVICE = "import:xlsx";
const MONTHS: Record<string, number> = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, oct: 10, nov: 11, dic: 12, dec: 12 };

function at(row: CellValue[], i: number | undefined): CellValue {
  return i === undefined ? null : (row[i] ?? null);
}

function isoDate(v: CellValue): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

/** "DRON 17 Feb" -> 2026-02-17 given the season year. */
function eventDate(label: string, year: number): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]{3})/.exec(label);
  if (!m) return null;
  const month = MONTHS[m[2]!.toLowerCase()];
  if (!month) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
}

export function importFloweringList(bytes: Uint8Array): FloweringImport {
  const wb = readWorkbook(bytes);
  const out: FloweringImport = { trees: [], observations: [], reported: [], events: [], unparsed: [], warnings: [] };
  for (const sheet of wb.sheets) {
    const h = findHeader(sheet, { require: ["Cultivar_code", "Fecha_F50"] }) ?? findHeader(sheet, { require: ["Accession", "Date_F50"] });
    if (!h) continue;
    importSheet(sheet, h.rowIndex, h.columns, out);
  }
  return out;
}

function importSheet(sheet: Sheet, headerRow: number, c: Map<string, number>, out: FloweringImport): void {
  const header = sheet.rows[headerRow] ?? [];
  const iCode = c.get("Cultivar_code");
  const iAcc = c.get("Accession");
  const iAccNo = c.get("Accession number");
  const iGwas = c.get("ID GWAS Mas-Gomez");
  const iOrigin = c.get("Origin");
  const iPlot = c.get("Parcela");
  const iRow = c.get("Fila");
  const iPos = c.get("Arbol");
  const iRep = c.get("Rep_Tree") ?? c.get("Rep");
  const iEarly = iPos !== undefined && (header[iPos + 1] === null || header[iPos + 1] === undefined) ? iPos + 1 : undefined;
  const dateCols: Record<string, number | undefined> = {
    F10: c.get("Fecha_F10") ?? c.get("Date_F10"),
    F50: c.get("Fecha_F50") ?? c.get("Date_F50"),
    F80: c.get("Fecha_F80") ?? c.get("Date_F80"),
    C10: c.get("Fecha_C10") ?? c.get("Date_C10"),
    C90: c.get("Fecha_C90") ?? c.get("Date_C90"),
  };
  const iDensity = [...c.keys()].find((k) => /^Density of flower buds/i.test(k));
  const iFlowerType = [...c.keys()].find((k) => /^Flower type/i.test(k));
  const iPetals = [...c.keys()].find((k) => /^Petals_flower/i.test(k));

  // Visit columns: header is a date. Event columns: header mentions DRON / PODA / etc.
  const visits: { index: number; date: string }[] = [];
  let year = 0;
  header.forEach((v, i) => {
    const d = isoDate(v);
    if (d) {
      visits.push({ index: i, date: d });
      year = Number(d.slice(0, 4));
    }
  });
  header.forEach((v, i) => {
    const t = cellText(v);
    if (/^(DRON|PODA|TRAT|RIEGO|HELADA)/i.test(t)) out.events.push({ sheet: sheet.name, label: t, date: eventDate(t, year) });
    void i;
  });

  for (let r = headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    const code = cellText(at(row, iCode));
    const acc = cellText(at(row, iAcc));
    if (code === "" && acc === "") continue;
    const plot = cellText(at(row, iPlot)) || sheet.name;
    const rowN = Number(at(row, iRow));
    const posN = Number(at(row, iPos));
    const rep = Number(at(row, iRep));
    const hasGrid = Number.isFinite(rowN) && rowN > 0 && Number.isFinite(posN) && posN > 0;
    const name = hasGrid ? treeName(plot, rowN, posN) : `${code || acc}${Number.isFinite(rep) && rep > 0 ? `-R${rep}` : ""}`;
    const tree: ObservationUnit = { id: ulid(), name, level: "tree", attributes: { sheet: sheet.name } };
    if (code) tree.cultivarCode = code;
    if (acc) tree.accession = acc;
    const accNo = cellText(at(row, iAccNo));
    if (accNo) tree.accessionNumber = accNo;
    const origin = cellText(at(row, iOrigin));
    if (origin) tree.origin = origin;
    tree.plot = plot;
    if (hasGrid) {
      tree.row = rowN;
      tree.position = posN;
    }
    if (Number.isFinite(rep) && rep > 0) tree.rep = rep;
    if (/early/i.test(cellText(at(row, iEarly)))) tree.earlyGroup = true;
    const gwas = cellText(at(row, iGwas));
    if (gwas) tree.attributes!["gwasId"] = gwas;
    const density = cellText(at(row, iDensity === undefined ? undefined : c.get(iDensity)));
    if (density) tree.attributes!["flowerBudDensity"] = density;
    const ftype = cellText(at(row, iFlowerType === undefined ? undefined : c.get(iFlowerType)));
    if (ftype) tree.attributes!["flowerType"] = ftype;
    const petals = cellText(at(row, iPetals === undefined ? undefined : c.get(iPetals)));
    if (petals) tree.attributes!["petalsPerFlower"] = petals;
    out.trees.push(tree);

    for (const v of visits) {
      const label = cellText(at(row, v.index));
      if (label === "") continue;
      const parsed = parseStageLabel(label);
      const obs: Observation = {
        id: ulid(),
        unitId: tree.id,
        variableId: "flowerStageLabel",
        value: parsed ? { open: parsed.open, fall: parsed.fall } : label,
        observationTimeStamp: `${v.date}T12:00:00Z`,
        deviceId: IMPORT_DEVICE,
        note: parsed ? (parsed.pre ? `pre:${parsed.pre};raw:${label}` : `raw:${label}`) : `raw:${label}`,
      };
      out.observations.push(obs);
      if (!parsed) out.unparsed.push({ sheet: sheet.name, tree: name, date: v.date, label });
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

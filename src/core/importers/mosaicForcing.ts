/**
 * Importers for the EEAD forcing-assay workbooks (MOSAIC 2025-2026 layout):
 *
 *  - `Peach_Branches_Breaking Dormancy_*.xlsx`: one sheet per sampling (`n_Sampling`),
 *    one row per tube with identity columns and the bud counts per stage.
 *  - `MOSAIC_*_CP_data DEF.xlsx`: the consolidated sheet the R pipeline reads, one row
 *    per tube and sampling with the stage fractions and `%Nb>BC`.
 *
 * Both are turned into the app's entities (trees, samplings, tubes, observations) so
 * that a season recorded in Excel can be replayed, compared and continued in the app.
 */
import { ulid } from "../ids";
import type { BudCounts } from "../forcing";
import type { Observation, ObservationUnit, Sampling } from "../types";
import { cellText, columnsOf, findHeader, readWorkbook, type CellValue, type Sheet } from "../xlsx/reader";

export interface ForcingImport {
  trees: ObservationUnit[];
  tubes: ObservationUnit[];
  samplings: Sampling[];
  observations: Observation[];
  warnings: string[];
}

const IMPORT_DEVICE = "import:xlsx";

function num(v: CellValue): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.trim().replace(",", ".");
    if (s === "") return null;
    if (s.endsWith("%")) {
      const n = Number(s.slice(0, -1));
      return Number.isFinite(n) ? n / 100 : null;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isoDate(v: CellValue): string | null {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Column of the first header matching any of the given names. */
function col(columns: Map<string, number>, ...names: string[]): number | undefined {
  for (const n of names) {
    const i = columns.get(n);
    if (i !== undefined) return i;
  }
  return undefined;
}

/** Column whose header matches a pattern (the sheets write `Sample_code` or `Sample_10_code`). */
function colMatching(columns: Map<string, number>, re: RegExp): number | undefined {
  for (const [name, i] of columns) if (re.test(name)) return i;
  return undefined;
}

/** Cell at a column, null when the row is shorter. */
function at(row: CellValue[], i: number | undefined): CellValue {
  return i === undefined ? null : (row[i] ?? null);
}

/** The unnamed column right after the first `Origin` holds "Early" for the early group. */
function earlyColumn(header: CellValue[], columns: Map<string, number>): number | undefined {
  const origin = columns.get("Origin");
  if (origin === undefined) return undefined;
  const next = origin + 1;
  return header[next] === null || header[next] === undefined || cellText(header[next]) === "" ? next : undefined;
}

/**
 * Read the per-sampling workbook. Trees are keyed by Cultivar_code; tubes by
 * Sample_code. Bud-count observations are created only when at least one count
 * cell holds a number, so unread tubes stay unread rather than becoming zeros.
 */
export function importForcingWorkbook(bytes: Uint8Array): ForcingImport {
  const wb = readWorkbook(bytes);
  const out: ForcingImport = { trees: [], tubes: [], samplings: [], observations: [], warnings: [] };
  const trees = new Map<string, ObservationUnit>();
  const tubes = new Map<string, ObservationUnit>();
  const samplings = new Map<number, Sampling>();

  const sheets = wb.sheets.filter((s) => /^\d+_Sampling/i.test(s.name));
  for (const sheet of sheets) importSamplingSheet(sheet, trees, tubes, samplings, out);

  out.trees = [...trees.values()];
  out.tubes = [...tubes.values()];
  out.samplings = [...samplings.values()].sort((a, b) => a.number - b.number);
  return out;
}

function importSamplingSheet(
  sheet: Sheet,
  trees: Map<string, ObservationUnit>,
  tubes: Map<string, ObservationUnit>,
  samplings: Map<number, Sampling>,
  out: ForcingImport,
): void {
  const h = findHeader(sheet, { require: ["CP", "Cultivar_code"], minCells: 8 });
  const iCode = h ? colMatching(h.columns, /^Sample(_\d+)?_code$/i) : undefined;
  if (!h || iCode === undefined) {
    out.warnings.push(`${sheet.name}: header not found`);
    return;
  }
  const header = sheet.rows[h.rowIndex] ?? [];
  const c = h.columns;
  const iSampling = col(c, "Sampling_number", "SAMPLING");
  const iCut = col(c, "Date Sampling");
  const iRead = col(c, "Date Reading_JD", "Date Reading");
  const iCp = col(c, "CP");
  const iRep = col(c, "REP", "Rep");
  const iCultivar = col(c, "Cultivar_code");
  const iAccession = col(c, "Accession");
  const iAccNo = col(c, "Accession number");
  const iOrigin = col(c, "Origin");
  const iGwas = col(c, "ID GWAS Mas-Gomez");
  const iEarly = earlyColumn(header, c);
  const counts: Record<keyof BudCounts, number | undefined> = {
    AorB: col(c, "Nb_AorB"),
    BC: col(c, "Nb_B-C*", "Nb_B-C", "Nb_BC"),
    C: col(c, "Nb_C"),
    D: col(c, "Nb_D"),
    E: col(c, "Nb_E"),
    F: col(c, "Nb_F"),
  };
  const iObserv = col(c, "Observ");
  const iPct = col(c, "%Nb>BC");
  const sheetNumber = Number(/^(\d+)_/.exec(sheet.name)?.[1]);

  for (let r = h.rowIndex + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    const code = cellText(at(row, iCode));
    if (code === "") continue;
    // The sheet name (`10_Sampling`) is the authoritative sampling number: the column
    // is sometimes titled SAMPLING and copied from a previous sheet without updating.
    const samplingNumber = Number.isFinite(sheetNumber) ? sheetNumber : (num(at(row, iSampling)) ?? NaN);
    if (!Number.isFinite(samplingNumber)) {
      out.warnings.push(`${sheet.name} row ${r + 1}: no sampling number`);
      continue;
    }
    const cutDate = isoDate(at(row, iCut));
    const readDate = isoDate(at(row, iRead));
    const cp = num(at(row, iCp));
    const rep = cellText(at(row, iRep));
    const cultivarCode = cellText(at(row, iCultivar));
    if (cultivarCode === "") {
      out.warnings.push(`${sheet.name} row ${r + 1}: ${code} without Cultivar_code`);
      continue;
    }

    let tree = trees.get(cultivarCode);
    if (!tree) {
      tree = {
        id: ulid(),
        name: cultivarCode,
        level: "tree",
        cultivarCode,
        isReference: true,
        attributes: {},
      };
      trees.set(cultivarCode, tree);
    }
    const accession = cellText(at(row, iAccession));
    if (accession && !tree.accession) tree.accession = accession;
    const accNo = cellText(at(row, iAccNo));
    if (accNo && !tree.accessionNumber) tree.accessionNumber = accNo;
    const origin = cellText(at(row, iOrigin));
    if (origin && !tree.origin) tree.origin = origin;
    const gwas = cellText(at(row, iGwas));
    if (gwas && tree.attributes && tree.attributes["gwasId"] === undefined) tree.attributes["gwasId"] = gwas;
    if (/early/i.test(cellText(at(row, iEarly)))) tree.earlyGroup = true;

    let sampling = samplings.get(samplingNumber);
    if (!sampling) {
      sampling = {
        id: ulid(),
        number: samplingNumber,
        cutDate: cutDate ?? "",
        replicates: [],
        treeIds: [],
      };
      samplings.set(samplingNumber, sampling);
    }
    if (!sampling.cutDate && cutDate) sampling.cutDate = cutDate;
    if (!sampling.readDate && readDate) sampling.readDate = readDate;
    if (sampling.chillPortions === undefined && cp !== null) sampling.chillPortions = cp;
    if (rep && !sampling.replicates.includes(rep)) sampling.replicates.push(rep);
    if (!sampling.treeIds.includes(tree.id)) sampling.treeIds.push(tree.id);

    let tube = tubes.get(code);
    if (!tube) {
      tube = { id: ulid(), name: code, level: "tube", parentId: tree.id, attributes: { samplingNumber } };
      if (rep.length === 1 && /[A-Z]/i.test(rep)) tube.rep = rep.toUpperCase().charCodeAt(0) - 64;
      if (rep && tube.attributes) tube.attributes["replicate"] = rep;
      if (cutDate) tube.cutDate = cutDate;
      if (readDate) tube.readDate = readDate;
      if (cp !== null) tube.chillPortions = cp;
      tubes.set(code, tube);
    }

    const values: Partial<BudCounts> = {};
    let any = false;
    for (const k of Object.keys(counts) as (keyof BudCounts)[]) {
      const v = num(at(row, counts[k]));
      if (v !== null) {
        values[k] = v;
        any = true;
      }
    }
    const when = readDate ?? (cutDate ? addDays(cutDate, 10) : "");
    const note = cellText(at(row, iObserv));
    if (any) {
      const value: BudCounts = { AorB: values.AorB ?? 0, BC: values.BC ?? 0, C: values.C ?? 0, D: values.D ?? 0, E: values.E ?? 0, F: values.F ?? 0 };
      const obs: Observation = {
        id: ulid(),
        unitId: tube.id,
        variableId: "budStageCounts",
        value,
        observationTimeStamp: when ? `${when}T12:00:00Z` : "",
        deviceId: IMPORT_DEVICE,
        samplingId: sampling.id,
      };
      if (note) obs.note = note;
      out.observations.push(obs);
    } else {
      // The group does not count buds when none has moved: the sheet then carries the
      // formula default (`%Nb>BC` = 0) and the R pipeline reads it as an observed zero.
      // Keep that as a fraction-only observation so the season replays faithfully.
      const pct = num(at(row, iPct));
      if (pct !== null) {
        const obs: Observation = {
          id: ulid(),
          unitId: tube.id,
          variableId: "budReleasedFraction",
          value: Math.min(pct, 1),
          observationTimeStamp: when ? `${when}T12:00:00Z` : "",
          deviceId: IMPORT_DEVICE,
          samplingId: sampling.id,
        };
        if (note) obs.note = note;
        out.observations.push(obs);
      }
    }
  }
}

/** One row of the consolidated CP sheet, as the R pipeline sees it. */
export interface ConsolidatedRow {
  cultivarCode: string;
  accession: string;
  accessionNumber: string;
  origin: string;
  samplingNumber: number;
  cutDate: string | null;
  cp: number | null;
  rep: string;
  totalBuds: number | null;
  /** Fraction of buds beyond B-C as stored (`%Nb>BC`), 0..1, null when empty. */
  fractionReleased: number | null;
}

/**
 * Read the `2025-2026` style sheet: the consolidated one, recognised by its
 * `Total N buds` column (per-sampling sheets say `Total_Nb_Buds`); falls back to the
 * first sheet that has `%Nb>BC` at all.
 */
export function importConsolidatedCp(bytes: Uint8Array): { rows: ConsolidatedRow[]; sheet: string; warnings: string[] } {
  const wb = readWorkbook(bytes);
  const warnings: string[] = [];
  const candidates = [
    ...wb.sheets.filter((s) => findHeader(s, { require: ["Cultivar_code", "Sampling_number", "CP", "Total N buds"] })),
    ...wb.sheets,
  ];
  for (const sheet of candidates) {
    const h = findHeader(sheet, { require: ["Cultivar_code", "Sampling_number", "CP"] });
    if (!h) continue;
    const c = h.columns;
    const iPct = col(c, "%Nb>BC", "%Nb_>BC", "%Nb>BC*");
    if (iPct === undefined) continue;
    const iCode = col(c, "Cultivar_code")!;
    const iAcc = col(c, "Accession");
    const iAccNo = col(c, "Accession number");
    const iOrigin = col(c, "Origin");
    const iSamp = col(c, "Sampling_number")!;
    const iCut = col(c, "Date Sampling");
    const iCp = col(c, "CP")!;
    const iRep = col(c, "REP", "Rep");
    const iTotal = col(c, "Total N buds", "Total_Nb_Buds");
    const rows: ConsolidatedRow[] = [];
    for (let r = h.rowIndex + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r] ?? [];
      const code = cellText(at(row, iCode));
      const samp = num(at(row, iSamp));
      if (code === "" || samp === null) continue;
      rows.push({
        cultivarCode: code,
        accession: cellText(at(row, iAcc)),
        accessionNumber: cellText(at(row, iAccNo)),
        origin: cellText(at(row, iOrigin)),
        samplingNumber: samp,
        cutDate: isoDate(at(row, iCut)),
        cp: num(at(row, iCp)),
        rep: cellText(at(row, iRep)),
        totalBuds: num(at(row, iTotal)),
        fractionReleased: num(at(row, iPct)),
      });
    }
    return { rows, sheet: sheet.name, warnings };
  }
  warnings.push("no sheet with Cultivar_code, Sampling_number, CP and %Nb>BC");
  return { rows: [], sheet: "", warnings };
}

/**
 * Turn consolidated rows into a dataset (trees, samplings, tubes, fraction-only
 * observations). Used to replay a season for which only the consolidated sheet is
 * trusted, and to test the exporter strictly against the pipeline's own input.
 */
export function datasetFromConsolidated(rows: ConsolidatedRow[]): ForcingImport {
  const out: ForcingImport = { trees: [], tubes: [], samplings: [], observations: [], warnings: [] };
  const trees = new Map<string, ObservationUnit>();
  const samplings = new Map<number, Sampling>();
  const tubes = new Map<string, ObservationUnit>();
  for (const r of rows) {
    let tree = trees.get(r.cultivarCode);
    if (!tree) {
      tree = { id: ulid(), name: r.cultivarCode, level: "tree", cultivarCode: r.cultivarCode, isReference: true, attributes: {} };
      if (r.accession) tree.accession = r.accession;
      if (r.accessionNumber) tree.accessionNumber = r.accessionNumber;
      if (r.origin) tree.origin = r.origin;
      trees.set(r.cultivarCode, tree);
    }
    let sampling = samplings.get(r.samplingNumber);
    if (!sampling) {
      sampling = { id: ulid(), number: r.samplingNumber, cutDate: r.cutDate ?? "", replicates: [], treeIds: [] };
      samplings.set(r.samplingNumber, sampling);
    }
    if (!sampling.cutDate && r.cutDate) sampling.cutDate = r.cutDate;
    if (sampling.chillPortions === undefined && r.cp !== null) sampling.chillPortions = r.cp;
    if (r.rep && !sampling.replicates.includes(r.rep)) sampling.replicates.push(r.rep);
    if (!sampling.treeIds.includes(tree.id)) sampling.treeIds.push(tree.id);
    // One tube per row: a repeated (tree, sampling, replicate) in the source is kept as
    // a second tube rather than merged, so nothing that fed the analysis is lost.
    const base = r.rep ? `${r.cultivarCode}_${r.samplingNumber}_${r.rep}` : `${r.cultivarCode}_${r.samplingNumber}`;
    let code = base;
    for (let n = 2; tubes.has(code); n++) code = `${base}#${n}`;
    if (code !== base) out.warnings.push(`duplicated row for ${base}, kept as ${code}`);
    const tube: ObservationUnit = { id: ulid(), name: code, level: "tube", parentId: tree.id, attributes: { samplingNumber: r.samplingNumber } };
    if (r.rep.length === 1 && /[A-Z]/i.test(r.rep)) tube.rep = r.rep.toUpperCase().charCodeAt(0) - 64;
    if (r.rep && tube.attributes) tube.attributes["replicate"] = r.rep;
    if (r.cutDate) tube.cutDate = r.cutDate;
    if (r.cp !== null) tube.chillPortions = r.cp;
    tubes.set(code, tube);
    if (r.fractionReleased !== null) {
      const when = r.cutDate ? addDays(r.cutDate, 10) : "";
      out.observations.push({
        id: ulid(),
        unitId: tube.id,
        variableId: "budReleasedFraction",
        value: r.fractionReleased,
        observationTimeStamp: when ? `${when}T12:00:00Z` : "",
        deviceId: IMPORT_DEVICE,
        samplingId: sampling.id,
      });
    }
  }
  out.trees = [...trees.values()];
  out.tubes = [...tubes.values()];
  out.samplings = [...samplings.values()].sort((a, b) => a.number - b.number);
  return out;
}

export { columnsOf };

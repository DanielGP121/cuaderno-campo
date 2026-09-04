/**
 * Minimal .xlsx reader: enough to load the group's workbooks (shared and inline
 * strings, numbers, booleans, cached formula values, dates by cell style) without
 * pulling in a spreadsheet library. Mirrors the stdlib parser used for the Cieza
 * croquis in Python, so behaviour is known.
 *
 * Dates come back as ISO strings ("2026-03-09" or "2026-03-09T10:30:00") when the
 * cell style is a date format; everything else keeps its raw type.
 */
import { unzipSync } from "fflate";

export type CellValue = string | number | boolean | null;

export interface Sheet {
  name: string;
  /** Row-major grid, 0-based, ragged rows padded with null up to the last used column of that row. */
  rows: CellValue[][];
}

export interface Workbook {
  sheets: Sheet[];
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

function text(bytes: Uint8Array | undefined): string {
  return bytes ? new TextDecoder("utf-8").decode(bytes) : "";
}

/** Column letters ("AB") to 0-based index. */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 0-based index to column letters. */
export function columnLetters(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Excel serial (1900 system) to ISO date or datetime string. */
export function serialToIso(serial: number): string {
  // Excel's epoch is 1899-12-30 once the fake 1900-02-29 is accounted for.
  const ms = Math.round((serial - 25569) * 86_400_000);
  const d = new Date(ms);
  const date = d.toISOString().slice(0, 10);
  const frac = serial - Math.floor(serial);
  if (frac < 1e-9) return date;
  return d.toISOString().slice(0, 19);
}

/** ISO date ("2026-03-09") to Excel serial. */
export function isoToSerial(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number) as [number, number, number];
  const days = Date.UTC(y, m - 1, d) / 86_400_000 + 25569;
  const t = iso.length > 10 ? iso.slice(11, 19).split(":").map(Number) : [0, 0, 0];
  const [hh = 0, mm = 0, ss = 0] = t;
  return days + (hh * 3600 + mm * 60 + ss) / 86_400;
}

function isDateFormatCode(code: string): boolean {
  // Strip quoted literals and colour/condition brackets, then look for date tokens.
  const cleaned = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
  return /[dmyhs]/i.test(cleaned) && !/^[#0,.\s%E+-]*$/.test(cleaned);
}

function parseStyles(xml: string): boolean[] {
  // numFmtId -> is date, for custom formats
  const custom = new Map<number, boolean>();
  for (const m of xml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    custom.set(Number(m[1]), isDateFormatCode(decodeXml(m[2]!)));
  }
  const xfsBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  const out: boolean[] = [];
  for (const m of xfsBlock.matchAll(/<xf\b([^>]*)\/?>/g)) {
    const id = Number(/numFmtId="(\d+)"/.exec(m[1]!)?.[1] ?? "0");
    out.push(BUILTIN_DATE_FORMATS.has(id) || custom.get(id) === true);
  }
  return out;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const parts = [...m[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1]!));
    out.push(parts.join(""));
  }
  return out;
}

function parseSheet(xml: string, shared: string[], dateStyles: boolean[]): CellValue[][] {
  const rows: CellValue[][] = [];
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rIndex = Number(/\br="(\d+)"/.exec(rowMatch[1]!)?.[1] ?? rows.length + 1) - 1;
    const row: CellValue[] = [];
    for (const c of rowMatch[2]!.matchAll(cellRe)) {
      const attrs = c[1]!;
      const inner = c[2] ?? "";
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const col = ref ? columnIndex(ref) : row.length;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const style = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? "-1");
      let value: CellValue = null;
      if (type === "s") {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        value = v === undefined ? null : (shared[Number(v)] ?? null);
      } else if (type === "inlineStr") {
        value = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1]!)).join("");
      } else if (type === "b") {
        value = /<v>1<\/v>/.test(inner);
      } else if (type === "str" || type === "e") {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        value = v === undefined ? null : decodeXml(v);
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (v === undefined || v === "") value = null;
        else {
          const n = Number(v);
          value = Number.isFinite(n) ? (style >= 0 && dateStyles[style] ? serialToIso(n) : n) : decodeXml(v);
        }
      }
      while (row.length < col) row.push(null);
      row[col] = value;
    }
    while (rows.length < rIndex) rows.push([]);
    rows[rIndex] = row;
  }
  return rows;
}

/** Parse an .xlsx from bytes. */
export function readWorkbook(bytes: Uint8Array): Workbook {
  const files = unzipSync(bytes);
  const wbXml = text(files["xl/workbook.xml"]);
  const relsXml = text(files["xl/_rels/workbook.xml.rels"]);
  const shared = parseSharedStrings(text(files["xl/sharedStrings.xml"]));
  const dateStyles = parseStyles(text(files["xl/styles.xml"]));

  const rels = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, "xl/").replace(/^xl\/xl\//, "xl/"));
  }

  const sheets: Sheet[] = [];
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeXml(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? "");
    const rId = /\br:id="([^"]+)"/.exec(m[0])?.[1] ?? /\bid="([^"]+)"/.exec(m[0])?.[1];
    const target = rId ? rels.get(rId) : undefined;
    const xml = target ? text(files[target]) : "";
    sheets.push({ name, rows: xml ? parseSheet(xml, shared, dateStyles) : [] });
  }
  return { sheets };
}

/** Sheet by exact name, or by case-insensitive trimmed match. */
export function sheetByName(wb: Workbook, name: string): Sheet | undefined {
  return wb.sheets.find((s) => s.name === name) ?? wb.sheets.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
}

export interface HeaderOptions {
  /** Header texts that must all be present (exact, trimmed). */
  require?: string[];
  /** Minimum non-empty text cells for a row to qualify. */
  minCells?: number;
  /** How many rows from the top to inspect. */
  scan?: number;
}

/** Column map of a row: header text (trimmed) to 0-based index, first occurrence wins. */
export function columnsOf(row: CellValue[]): Map<string, number> {
  const columns = new Map<string, number>();
  row.forEach((v, i) => {
    if (v !== null && v !== "" && !columns.has(String(v).trim())) columns.set(String(v).trim(), i);
  });
  return columns;
}

/**
 * Locate the header row. The group's sheets carry notes and temperature strings above
 * the real header, so the rule is: among the first `scan` rows, take the one with the
 * most non-empty text cells that contains every required header (if any). Ties go to
 * the earlier row.
 */
export function findHeader(sheet: Sheet, opts: HeaderOptions | number = {}): { rowIndex: number; columns: Map<string, number> } | null {
  const o: HeaderOptions = typeof opts === "number" ? { minCells: opts } : opts;
  const minCells = o.minCells ?? 3;
  const scan = o.scan ?? 12;
  let best: { rowIndex: number; columns: Map<string, number>; score: number } | null = null;
  for (let r = 0; r < Math.min(scan, sheet.rows.length); r++) {
    const row = sheet.rows[r] ?? [];
    const texts = row.filter((v) => typeof v === "string" && v.trim() !== "");
    if (texts.length < minCells) continue;
    const columns = columnsOf(row);
    if (o.require && !o.require.every((k) => columns.has(k))) continue;
    if (!best || texts.length > best.score) best = { rowIndex: r, columns, score: texts.length };
  }
  return best ? { rowIndex: best.rowIndex, columns: best.columns } : null;
}

/** Cell as trimmed string, empty for null. */
export function cellText(v: CellValue): string {
  return v === null ? "" : String(v).trim();
}

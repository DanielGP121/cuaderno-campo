/**
 * Minimal .xlsx reader: enough to load the group's workbooks (shared and inline
 * strings, numbers, booleans, cached formula values, dates by cell style) without
 * pulling in a spreadsheet library. Mirrors the stdlib parser used for the Cieza
 * croquis in Python, so behaviour is known.
 *
 * Dates come back as ISO strings ("2026-03-09" or "2026-03-09T10:30:00") when the
 * cell style is a date format; everything else keeps its raw type.
 *
 * Besides values, a sheet carries its merged ranges and the anchors of the pictures
 * placed on it: the hand-drawn plot maps merge a cell over the trees of a variety and
 * mark each living tree of the CITA collection with a small tree icon. On request the
 * font and fill colour of every cell come too, because the flowering sheets write
 * estimated values in red and grey out the trees that were not phenotyped.
 */
import { unzipSync } from "fflate";

export type CellValue = string | number | boolean | null;

export interface PictureAnchor {
  /** 0-based row and column of the cell the picture is anchored to. */
  row: number;
  col: number;
}

/** Colours of a cell as written in the style tables (ARGB such as "FFFF0000"). */
export interface CellStyle {
  fontRgb?: string;
  fontTheme?: number;
  fillRgb?: string;
  fillTheme?: number;
  fillTint?: number;
}

export interface Sheet {
  name: string;
  /** Row-major grid, 0-based, ragged rows padded with null up to the last used column of that row. */
  rows: CellValue[][];
  /** Merged ranges as written in the sheet ("E3:F3"). */
  merges: string[];
  /** Pictures anchored on the sheet (a drawing part), by the cell of their top-left corner. */
  pictures: PictureAnchor[];
  /** Cell colours, parallel to `rows`; only present when read with `{ styles: true }`. */
  styles?: (CellStyle | null)[][];
}

export interface Workbook {
  sheets: Sheet[];
}

export interface ReadOptions {
  /** Also read the font and fill colour of every cell. */
  styles?: boolean;
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

export interface CellRange {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** "E3:F3" (or a single "E3") to 0-based inclusive bounds. */
export function parseRange(ref: string): CellRange {
  const [a, b = a] = ref.split(":") as [string, string?];
  const pa = /^([A-Z]+)(\d+)$/.exec(a.trim());
  const pb = /^([A-Z]+)(\d+)$/.exec((b ?? a).trim());
  if (!pa || !pb) throw new Error(`bad range: ${ref}`);
  return { r0: Number(pa[2]) - 1, c0: columnIndex(pa[1]!), r1: Number(pb[2]) - 1, c1: columnIndex(pb[1]!) };
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

interface ColourRef {
  rgb?: string;
  theme?: number;
  tint?: number;
}

interface StyleTables {
  fonts: ColourRef[];
  fills: ColourRef[];
  xfs: { fontId: number; fillId: number }[];
}

function colourOf(attrs: string): ColourRef {
  const out: ColourRef = {};
  const rgb = /\brgb="([0-9A-Fa-f]+)"/.exec(attrs)?.[1];
  if (rgb) out.rgb = rgb.toUpperCase();
  const theme = /\btheme="(\d+)"/.exec(attrs)?.[1];
  if (theme) out.theme = Number(theme);
  const tint = /\btint="(-?[\d.]+)"/.exec(attrs)?.[1];
  if (tint) out.tint = Number(tint);
  return out;
}

/** Font and fill colour tables plus the font/fill index of every cell format. */
function parseStyleTables(xml: string): StyleTables {
  const fonts: ColourRef[] = [];
  const fontsBlock = /<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(xml)?.[1] ?? "";
  for (const m of fontsBlock.matchAll(/<font\b[^>]*?(?:\/>|>([\s\S]*?)<\/font>)/g)) {
    const color = /<color\b([^>]*)\/>/.exec(m[1] ?? "")?.[1];
    fonts.push(color ? colourOf(color) : {});
  }
  const fills: ColourRef[] = [];
  const fillsBlock = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(xml)?.[1] ?? "";
  for (const m of fillsBlock.matchAll(/<fill\b[^>]*?(?:\/>|>([\s\S]*?)<\/fill>)/g)) {
    const inner = m[1] ?? "";
    const pattern = /<patternFill\b([^>]*)/.exec(inner)?.[1] ?? "";
    const type = /\bpatternType="(\w+)"/.exec(pattern)?.[1];
    if (!type || type === "none") {
      fills.push({});
      continue;
    }
    const fg = /<fgColor\b([^>]*)\/>/.exec(inner)?.[1];
    fills.push(fg ? colourOf(fg) : {});
  }
  const xfs: StyleTables["xfs"] = [];
  const xfsBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  for (const m of xfsBlock.matchAll(/<xf\b([^>]*)\/?>/g)) {
    xfs.push({ fontId: Number(/\bfontId="(\d+)"/.exec(m[1]!)?.[1] ?? "0"), fillId: Number(/\bfillId="(\d+)"/.exec(m[1]!)?.[1] ?? "0") });
  }
  return { fonts, fills, xfs };
}

function styleOf(tables: StyleTables, index: number): CellStyle | null {
  const xf = tables.xfs[index];
  if (!xf) return null;
  const font = tables.fonts[xf.fontId] ?? {};
  const fill = tables.fills[xf.fillId] ?? {};
  const out: CellStyle = {};
  if (font.rgb) out.fontRgb = font.rgb;
  if (font.theme !== undefined) out.fontTheme = font.theme;
  if (fill.rgb) out.fillRgb = fill.rgb;
  if (fill.theme !== undefined) out.fillTheme = fill.theme;
  if (fill.tint !== undefined) out.fillTint = fill.tint;
  return Object.keys(out).length ? out : null;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const parts = [...m[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1]!));
    out.push(parts.join(""));
  }
  return out;
}

function parseSheet(xml: string, shared: string[], dateStyles: boolean[], tables: StyleTables | null): { rows: CellValue[][]; styles: (CellStyle | null)[][] } {
  const rows: CellValue[][] = [];
  const styles: (CellStyle | null)[][] = [];
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  // A formatted empty row is written self-closed (`<row r="2" .../>`); it must not
  // swallow the next row's cells, hence the two alternatives.
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rIndex = Number(/\br="(\d+)"/.exec(rowMatch[1]!)?.[1] ?? rows.length + 1) - 1;
    const row: CellValue[] = [];
    const rowStyles: (CellStyle | null)[] = [];
    for (const c of (rowMatch[2] ?? "").matchAll(cellRe)) {
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
      if (tables) {
        while (rowStyles.length < col) rowStyles.push(null);
        rowStyles[col] = style >= 0 ? styleOf(tables, style) : null;
      }
    }
    while (rows.length < rIndex) rows.push([]);
    rows[rIndex] = row;
    if (tables) {
      while (styles.length < rIndex) styles.push([]);
      styles[rIndex] = rowStyles;
    }
  }
  return { rows, styles };
}

function parseMerges(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<mergeCell\b[^>]*\bref="([A-Z]+\d+:[A-Z]+\d+)"/g)) out.push(m[1]!);
  return out;
}

/** Resolve a relationship target ("../drawings/drawing1.xml") against the part's folder. */
function resolvePart(fromPart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = fromPart.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/**
 * Anchors of the pictures on a sheet. Each anchor block of the drawing part that holds
 * a `<xdr:pic>` contributes the cell of its `<xdr:from>` corner.
 */
function parsePictures(files: Record<string, Uint8Array>, sheetPart: string): PictureAnchor[] {
  const relsPart = sheetPart.replace(/worksheets\/([^/]+)$/, "worksheets/_rels/$1.rels");
  const rels = text(files[relsPart]);
  if (!rels) return [];
  const out: PictureAnchor[] = [];
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    if (!/Type="[^"]*\/drawing"/.test(m[0])) continue;
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (!target) continue;
    const drawing = text(files[resolvePart(sheetPart, target)]);
    for (const a of drawing.matchAll(/<xdr:(oneCellAnchor|twoCellAnchor|absoluteAnchor)\b[\s\S]*?<\/xdr:\1>/g)) {
      const block = a[0];
      if (!/<xdr:pic[\s>]/.test(block)) continue;
      const from = /<xdr:from>([\s\S]*?)<\/xdr:from>/.exec(block)?.[1] ?? "";
      const col = Number(/<xdr:col>(\d+)<\/xdr:col>/.exec(from)?.[1] ?? "-1");
      const row = Number(/<xdr:row>(\d+)<\/xdr:row>/.exec(from)?.[1] ?? "-1");
      if (col >= 0 && row >= 0) out.push({ row, col });
    }
  }
  return out;
}

/** Parse an .xlsx from bytes. */
export function readWorkbook(bytes: Uint8Array, opts: ReadOptions = {}): Workbook {
  const files = unzipSync(bytes);
  const wbXml = text(files["xl/workbook.xml"]);
  const relsXml = text(files["xl/_rels/workbook.xml.rels"]);
  const shared = parseSharedStrings(text(files["xl/sharedStrings.xml"]));
  const stylesXml = text(files["xl/styles.xml"]);
  const dateStyles = parseStyles(stylesXml);
  const tables = opts.styles ? parseStyleTables(stylesXml) : null;

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
    const parsed = xml ? parseSheet(xml, shared, dateStyles, tables) : { rows: [], styles: [] };
    const sheet: Sheet = {
      name,
      rows: parsed.rows,
      merges: xml ? parseMerges(xml) : [],
      pictures: target ? parsePictures(files, target) : [],
    };
    if (tables) sheet.styles = parsed.styles;
    sheets.push(sheet);
  }
  return { sheets };
}

/** Style of a cell, null when unknown or when the workbook was read without styles. */
export function styleAt(sheet: Sheet, row: number, col: number): CellStyle | null {
  return sheet.styles?.[row]?.[col] ?? null;
}

/** True for an ARGB/RGB string that is pure red, the colour the sheets use for estimates. */
export function isRed(rgb: string | undefined): boolean {
  return rgb !== undefined && rgb.slice(-6).toUpperCase() === "FF0000";
}

/** Sheet by exact name, or by case-insensitive trimmed match. */
export function sheetByName(wb: Workbook, name: string): Sheet | undefined {
  return wb.sheets.find((s) => s.name === name) ?? wb.sheets.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
}

export interface HeaderOptions {
  /** Header texts that must all be present (exact, trimmed). */
  require?: string[];
  /** Header texts of which at least one must be present. */
  any?: string[];
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
    if (o.any && !o.any.some((k) => columns.has(k))) continue;
    if (!best || texts.length > best.score) best = { rowIndex: r, columns, score: texts.length };
  }
  return best ? { rowIndex: best.rowIndex, columns: best.columns } : null;
}

/** Cell as trimmed string, empty for null. */
export function cellText(v: CellValue): string {
  return v === null ? "" : String(v).trim();
}

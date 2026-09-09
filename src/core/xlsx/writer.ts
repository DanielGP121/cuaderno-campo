/**
 * Minimal .xlsx writer: inline strings, numbers, booleans and ISO dates, no external
 * library. Same approach as the croquis-campo exporter, which Excel opens without a
 * repair prompt. A cell can carry a font colour, a fill and bold, because the group's
 * flowering sheets mean things with colour (red = estimated, grey = not phenotyped)
 * and the export has to look like the file they already use.
 */
import { zipSync, strToU8 } from "fflate";
import { columnLetters, isoToSerial } from "./reader";

export type PlainCell = string | number | boolean | null | undefined | { date: string } | { percent: number };

/** A value with its looks: ARGB colours as Excel writes them ("FFFF0000"). */
export interface StyledCell {
  v: PlainCell;
  fontRgb?: string;
  fillRgb?: string;
  bold?: boolean;
}

export type OutCell = PlainCell | StyledCell;

export interface OutSheet {
  name: string;
  rows: OutCell[][];
  /** Column widths in characters, by 0-based index (optional). */
  widths?: Record<number, number>;
  /** Freeze the first N rows (optional); those rows are written bold. */
  freezeRows?: number;
}

const NUMFMT_DATE = 164;
const NUMFMT_DATETIME = 22;
const NUMFMT_PERCENT = 10;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Excel sheet names: max 31 chars, none of : \ / ? * [ ] */
export function safeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, "_").slice(0, 31) || "Hoja";
}

function isStyled(v: OutCell): v is StyledCell {
  return typeof v === "object" && v !== null && "v" in v;
}

function normaliseRgb(rgb: string): string {
  const hex = rgb.replace(/^#/, "").toUpperCase();
  return hex.length === 6 ? `FF${hex}` : hex;
}

/**
 * Registry of the fonts, fills and cell formats a workbook uses, numbered as they
 * appear. Index 0 of each table is the default Excel expects.
 */
class StyleBook {
  private fonts: string[] = [`<font><sz val="11"/><name val="Calibri"/></font>`];
  private fills: string[] = [`<fill><patternFill patternType="none"/></fill>`, `<fill><patternFill patternType="gray125"/></fill>`];
  private xfs: string[] = [`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`];
  private fontIds = new Map<string, number>([["|", 0]]);
  private fillIds = new Map<string, number>([["", 0]]);
  private xfIds = new Map<string, number>([["0|0|0", 0]]);

  private font(bold: boolean, rgb: string | undefined): number {
    const key = `${bold ? "b" : ""}|${rgb ?? ""}`;
    let id = this.fontIds.get(key);
    if (id === undefined) {
      id = this.fonts.length;
      this.fonts.push(`<font>${bold ? "<b/>" : ""}<sz val="11"/>${rgb ? `<color rgb="${normaliseRgb(rgb)}"/>` : ""}<name val="Calibri"/></font>`);
      this.fontIds.set(key, id);
    }
    return id;
  }

  private fill(rgb: string | undefined): number {
    if (!rgb) return 0;
    const key = normaliseRgb(rgb);
    let id = this.fillIds.get(key);
    if (id === undefined) {
      id = this.fills.length;
      this.fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="${key}"/><bgColor indexed="64"/></patternFill></fill>`);
      this.fillIds.set(key, id);
    }
    return id;
  }

  /** Index of the cell format for this combination, creating it on first use. */
  xf(numFmtId: number, bold: boolean, fontRgb: string | undefined, fillRgb: string | undefined): number {
    const fontId = this.font(bold, fontRgb);
    const fillId = this.fill(fillRgb);
    const key = `${numFmtId}|${fontId}|${fillId}`;
    let id = this.xfIds.get(key);
    if (id === undefined) {
      id = this.xfs.length;
      const apply = `${numFmtId ? ' applyNumberFormat="1"' : ""}${fontId ? ' applyFont="1"' : ""}${fillId ? ' applyFill="1"' : ""}`;
      this.xfs.push(`<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0"${apply}/>`);
      this.xfIds.set(key, id);
    }
    return id;
  }

  toXml(): string {
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<numFmts count="1"><numFmt numFmtId="${NUMFMT_DATE}" formatCode="yyyy-mm-dd"/></numFmts>` +
      `<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join("")}</fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`
    );
  }
}

function cellXml(ref: string, cell: OutCell, headerRow: boolean, book: StyleBook): string {
  const styled = isStyled(cell);
  const v: PlainCell = styled ? cell.v : cell;
  const bold = headerRow || (styled && cell.bold === true);
  const fontRgb = styled ? cell.fontRgb : undefined;
  const fillRgb = styled ? cell.fillRgb : undefined;
  const style = (numFmt: number) => {
    const id = book.xf(numFmt, bold, fontRgb, fillRgb);
    return id ? ` s="${id}"` : "";
  };
  if (v === null || v === undefined || v === "") {
    // an empty cell still carries its fill (a greyed row stays grey)
    return fillRgb ? `<c r="${ref}"${style(0)}/>` : "";
  }
  if (typeof v === "number") return Number.isFinite(v) ? `<c r="${ref}"${style(0)}><v>${v}</v></c>` : "";
  if (typeof v === "boolean") return `<c r="${ref}" t="b"${style(0)}><v>${v ? 1 : 0}</v></c>`;
  if (typeof v === "string") return `<c r="${ref}" t="inlineStr"${style(0)}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  if ("date" in v) {
    const numFmt = v.date.length > 10 ? NUMFMT_DATETIME : NUMFMT_DATE;
    return `<c r="${ref}"${style(numFmt)}><v>${isoToSerial(v.date)}</v></c>`;
  }
  if ("percent" in v) return Number.isFinite(v.percent) ? `<c r="${ref}"${style(NUMFMT_PERCENT)}><v>${v.percent}</v></c>` : "";
  return "";
}

function sheetXml(sheet: OutSheet, book: StyleBook): string {
  const freeze = sheet.freezeRows ?? 0;
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row.map((v, c) => cellXml(`${columnLetters(c)}${r + 1}`, v, r < freeze, book)).join("");
      return cells ? `<row r="${r + 1}">${cells}</row>` : "";
    })
    .join("");
  const cols = sheet.widths
    ? `<cols>${Object.entries(sheet.widths)
        .map(([i, w]) => `<col min="${Number(i) + 1}" max="${Number(i) + 1}" width="${w}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";
  const pane = freeze > 0
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

/** Build the .xlsx bytes. */
export function writeWorkbook(sheets: OutSheet[]): Uint8Array {
  const names = sheets.map((s) => safeSheetName(s.name));
  const book = new StyleBook();
  const sheetXmls = sheets.map((s) => sheetXml(s, book));
  const files: Record<string, Uint8Array> = {};
  files["[Content_Types].xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      `</Types>`,
  );
  files["_rels/.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
  );
  files["xl/workbook.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
      `</workbook>`,
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
  );
  files["xl/styles.xml"] = strToU8(book.toXml());
  sheetXmls.forEach((xml, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(xml);
  });
  return zipSync(files, { level: 6 });
}

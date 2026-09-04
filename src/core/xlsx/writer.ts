/**
 * Minimal .xlsx writer: inline strings, numbers, booleans and ISO dates, one style
 * for dates and one for percentages, no external library. Same approach as the
 * croquis-campo exporter, which Excel opens without a repair prompt.
 */
import { zipSync, strToU8 } from "fflate";
import { columnLetters, isoToSerial } from "./reader";

export type OutCell = string | number | boolean | null | undefined | { date: string } | { percent: number };

export interface OutSheet {
  name: string;
  rows: OutCell[][];
  /** Column widths in characters, by 0-based index (optional). */
  widths?: Record<number, number>;
  /** Freeze the first N rows (optional). */
  freezeRows?: number;
}

const STYLE_DATE = 1;
const STYLE_DATETIME = 2;
const STYLE_PERCENT = 3;
const STYLE_BOLD = 4;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Excel sheet names: max 31 chars, none of : \ / ? * [ ] */
export function safeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, "_").slice(0, 31) || "Hoja";
}

function cellXml(ref: string, v: OutCell, rowIndex: number, freezeRows: number): string {
  const bold = rowIndex < freezeRows ? ` s="${STYLE_BOLD}"` : "";
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return Number.isFinite(v) ? `<c r="${ref}"${bold}><v>${v}</v></c>` : "";
  if (typeof v === "boolean") return `<c r="${ref}" t="b"${bold}><v>${v ? 1 : 0}</v></c>`;
  if (typeof v === "string") return `<c r="${ref}" t="inlineStr"${bold}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  if ("date" in v) {
    const style = v.date.length > 10 ? STYLE_DATETIME : STYLE_DATE;
    return `<c r="${ref}" s="${style}"><v>${isoToSerial(v.date)}</v></c>`;
  }
  if ("percent" in v) return Number.isFinite(v.percent) ? `<c r="${ref}" s="${STYLE_PERCENT}"><v>${v.percent}</v></c>` : "";
  return "";
}

function sheetXml(sheet: OutSheet): string {
  const freeze = sheet.freezeRows ?? 0;
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row.map((v, c) => cellXml(`${columnLetters(c)}${r + 1}`, v, r, freeze)).join("");
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

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="22" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Build the .xlsx bytes. */
export function writeWorkbook(sheets: OutSheet[]): Uint8Array {
  const names = sheets.map((s) => safeSheetName(s.name));
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
  files["xl/styles.xml"] = strToU8(STYLES_XML);
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });
  return zipSync(files, { level: 6 });
}

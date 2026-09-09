/**
 * Importer for the hand-drawn plot maps of the EEAD and CITA peach collections
 * (`Melocotonero_2025_planos_DRON_RGS.xlsx`: one sheet per plot, drawn in Excel for
 * the 2026 drone flights). Each sheet follows its own dialect:
 *
 *  - collection sheets (J4, J5): three lines per row: variety names merged over the
 *    two or three columns of their trees, one symbol per tree (`·` present, `×`
 *    missing, `·?` doubtful) and an identity line with `MID_n` (MOSAIC code) at the
 *    first column of the variety and the bank register at the last; the column is the
 *    position, so an undrawn column inside a variety is an empty position;
 *  - EUFRIN trial (L8): a guard tree at each end, blocks of three trees, rootstock
 *    fillers annotated in metres; the position is the ordinal of the drawn trees;
 *  - CITA collection (1.4): rows named by letters, positions numbered on a header row
 *    (54 down to 1, two per accession), a tree icon anchored on each living tree;
 *  - prospection plot (7-1): positions numbered in pairs per cell, marks `0`/`x`/`X`,
 *    then up to five identity lines for the accessions sampled by MOSAIC.
 *
 * Why it matters: the maps are the only record of where every tree of the collection
 * stands, MOSAIC or not. The layouts they yield draw the field screen and seed the
 * grid fitted over the orthophoto, and the MOSAIC codes tie each position to the
 * flowering and forcing records of that tree.
 */
import { positionName, statusFromMark, treeUnitsFromLayout, type LayoutPosition, type LayoutRow, type PlotLayout, type PositionKind, type TreeStatusValue } from "../layout";
import { ulid } from "../ids";
import type { ObservationUnit } from "../types";
import { cellText, parseRange, readWorkbook, type CellRange, type CellValue, type Sheet } from "../xlsx/reader";

export interface PlotMapImport {
  layouts: PlotLayout[];
  trees: ObservationUnit[];
  warnings: string[];
}

export interface PlotMapOptions {
  /** Plot name to use per sheet name, overriding what the map says. */
  plotNames?: Record<string, string>;
  /** Recorded in `source.file` of every layout. */
  fileName?: string;
}

// ------------------------------------------------------------------ cell helpers

function cellAt(sheet: Sheet, r: number, c: number): CellValue {
  return sheet.rows[r]?.[c] ?? null;
}

function textAt(sheet: Sheet, r: number, c: number): string {
  return cellText(cellAt(sheet, r, c));
}

function mergesOf(sheet: Sheet): CellRange[] {
  return sheet.merges.map(parseRange);
}

function spanAt(merges: CellRange[], r: number, c: number): CellRange | null {
  return merges.find((m) => r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1) ?? null;
}

function filaNumber(v: CellValue): string | null {
  const m = /^\s*FILA\s*(\d+)\s*$/i.exec(cellText(v));
  return m ? m[1]! : null;
}

function isInteger(v: CellValue): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

/** `MID_68`, `MOSAIC_ID_92` or a bare code number -> "68", "92". */
function mosaicCode(v: CellValue): string | null {
  const t = cellText(v);
  const m = /^(?:MOSAIC_ID|MID)[_\s-]*(\d+)$/i.exec(t);
  return m ? String(Number(m[1])) : null;
}

const LANDMARK_WORDS = /^(CAMINO|RIEGO|CASA|PASILLO|N|S|E|O|NORTE|SUR|ESTE|OESTE|BALSA|CAMINO\s+CENTRAL)$/i;

interface Meta {
  planted?: string;
  spacingRaw?: string;
  rootstock?: string;
  plotLabel?: string;
  landmarks: string[];
  notes: string[];
}

/** Read the labels the maps carry around the rows: planting date, frame, rootstock, plot, landmarks. */
function readMetaCell(v: CellValue, side: string, meta: Meta): boolean {
  const t = cellText(v);
  if (!t) return false;
  let m: RegExpExecArray | null;
  if ((m = /^Plantad[oa]s?\s*:\s*(.+)$/i.exec(t))) meta.planted = m[1]!.trim();
  else if ((m = /^Plantaci[oó]n\s*:?\s*(.*)$/i.exec(t))) {
    if (m[1]!.trim()) meta.planted = m[1]!.trim();
  } else if ((m = /^Marco(?:\s+de\s+plantaci[oó]n)?\s*:\s*(.+)$/i.exec(t))) meta.spacingRaw = m[1]!.trim();
  else if ((m = /^Patr[oó]n\s*:\s*(.+)$/i.exec(t))) meta.rootstock = m[1]!.trim();
  else if ((m = /^Parcela\s*:\s*(.+)$/i.exec(t))) meta.plotLabel = m[1]!.trim();
  else if (LANDMARK_WORDS.test(t.replace(/\s+/g, " "))) meta.landmarks.push(`${t.replace(/\s+/g, " ").toUpperCase()} (${side})`);
  else if (/marco de plantaci[oó]n/i.test(t)) {
    // "nº parcela: 7-1     Marco de plantación: 5 x 3"
    const mm = /Marco de plantaci[oó]n\s*:\s*([\dx ,.]+)/i.exec(t);
    if (mm) meta.spacingRaw = mm[1]!.trim();
    meta.notes.push(t.replace(/\s+/g, " "));
  } else meta.notes.push(t.replace(/\s+/g, " "));
  return true;
}

/** "J5-6 y 7" -> "J5"; "L8" -> "L8"; anything else verbatim. */
function plotFromLabel(label: string): string {
  const m = /([A-Z]{1,2}\s?\d+)/.exec(label.toUpperCase());
  return m ? m[1]!.replace(/\s+/g, "") : label.trim();
}

function newLayout(plot: string, sheet: Sheet, meta: Meta, opts: PlotMapOptions): PlotLayout {
  const layout: PlotLayout = { id: ulid(), plot, rows: [], landmarks: [...new Set(meta.landmarks)], notes: [...new Set(meta.notes)], source: { sheet: sheet.name } };
  if (opts.fileName) layout.source.file = opts.fileName;
  if (meta.spacingRaw) layout.spacingRaw = meta.spacingRaw;
  if (meta.rootstock) layout.rootstock = meta.rootstock;
  if (meta.planted) layout.planted = meta.planted;
  return layout;
}

function addPosition(row: LayoutRow, p: LayoutPosition): void {
  row.positions.push(p);
}

// ------------------------------------------------------------ dialect detection

function sheetHas(sheet: Sheet, test: (t: string) => boolean, maxRows = 200): boolean {
  for (let r = 0; r < Math.min(sheet.rows.length, maxRows); r++) for (const v of sheet.rows[r] ?? []) if (v !== null && test(cellText(v))) return true;
  return false;
}

const PAIR_MARK = /^\s*([0xX])\s+([0xX]|pat)\s*$/;

/**
 * A cell numbering two neighbouring positions ("54  53", "   1        2"): two
 * positive integers one apart. Marks such as "0 0" are not a header.
 */
function pairHeader(v: CellValue): [number, number] | null {
  const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(cellText(v));
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a > 0 && b > 0 && Math.abs(a - b) === 1 ? [a, b] : null;
}

export type PlotMapDialect = "prospection" | "cita-collection" | "eufrin" | "collection" | "unknown";

/** Which drawing convention a sheet follows, from its content rather than its name. */
export function detectDialect(sheet: Sheet): PlotMapDialect {
  if (sheetHas(sheet, (t) => /PROSPECCI/i.test(t)) || sheet.rows.some((row) => row.filter((v) => PAIR_MARK.test(cellText(v))).length >= 3)) return "prospection";
  const hasLetters = sheet.rows.some((row) => row.slice(0, 4).some((v) => /^[A-Z]$/.test(cellText(v))));
  const hasPairHeader = sheet.rows.some((row) => row.filter((v) => pairHeader(v) !== null).length >= 3);
  if (hasLetters && hasPairHeader) return "cita-collection";
  if (sheetHas(sheet, (t) => /^MOSAIC_ID_\d+$/i.test(t))) return "eufrin";
  if (sheetHas(sheet, (t) => filaNumber(t) !== null)) return "collection";
  return "unknown";
}

// ---------------------------------------------------------- collection (J4, J5)

interface FilaBlock {
  filas: { r: number; c: number; name: string }[];
  /** First and last row of the FILA lines themselves. */
  rStart: number;
  rEnd: number;
  /** Rows the block owns for its margin labels: up to the previous and next blocks. */
  rTop: number;
  rBottom: number;
}

/**
 * Split the FILA labels of a sheet into plots: the numbers decrease down the drawing
 * inside a plot (17 ... 1), so a number larger than the previous one starts a new plot.
 * Each block owns the rows between its neighbours, where the plot label, frame,
 * rootstock and landmarks are written.
 */
function filaBlocks(sheet: Sheet): FilaBlock[] {
  const filas: { r: number; c: number; name: string }[] = [];
  sheet.rows.forEach((row, r) => {
    row.forEach((v, c) => {
      const n = filaNumber(v);
      if (n !== null) filas.push({ r, c, name: n });
    });
  });
  filas.sort((a, b) => a.r - b.r);
  const blocks: FilaBlock[] = [];
  for (const f of filas) {
    const last = blocks[blocks.length - 1];
    const prev = last ? Number(last.filas[last.filas.length - 1]!.name) : Number.NEGATIVE_INFINITY;
    if (!last || Number(f.name) > prev) blocks.push({ filas: [f], rStart: f.r, rEnd: f.r + 2, rTop: 0, rBottom: sheet.rows.length - 1 });
    else {
      last.filas.push(f);
      last.rEnd = f.r + 2;
    }
  }
  blocks.forEach((b, i) => {
    const prev = blocks[i - 1];
    const next = blocks[i + 1];
    b.rTop = prev ? prev.rEnd + 1 : 0;
    b.rBottom = next ? next.rStart - 1 : sheet.rows.length - 1;
  });
  return blocks;
}

/** Labels written in the margins of a block of rows, with the side they sit on. */
function blockMeta(sheet: Sheet, merges: CellRange[], block: FilaBlock, origin: number, rightEdge: number): Meta {
  const meta: Meta = { landmarks: [], notes: [] };
  const seen = new Set<string>();
  sheet.rows.forEach((row, r) => {
    row.forEach((v, c) => {
      if (v === null || cellText(v) === "") return;
      const span = spanAt(merges, r, c);
      const r0 = span ? span.r0 : r;
      const r1 = span ? span.r1 : r;
      if (r1 < block.rTop || r0 > block.rBottom) return;
      const isMargin = c < origin || c > rightEdge || r < block.rStart || r > block.rEnd || (span !== null && span.r1 - span.r0 >= 2);
      const isFilaLabel = filaNumber(v) !== null;
      if (!isMargin || isFilaLabel) return;
      const key = `${r},${c}`;
      if (seen.has(key)) return;
      seen.add(key);
      const side = c < origin ? "izquierda" : c > rightEdge ? "derecha" : r < block.rStart ? "arriba" : r > block.rEnd ? "abajo" : "dentro";
      readMetaCell(v, side, meta);
    });
  });
  return meta;
}

/**
 * Identity cells of a variety span: `MID_n` anywhere, a register (>= 1000, or any
 * value in the last column) and a bare code in the first column. The maps put the
 * code first and the register last, but a two-column variety with a single register
 * can carry it in either cell.
 */
function identityOfSpan(sheet: Sheet, r: number, c0: number, c1: number): { code?: string; register?: string } {
  const out: { code?: string; register?: string } = {};
  for (let c = c0; c <= c1; c++) {
    const v = cellAt(sheet, r, c);
    if (v === null || cellText(v) === "") continue;
    const code = mosaicCode(v);
    if (code !== null && !isInteger(v)) {
      out.code = code;
      continue;
    }
    if (isInteger(v)) {
      if (v >= 1000 || c === c1 || c1 === c0) out.register = String(v);
      else if (c === c0) out.code = String(v);
      else out.register = String(v);
      continue;
    }
    const t = cellText(v);
    if (/^[A-Z]?\d{2,5}\s*[A-Z]{0,3}$/i.test(t) || /^[A-Z]\d+\/\d+$/i.test(t)) out.register = t;
  }
  return out;
}

function parseCollectionSheet(sheet: Sheet, opts: PlotMapOptions, warnings: string[]): PlotLayout[] {
  const merges = mergesOf(sheet);
  const out: PlotLayout[] = [];
  for (const block of filaBlocks(sheet)) {
    const origin = block.filas[0]!.c + 1;
    const rows: LayoutRow[] = [];
    let rightEdge = origin;
    block.filas.forEach((fila, order) => {
      const rNames = fila.r;
      const rSyms = fila.r + 1;
      const rIds = fila.r + 2;
      // Variety spans on the names line: a merged cell covers the trees of a variety;
      // tall merges are margins (RIEGO), not varieties.
      const names: { c0: number; c1: number; label: string }[] = [];
      const nameRow = sheet.rows[rNames] ?? [];
      for (let c = origin; c < nameRow.length; c++) {
        const t = textAt(sheet, rNames, c);
        if (!t) continue;
        const span = spanAt(merges, rNames, c);
        if (span && span.r1 - span.r0 >= 2) continue;
        if (span && span.c0 !== c) continue;
        if (filaNumber(t) !== null) continue;
        names.push({ c0: c, c1: span ? span.c1 : c, label: t });
      }
      const symRow = sheet.rows[rSyms] ?? [];
      let lastSym = origin - 1;
      for (let c = symRow.length - 1; c >= origin; c--) {
        if (cellText(symRow[c] ?? null) !== "") {
          lastSym = c;
          break;
        }
      }
      const edge = Math.max(lastSym, ...names.map((n) => n.c1));
      if (edge < origin) {
        warnings.push(`${sheet.name}: FILA ${fila.name} has no trees drawn`);
        return;
      }
      rightEdge = Math.max(rightEdge, edge);
      const row: LayoutRow = { name: fila.name, order, positions: [], numberingLeftToRight: true };
      for (let c = origin; c <= edge; c++) {
        const position = c - origin + 1;
        const name = names.find((n) => c >= n.c0 && c <= n.c1);
        const tokens = textAt(sheet, rSyms, c).split(/\s+/).filter(Boolean);
        const mark = tokens[0];
        if (tokens.length > 1) warnings.push(`${sheet.name}: FILA ${fila.name} position ${position} holds ${tokens.length} symbols in one cell (${tokens.join(" ")}); the first one is used`);
        const p: LayoutPosition = { position, kind: mark ? "tree" : "empty" };
        if (name) {
          p.label = name.label;
          p.blockIndex = c - name.c0 + 1;
          p.blockSize = name.c1 - name.c0 + 1;
          const id = identityOfSpan(sheet, rIds, name.c0, name.c1);
          if (id.code) p.cultivarCode = id.code;
          if (id.register) p.accessionNumber = id.register;
        }
        if (mark) {
          p.mark = mark;
          const status = statusFromMark(mark);
          if (status) p.status = status;
          else warnings.push(`${sheet.name}: FILA ${fila.name} position ${position}: unknown symbol "${mark}"`);
        } else p.status = "unchecked";
        addPosition(row, p);
      }
      rows.push(row);
    });
    const meta = blockMeta(sheet, merges, block, origin, rightEdge);
    const plot = opts.plotNames?.[sheet.name] ?? (meta.plotLabel ? plotFromLabel(meta.plotLabel) : sheet.name);
    if (meta.plotLabel) meta.notes.unshift(`Parcela: ${meta.plotLabel}`);
    const layout = newLayout(plot, sheet, meta, opts);
    layout.rows = rows;
    out.push(layout);
  }
  return out;
}

// ------------------------------------------------------------------ EUFRIN (L8)

function parseEufrinSheet(sheet: Sheet, opts: PlotMapOptions, warnings: string[]): PlotLayout[] {
  const merges = mergesOf(sheet);
  const blocks = filaBlocks(sheet);
  const out: PlotLayout[] = [];
  for (const block of blocks) {
    const origin = block.filas[0]!.c + 1;
    const rows: LayoutRow[] = [];
    let rightEdge = origin;
    block.filas.forEach((fila, order) => {
      const rNames = fila.r;
      const rSyms = fila.r + 1;
      const rIds = fila.r + 2;
      const nameRow = sheet.rows[rNames] ?? [];
      const names: { c0: number; label: string }[] = [];
      const notes: { c: number; text: string }[] = [];
      for (let c = origin; c < nameRow.length; c++) {
        const t = textAt(sheet, rNames, c);
        if (!t) continue;
        const span = spanAt(merges, rNames, c);
        if (span && span.r1 - span.r0 >= 2) continue;
        if (/^\d+\s*m$/i.test(t)) {
          notes.push({ c, text: t });
          continue;
        }
        names.push({ c0: c, label: t });
      }
      names.sort((a, b) => a.c0 - b.c0);
      const symCols: number[] = [];
      const symRow = sheet.rows[rSyms] ?? [];
      for (let c = origin; c < symRow.length; c++) if (cellText(symRow[c] ?? null) !== "") symCols.push(c);
      if (symCols.length === 0) {
        warnings.push(`${sheet.name}: FILA ${fila.name} has no trees drawn`);
        return;
      }
      rightEdge = Math.max(rightEdge, symCols[symCols.length - 1]!);
      const row: LayoutRow = { name: fila.name, order, positions: [], numberingLeftToRight: true };
      // A block runs from a name cell to the column before the next name cell.
      const blockOf = (c: number) => {
        let idx = -1;
        for (let i = 0; i < names.length; i++) if (names[i]!.c0 <= c) idx = i;
        return idx;
      };
      const blockCols = new Map<number, number[]>();
      symCols.forEach((c) => {
        const b = blockOf(c);
        blockCols.set(b, [...(blockCols.get(b) ?? []), c]);
      });
      symCols.forEach((c, i) => {
        const position = i + 1;
        const b = blockOf(c);
        const name = b >= 0 ? names[b] : undefined;
        const mark = textAt(sheet, rSyms, c).split(/\s+/)[0] ?? "·";
        const isEnd = i === 0 || i === symCols.length - 1;
        let label = name?.label;
        let kind: PositionKind = "tree";
        const attributes: Record<string, string | number | boolean> = {};
        if (label) {
          const m = /^(.*?)\s*\((\d+)\)\s*$/.exec(label);
          if (m) {
            label = m[1]!.trim();
            attributes["eufrinNumber"] = Number(m[2]);
          }
        }
        if (isEnd) kind = "guard";
        else if (label && /^GF\s*-?\s*677$/i.test(label)) kind = "filler";
        const p: LayoutPosition = { position, kind, mark };
        if (label) p.label = label;
        const status = statusFromMark(mark);
        if (status) p.status = status;
        if (name) {
          const cols = blockCols.get(b) ?? [];
          p.blockIndex = cols.indexOf(c) + 1;
          p.blockSize = cols.length;
          const next = names[b + 1];
          const c1 = next ? next.c0 - 1 : rightEdge;
          for (let cc = name.c0; cc <= c1; cc++) {
            const code = mosaicCode(cellAt(sheet, rIds, cc));
            if (code !== null) p.cultivarCode = code;
          }
        }
        const note = notes.find((n) => n.c === c);
        if (note) p.note = note.text;
        if (Object.keys(attributes).length) p.attributes = attributes;
        addPosition(row, p);
      });
      rows.push(row);
    });
    const meta = blockMeta(sheet, merges, block, origin, rightEdge);
    const plot = opts.plotNames?.[sheet.name] ?? (meta.plotLabel ? plotFromLabel(meta.plotLabel) : sheet.name);
    if (meta.plotLabel) meta.notes.unshift(`Parcela: ${meta.plotLabel}`);
    const layout = newLayout(plot, sheet, meta, opts);
    layout.rows = rows;
    inferCodesByLabel(layout);
    out.push(layout);
  }
  return out;
}

/**
 * A guard tree of the trial is a tree of a cultivar planted in the plot (BIG TOP
 * closes the row that holds the BIG TOP block), and the flowering list counts it
 * under the block's MOSAIC code. The map only writes the code on the block, so a
 * position without code takes the code of the same label elsewhere in the plot.
 */
function inferCodesByLabel(layout: PlotLayout): void {
  const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const codes = new Map<string, string>();
  for (const row of layout.rows) for (const p of row.positions) if (p.label && p.cultivarCode && !codes.has(key(p.label))) codes.set(key(p.label), p.cultivarCode);
  for (const row of layout.rows) {
    for (const p of row.positions) {
      if (p.cultivarCode || !p.label) continue;
      const code = codes.get(key(p.label));
      if (!code) continue;
      p.cultivarCode = code;
      p.attributes = { ...(p.attributes ?? {}), codeInferred: true };
    }
  }
}

// ------------------------------------------------------- CITA collection (1.4)

function parseCitaCollectionSheet(sheet: Sheet, opts: PlotMapOptions, warnings: string[]): PlotLayout[] {
  // header of position pairs: "54  53" at the first column of each three-column block
  let headerRow = -1;
  const blocks: { c: number; first: number; second: number }[] = [];
  sheet.rows.forEach((row, r) => {
    if (headerRow >= 0) return;
    const found: { c: number; first: number; second: number }[] = [];
    row.forEach((v, c) => {
      const pair = pairHeader(v);
      if (pair) found.push({ c, first: pair[0], second: pair[1] });
    });
    if (found.length >= 3) {
      headerRow = r;
      blocks.push(...found);
    }
  });
  if (headerRow < 0) {
    warnings.push(`${sheet.name}: no row of numbered position pairs found`);
    return [];
  }
  const letterRows: { r: number; name: string }[] = [];
  sheet.rows.forEach((row, r) => {
    if (r <= headerRow) return;
    row.slice(0, 4).forEach((v) => {
      if (/^[A-Z]$/.test(cellText(v))) letterRows.push({ r, name: cellText(v) });
    });
  });
  if (letterRows.length === 0) {
    warnings.push(`${sheet.name}: no rows named by a letter found`);
    return [];
  }
  const iconCols = new Map<number, Set<number>>();
  for (const pic of sheet.pictures) iconCols.set(pic.row, new Set([...(iconCols.get(pic.row) ?? []), pic.col]));
  const rows: LayoutRow[] = [];
  letterRows.forEach((lr, order) => {
    const icons = iconCols.get(lr.r) ?? new Set<number>();
    const rAcc = lr.r + 1;
    const rName = lr.r + 2;
    const rName2 = lr.r + 3;
    const row: LayoutRow = { name: lr.name, order, positions: [], numberingLeftToRight: false };
    for (const b of blocks) {
      const register = textAt(sheet, rAcc, b.c);
      const parts: string[] = [];
      let code: string | null = null;
      for (const rr of [rName, rName2]) {
        for (let c = b.c; c <= b.c + 2; c++) {
          const t = textAt(sheet, rr, c);
          if (!t) continue;
          const mc = mosaicCode(t);
          if (mc !== null) code = mc;
          else if (c < b.c + 2 || rr === rName2) parts.push(t);
        }
      }
      const label = parts.join(" ").replace(/\s+/g, " ").trim();
      [b.first, b.second].forEach((position, k) => {
        const c = b.c + k;
        const present = icons.has(c);
        const p: LayoutPosition = { position, kind: "tree", mark: present ? "icon" : "", status: present ? "alive" : "missing", blockIndex: k + 1, blockSize: 2 };
        if (label) p.label = label;
        if (register) p.accessionNumber = register;
        if (code) p.cultivarCode = code;
        addPosition(row, p);
      });
    }
    row.positions.sort((a, b) => a.position - b.position);
    rows.push(row);
  });
  if (sheet.pictures.length === 0) warnings.push(`${sheet.name}: the sheet has no tree icons, every position is reported as missing`);
  const meta: Meta = { landmarks: [], notes: [] };
  let plot = opts.plotNames?.[sheet.name];
  sheet.rows.forEach((row, r) => {
    row.forEach((v, c) => {
      const t = cellText(v);
      if (!t) return;
      const m = /PARCELA\s+(\d+)\s*[-.]\s*(\d+)/i.exec(t);
      if (m) {
        if (!plot) plot = `${m[1]}.${m[2]}`;
        meta.notes.push(t.replace(/\s+/g, " "));
        return;
      }
      if (r <= headerRow && pairHeader(v) === null) {
        readMetaCell(v, "arriba", meta);
        return;
      }
      if (LANDMARK_WORDS.test(t)) {
        const lastBlock = blocks[blocks.length - 1]!;
        readMetaCell(v, c > lastBlock.c + 2 ? "derecha" : "izquierda", meta);
      }
    });
  });
  if (sheet.pictures.some((p) => p.row === 0)) meta.landmarks.push("rosa de los vientos (arriba derecha)");
  const layout = newLayout(plot ?? sheet.name, sheet, meta, opts);
  layout.site = "CITA";
  layout.rows = rows;
  return [layout];
}

// ------------------------------------------------------------- prospection (7-1)

function parseProspectionSheet(sheet: Sheet, opts: PlotMapOptions, warnings: string[]): PlotLayout[] {
  const filas: { r: number; name: string }[] = [];
  sheet.rows.forEach((row, r) => {
    const n = filaNumber(row[0] ?? null);
    if (n !== null) filas.push({ r, name: n });
  });
  if (filas.length === 0) {
    warnings.push(`${sheet.name}: no FILA labels in the first column`);
    return [];
  }
  const rows: LayoutRow[] = [];
  let lastHeader: Map<number, [number, number]> | null = null;
  filas.forEach((fila, order) => {
    const end = filas[order + 1]?.r ?? sheet.rows.length;
    let header: Map<number, [number, number]> | null = null;
    let marksRow = -1;
    for (let r = fila.r; r < end; r++) {
      const row = sheet.rows[r] ?? [];
      const pairs = new Map<number, [number, number]>();
      row.forEach((v, c) => {
        const pair = pairHeader(v);
        if (pair) pairs.set(c, pair);
      });
      if (pairs.size >= 3 && !header) header = pairs;
      const marks = row.filter((v) => PAIR_MARK.test(cellText(v))).length;
      if (marks >= 2 && marksRow < 0) marksRow = r;
      if (header && marksRow >= 0) break;
    }
    if (header) lastHeader = header;
    if (marksRow < 0) {
      warnings.push(`${sheet.name}: FILA ${fila.name} has no marks row`);
      return;
    }
    const row: LayoutRow = { name: fila.name, order, positions: [], numberingLeftToRight: true };
    const marksLine = sheet.rows[marksRow] ?? [];
    const positionsOf = (c: number): [number, number] => lastHeader?.get(c) ?? [2 * (c - 1) + 1, 2 * (c - 1) + 2];
    marksLine.forEach((v, c) => {
      const t = cellText(v);
      if (!t || c === 0) return;
      const tokens = t.split(/\s+/).filter(Boolean);
      const [first, second] = positionsOf(c);
      // identity lines below the marks: register (VS-071), species, locality, number, MID
      const identity: { register?: string; code?: string; species?: string; number?: number; texts: string[] } = { texts: [] };
      for (let r = marksRow + 1; r < Math.min(marksRow + 7, end); r++) {
        const iv = cellAt(sheet, r, c);
        if (iv === null || cellText(iv) === "") continue;
        const it = cellText(iv);
        const code = mosaicCode(iv);
        if (code !== null && !isInteger(iv)) identity.code = code;
        else if (/^VS[-.\s]?\d+/i.test(it)) identity.register = it.replace(/^VS[-.\s]?/i, "VS-");
        else if (isInteger(iv)) identity.number = iv;
        else if (/^(melocot[oó]n|nectarina|paraguayo|platerina)$/i.test(it)) identity.species = it;
        else identity.texts.push(it);
      }
      tokens.slice(0, 2).forEach((mark, k) => {
        const position = k === 0 ? first : second;
        const p: LayoutPosition = { position, kind: "tree", mark };
        // `0` is a tree; `x` and `X` are read as dead and missing until RGS confirms the legend
        // (question 3 of the 2026-09-09 email); `pat` is a rootstock left as a filler.
        if (mark === "0") p.status = "alive";
        else if (mark === "x") p.status = "dead";
        else if (mark === "X") p.status = "missing";
        else if (/^pat/i.test(mark)) {
          p.kind = "filler";
          p.label = "patrón";
        } else warnings.push(`${sheet.name}: FILA ${fila.name} position ${position}: unknown mark "${mark}"`);
        if (identity.register || identity.code) {
          p.blockIndex = k + 1;
          p.blockSize = Math.min(tokens.length, 2);
          const label = [...identity.texts, identity.number !== undefined ? String(identity.number) : ""].filter(Boolean).join(" ");
          if (label) p.label = label;
          if (identity.register) p.accessionNumber = identity.register;
          if (identity.code) p.cultivarCode = identity.code;
          const attributes: Record<string, string | number | boolean> = {};
          if (identity.species) attributes["species"] = identity.species;
          if (identity.number !== undefined) attributes["prospectionNumber"] = identity.number;
          if (Object.keys(attributes).length) p.attributes = attributes;
        }
        addPosition(row, p);
      });
    });
    rows.push(row);
  });
  const meta: Meta = { landmarks: [], notes: [] };
  const dates: string[] = [];
  const firstFila = filas[0]!.r;
  sheet.rows.forEach((row, r) => {
    row.forEach((v, c) => {
      const t = cellText(v);
      if (!t || filaNumber(v) !== null || pairHeader(v) !== null || PAIR_MARK.test(t)) return;
      if (r < firstFila) {
        if (/^\d{4}-\d{2}-\d{2}/.test(t)) dates.push(t.slice(0, 10));
        else readMetaCell(v, "arriba", meta);
      } else if (/^CAMINO/i.test(t)) {
        // a landmark written over two cells ("CAMINO" | "CENTRAL") is read as one
        const words = [t];
        for (let cc = c + 1; cc <= c + 2; cc++) {
          const more = textAt(sheet, r, cc);
          if (more) words.push(more);
        }
        meta.landmarks.push(`${words.join(" ").replace(/\s+/g, " ").toUpperCase()} (abajo)`);
      }
    });
  });
  if (dates.length) meta.planted = dates.join(" / ");
  const layout = newLayout(opts.plotNames?.[sheet.name] ?? "P II", sheet, meta, opts);
  layout.site = "CITA";
  layout.rows = rows;
  return [layout];
}

// ------------------------------------------------------------------ entry point

/** Parse already-read sheets (lets tests build sheets by hand). */
export function parsePlotMapSheets(sheets: Sheet[], opts: PlotMapOptions = {}): PlotMapImport {
  const out: PlotMapImport = { layouts: [], trees: [], warnings: [] };
  for (const sheet of sheets) {
    const dialect = detectDialect(sheet);
    let layouts: PlotLayout[] = [];
    if (dialect === "prospection") layouts = parseProspectionSheet(sheet, opts, out.warnings);
    else if (dialect === "cita-collection") layouts = parseCitaCollectionSheet(sheet, opts, out.warnings);
    else if (dialect === "eufrin") layouts = parseEufrinSheet(sheet, opts, out.warnings);
    else if (dialect === "collection") layouts = parseCollectionSheet(sheet, opts, out.warnings);
    else {
      out.warnings.push(`${sheet.name}: not a plot map, skipped`);
      continue;
    }
    for (const layout of layouts) {
      if (!layout.site && /^(J|L)\d+$/.test(layout.plot)) layout.site = "EEAD";
      out.layouts.push(layout);
      out.trees.push(...treeUnitsFromLayout(layout));
    }
  }
  return out;
}

/** Import every plot map of a workbook. */
export function importPlotMaps(bytes: Uint8Array, opts: PlotMapOptions = {}): PlotMapImport {
  return parsePlotMapSheets(readWorkbook(bytes).sheets, opts);
}

/** Name a position gets as a unit, exported for the cross-checks. */
export { positionName };

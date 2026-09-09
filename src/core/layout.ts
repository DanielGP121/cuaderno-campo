/**
 * Plot layouts: a plot as the group draws it in Excel, row by row, with numbered
 * positions. A variety spans two or three neighbouring positions (its replicate
 * trees), a guard tree closes each row of a trial, a stretch of rootstock fillers is
 * annotated in metres, and a position can be drawn empty. The layout is what the
 * field screen draws and what the affine grid over the orthophoto is fitted to; the
 * trees themselves are ObservationUnits that point back to their row and position.
 */
import { treeName, ulid } from "./ids";
import type { ObservationUnit } from "./types";

export type PositionKind = "tree" | "guard" | "filler" | "empty";

/** Survival status read from a map symbol; same vocabulary as TREE_STATUS in scales.ts. */
export type TreeStatusValue = "alive" | "doubtful" | "dead" | "missing" | "unchecked";

export interface LayoutPosition {
  /** 1-based number along the row, as the group numbers it (`Arbol`). */
  position: number;
  kind: PositionKind;
  /** Variety written on the map, or the rootstock for fillers and unnamed guards. */
  label?: string;
  /** MOSAIC cultivar code when the map carries `MID_n` or a bare code number. */
  cultivarCode?: string;
  /** Register written on the map ("3662", "5582", "A4/79", "VS-071"). */
  accessionNumber?: string;
  status?: TreeStatusValue;
  /** Symbol or mark exactly as drawn ("·", "×", "·?", "0", "x", "icon"). */
  mark?: string;
  note?: string;
  /** Place of the tree inside its variety block (1..blockSize), the map's replicate. */
  blockIndex?: number;
  blockSize?: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface LayoutRow {
  /** Row name as written ("8", "J"). */
  name: string;
  /** 0 for the row drawn at the top of the map. */
  order: number;
  positions: LayoutPosition[];
  /** True when position numbers grow from left to right on the drawing. */
  numberingLeftToRight: boolean;
  notes?: string[];
}

export interface PlotLayout {
  id: string;
  /** Plot name as the flowering lists use it ("J5", "L8", "1.4", "P II"). */
  plot: string;
  site?: string;
  rows: LayoutRow[];
  /** Planting frame as written ("5 x 4"); the map does not say which axis is which. */
  spacingRaw?: string;
  rootstock?: string;
  planted?: string;
  /** Things drawn around the rows that orient the map ("CAMINO (izquierda)", "N (arriba)"). */
  landmarks: string[];
  notes: string[];
  source: { sheet: string; file?: string };
}

const MARK_STATUS: Record<string, TreeStatusValue> = {
  "·": "alive",
  "•": "alive",
  icon: "alive",
  "·?": "doubtful",
  "•?": "doubtful",
  "×?": "doubtful",
  "×": "missing",
  x: "missing",
};

/** Status for the symbols of the EEAD collection maps; null for anything else. */
export function statusFromMark(mark: string): TreeStatusValue | null {
  return MARK_STATUS[mark.trim()] ?? null;
}

/**
 * Unit name of a position: `J5-F15-A004` for numbered rows (croquis-campo style),
 * `1.4-FJ-A054` when the row is a letter as in the CITA collection.
 */
export function positionName(plot: string, rowName: string, position: number): string {
  const n = Number(rowName);
  if (Number.isInteger(n) && rowName.trim() !== "") return treeName(plot, n, position);
  return `${plot}-F${rowName.trim()}-A${String(position).padStart(3, "0")}`;
}

export function rowByName(layout: PlotLayout, name: string): LayoutRow | undefined {
  const key = name.trim().toLowerCase();
  return layout.rows.find((r) => r.name.trim().toLowerCase() === key);
}

export function positionAt(layout: PlotLayout, rowName: string, position: number): LayoutPosition | undefined {
  return rowByName(layout, rowName)?.positions.find((p) => p.position === position);
}

/**
 * Visiting order: rows from the top of the map downwards, positions along each row
 * as drawn, alternating direction (serpentine) so nobody walks back along an empty row.
 */
export function walkOrder(layout: PlotLayout, serpentine = true): { row: LayoutRow; position: LayoutPosition }[] {
  const out: { row: LayoutRow; position: LayoutPosition }[] = [];
  const rows = [...layout.rows].sort((a, b) => a.order - b.order);
  rows.forEach((row, i) => {
    const drawn = [...row.positions].sort((a, b) => (row.numberingLeftToRight ? a.position - b.position : b.position - a.position));
    const seq = serpentine && i % 2 === 1 ? drawn.reverse() : drawn;
    for (const position of seq) out.push({ row, position });
  });
  return out;
}

/**
 * One unit per drawn position, empty holes included: a hole is a planting position
 * that a census can see replanted. Positions keep their row, number, map status and
 * identity so that the flowering and forcing records can be matched to them.
 */
export function treeUnitsFromLayout(layout: PlotLayout): ObservationUnit[] {
  const out: ObservationUnit[] = [];
  for (const row of layout.rows) {
    const rowN = Number(row.name);
    for (const p of row.positions) {
      const attributes: Record<string, string | number | boolean | null> = { layoutId: layout.id, layoutKind: p.kind, rowLabel: row.name };
      if (p.status) attributes["mapStatus"] = p.status;
      if (p.mark) attributes["mapMark"] = p.mark;
      if (p.note) attributes["mapNote"] = p.note;
      if (p.blockIndex !== undefined) attributes["blockIndex"] = p.blockIndex;
      if (p.blockSize !== undefined) attributes["blockSize"] = p.blockSize;
      if (p.attributes) for (const [k, v] of Object.entries(p.attributes)) attributes[k] = v;
      const unit: ObservationUnit = {
        id: ulid(),
        name: positionName(layout.plot, row.name, p.position),
        level: "tree",
        plot: layout.plot,
        position: p.position,
        rowLabel: row.name,
        attributes,
      };
      if (Number.isInteger(rowN) && row.name.trim() !== "") unit.row = rowN;
      if (layout.site) unit.site = layout.site;
      if (p.label) unit.accession = p.label;
      if (p.accessionNumber) unit.accessionNumber = p.accessionNumber;
      if (p.cultivarCode) unit.cultivarCode = p.cultivarCode;
      out.push(unit);
    }
  }
  return out;
}

export interface LayoutCounts {
  rows: number;
  positions: number;
  withMosaicCode: number;
  byKind: Record<string, number>;
  byStatus: Record<string, number>;
}

/** Counts a layout: how many positions, how many carry a MOSAIC code, status breakdown. */
export function layoutCounts(layout: PlotLayout): LayoutCounts {
  const out: LayoutCounts = { rows: layout.rows.length, positions: 0, withMosaicCode: 0, byKind: {}, byStatus: {} };
  for (const row of layout.rows) {
    for (const p of row.positions) {
      out.positions++;
      if (p.cultivarCode) out.withMosaicCode++;
      out.byKind[p.kind] = (out.byKind[p.kind] ?? 0) + 1;
      const s = p.status ?? "unchecked";
      out.byStatus[s] = (out.byStatus[s] ?? 0) + 1;
    }
  }
  return out;
}

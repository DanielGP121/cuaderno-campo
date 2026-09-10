/**
 * A small made-up collection to try the app without any real workbook: twelve trees
 * on two rows of one plot, seven of them reference trees and three in the early
 * group, drawn on a map with one missing position, and a flowering history of two
 * visits. Names and numbers are invented; nothing here comes from a real collection.
 */
import { ulid } from "@core/ids";
import { positionName, treeUnitsFromLayout, type LayoutPosition, type PlotLayout } from "@core/layout";
import type { FloweringImport } from "@core/importers/mosaicFlowering";
import type { PlotMapImport } from "@core/importers/plotMapRgs";
import { parseStageLabel } from "@core/phenology";
import type { Observation, ObservationUnit } from "@core/types";

const DEMO_PLOT = "D1";

const DEMO: [code: string, accession: string, row: number, position: number, reference: boolean, early: boolean, reps: number][] = [
  ["1", "Demo Blanca", 1, 1, true, false, 3],
  ["2", "Demo Roja Temprana", 1, 2, true, true, 3],
  ["3", "Demo Amarilla", 1, 3, false, false, 1],
  ["4", "Demo Paraguayo", 1, 4, true, false, 3],
  ["5", "Demo Nectarina", 1, 5, false, false, 1],
  ["6", "Demo Tardía", 1, 6, true, false, 3],
  ["7", "Demo Precoz", 2, 1, true, true, 3],
  ["8", "Demo Plano", 2, 2, false, false, 1],
  ["9", "Demo Calanda", 2, 3, true, false, 1],
  ["10", "Demo Maluenda", 2, 4, false, false, 1],
  ["11", "Demo Miraflores", 2, 5, true, true, 3],
  ["12", "Demo Sudanell", 2, 6, false, false, 1],
];

export function demoTrees(): ObservationUnit[] {
  return DEMO.map(([code, accession, row, position, reference, early, reps]) => {
    const u: ObservationUnit = {
      id: ulid(),
      name: positionName(DEMO_PLOT, String(row), position),
      level: "tree",
      cultivarCode: code,
      accession,
      accessionNumber: `${1000 + Number(code)} DM`,
      origin: "Demo",
      plot: DEMO_PLOT,
      row,
      rowLabel: String(row),
      position,
      isReference: reference,
      attributes: { replicates: reps, demo: true },
    };
    if (early) u.earlyGroup = true;
    return u;
  });
}

/** The demo plot as a map: two rows of six, a guard at the end of row 2, one missing tree. */
export function demoLayout(): PlotLayout {
  const layout: PlotLayout = {
    id: ulid(),
    plot: DEMO_PLOT,
    site: "Demo",
    rows: [],
    spacingRaw: "5 x 4",
    rootstock: "GF677",
    planted: "2020",
    landmarks: ["CAMINO (izquierda)"],
    notes: ["Parcela inventada para probar la app"],
    source: { sheet: "demo" },
  };
  for (const row of [1, 2]) {
    const positions: LayoutPosition[] = DEMO.filter((d) => d[2] === row).map(([code, accession, , position]) => ({
      position,
      kind: "tree" as const,
      label: accession,
      cultivarCode: code,
      accessionNumber: `${1000 + Number(code)} DM`,
      status: (code === "10" ? "missing" : "alive") as "missing" | "alive",
      mark: code === "10" ? "×" : "·",
    }));
    if (row === 2) positions.push({ position: 7, kind: "guard", label: "GF677", status: "alive", mark: "·" });
    layout.rows.push({ name: String(row), order: row - 1, positions, numberingLeftToRight: true });
  }
  return layout;
}

export function demoPlotMap(): PlotMapImport {
  const layout = demoLayout();
  return { layouts: [layout], trees: treeUnitsFromLayout(layout), warnings: [] };
}

/**
 * Two visits of a past season on the demo trees: a field visit and a drone flight a
 * week later, with the early group ahead of the rest. `trees` are the units as the
 * store holds them, so the observations point at the right ids.
 */
export function demoFlowering(trees: ObservationUnit[]): FloweringImport {
  const visits = [
    { sheet: DEMO_PLOT, date: "2026-03-02" },
    { sheet: DEMO_PLOT, date: "2026-03-09", flight: "DRON 9 Mar", temperature: "16,7-7,1" },
  ];
  const observations: Observation[] = [];
  for (const t of trees) {
    if (t.plot !== DEMO_PLOT || !t.cultivarCode) continue;
    const early = t.earlyGroup === true;
    const labels: [string, string][] = early ? [["2026-03-02", "F50"], ["2026-03-09", "F95-C10"]] : [["2026-03-02", "DE-F1"], ["2026-03-09", "F30"]];
    for (const [date, raw] of labels) {
      const p = parseStageLabel(raw)!;
      const o: Observation = {
        id: ulid(),
        unitId: t.id,
        variableId: "flowerStageLabel",
        value: { open: p.open, fall: p.fall },
        observationTimeStamp: `${date}T12:00:00Z`,
        deviceId: "import:xlsx",
        note: [p.pre ? `pre:${p.pre}` : "", `raw:${raw}`, date === "2026-03-09" ? "flight:DRON 9 Mar" : ""].filter(Boolean).join(";"),
      };
      observations.push(o);
    }
  }
  return {
    trees: [],
    observations,
    reported: [],
    events: [{ sheet: DEMO_PLOT, label: "PODA 24 Feb", date: "2026-02-24", flight: false }, { sheet: DEMO_PLOT, label: "DRON 9 Mar", date: "2026-03-09", flight: true }],
    visits,
    unparsed: [],
    treeEvents: [],
    warnings: [],
  };
}

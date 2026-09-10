/**
 * Writes the synthetic workbooks under tests/fixtures/: made-up data in the exact
 * layouts of the group's files, so that every importer runs on any clone without the
 * real workbooks (which never enter the repo). Regenerate with `npm run fixtures`
 * after changing a layout; the fixture tests assert what is written here.
 *
 *  - plot_maps.xlsx: the collection, EUFRIN and prospection map dialects (the CITA
 *    dialect needs anchored pictures the writer cannot produce; it stays in memory);
 *  - flowering_flights.xlsx: the sheet by drone flight, colours included;
 *  - flowering_list.xlsx: the list by visit, one sheet per plot;
 *  - sampling_registry.xlsx: the tree registry sheet;
 *  - forcing_workbook.xlsx: a per-sampling forcing workbook made with the exporter.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ulid } from "../src/core/ids";
import { planSampling, tubesAsUnits } from "../src/core/sampling";
import { exportForcingWorkbook, type ForcingDataset } from "../src/core/exporters/forcingWorkbook";
import type { Observation, ObservationUnit } from "../src/core/types";
import { writeWorkbook, type OutCell, type OutSheet } from "../src/core/xlsx/writer";
import { collectionSheet, eufrinSheet, prospectionSheet } from "../tests/helpers/syntheticMaps";

const OUT = resolve(process.cwd(), "tests/fixtures");
mkdirSync(OUT, { recursive: true });

const RED = "FFFF0000";
const GREY = "FFD9D9D9";
const DARK_GREY = "FFA6A6A6";
const PINK = "FFFFCCFF";
const YELLOW = "FFFFFF00";

function save(name: string, sheets: OutSheet[]): void {
  const bytes = writeWorkbook(sheets);
  writeFileSync(resolve(OUT, name), bytes);
  console.log(`${name}: ${sheets.length} sheet(s), ${(bytes.length / 1024).toFixed(1)} KB`);
}

// ---------------------------------------------------------------- plot maps

save(
  "plot_maps.xlsx",
  [collectionSheet, eufrinSheet, prospectionSheet].map((s) => ({ name: s.name, rows: s.rows as OutCell[][], merges: s.merges })),
);

// ---------------------------------------------------------------- flowering by flight

/** The made-up MOSAIC roster: code, accession, register, plot, row, position, replicate. */
const ROSTER: [code: string, accession: string, register: string, plot: string, row: string, position: number, rep: number][] = [
  ["1", "Summerdemo", "3801 AD", "J4", "8", 1, 1],
  ["1", "Summerdemo", "3801 AD", "J4", "8", 2, 2],
  ["1", "Summerdemo", "3801 AD", "J4", "8", 3, 3],
  ["4", "Montedemo", "3148 AD", "J4", "8", 16, 1],
  ["68", "Royal Demo", "3662 AD", "J5", "15", 4, 1],
  ["68", "Royal Demo", "3662 AD", "J5", "15", 5, 2],
  ["68", "Royal Demo", "3662 AD", "J5", "15", 6, 3],
  ["92", "Ambra Demo", "VS-001", "L8", "5", 2, 1],
  ["160", "Mid Demo", "5120", "1.4", "J", 1, 1],
  ["160", "Mid Demo", "5120", "1.4", "J", 2, 2],
  ["187", "Prospe Demo", "VS-071", "P II", "5", 9, 1],
  ["178", "Loose Demo", "5590", "?", "?", 0, 1],
];

const FLIGHTS = [
  ["DRON 17 Feb", "2026-02-17", "16,1-6,1"],
  ["DRON 2 Mar", "2026-03-02", "17,3-2,4"],
  ["DRON 9 Mar", "2026-03-09", "16,7-7,1"],
] as const;

/** Labels per tree and flight; a second element marks the estimate in red, "Tratam" is an event word. */
type Flight = [label: string | null, estimated?: boolean];
const FLIGHT_LABELS: Record<string, Flight[]> = {
  "1|1": [["F0"], ["F10"], ["F50"]],
  "1|2": [["F0"], ["F10", true], ["F60"]],
  "1|3": [[null], [null], [null]],
  "4|1": [["F0"], ["F0"], ["F0"]],
  "68|1": [["DE-F1"], ["F30"], ["F95-C10"]],
  "68|2": [["DE-F1"], ["F40-F50"], ["C100-C20"]],
  "68|3": [["E"], ["F20", true], ["F90"]],
  "92|1": [["Tratam"], ["F80"], ["C30"]],
  "160|1": [["F0"], ["F10"], ["F50"]],
  "160|2": [["F0"], ["F10", true], ["F50", true]],
  "187|1": [["F0"], ["F0"], ["F5-10"]],
  "178|1": [["F0"], ["F10"], ["F50"]],
};

/** Typed dates F10..C90 per tree; "8,/3/2026" is the typo the real file has. */
const TYPED: Record<string, (string | null)[]> = {
  "1|1": ["2026-03-02", "2026-03-09", "2026-03-13", "2026-03-19", "2026-04-04"],
  "1|2": ["2026-03-02", "2026-03-09", "8,/3/2026", null, null],
  "68|1": ["2026-02-24", "2026-03-02", "2026-03-05", "2026-03-09", "2026-03-24"],
  "160|1": ["2026-03-02", "2026-03-09", null, null, null],
};

function num(v: string): OutCell {
  return /^\d+$/.test(v) ? Number(v) : v;
}

function plotCell(plot: string): OutCell {
  // the CITA plot "1-4" became a date in the real file; the fixture reproduces the artefact
  if (plot === "1.4") return { date: "2026-04-01" };
  return plot === "?" ? "?" : plot;
}

function flightSheet(): OutSheet {
  const identity = ["Cultivar_code", "Accession", "Accession number", "ID GWAS Mas-Gomez", "Origin", "Parcela", "Fila", "Arbol"];
  const descriptors = ["Density of flower buds 1,3,5,7,o,9", "Flower type C/R", "Petals_flower 5, >5"];
  const dates = ["F10_date", "F50_date", "F80_date", "C10_date", "C90_date"];
  const intervals = ["F10_F80_dias", "F10_C10_dias", "F10_C90_dias"];
  const header: OutCell[] = [...identity, ...descriptors, ...dates, ...intervals, ...FLIGHTS.map((f) => ({ v: f[0], fillRgb: YELLOW }))];
  const top: OutCell[] = ["* En color negro los datos fenotipados en ese dia, y en rojo los estimados"];
  while (top.length < header.length - FLIGHTS.length - 1) top.push(null);
  top.push({ v: "Tªmax-Tª min", fillRgb: "FF00FFFF" });
  for (const f of FLIGHTS) top.push(f[2]);
  const rows: OutCell[][] = [top, header];
  for (const [code, accession, register, plot, row, position, rep] of ROSTER) {
    const key = `${code}|${rep}`;
    const labels = FLIGHT_LABELS[key] ?? [];
    const notPhenotyped = labels.every((l) => l[0] === null);
    const dead = code === "4";
    const accFill = code === "68" ? PINK : code === "160" ? YELLOW : undefined;
    const rowStyle = notPhenotyped ? { fillRgb: GREY } : {};
    const cell = (v: OutCell, extra: { fillRgb?: string; fontRgb?: string } = {}): OutCell => {
      const style = { ...rowStyle, ...extra };
      return Object.keys(style).length ? { v: typeof v === "object" && v !== null && "v" in v ? v.v : v, ...style } : v;
    };
    const identityCells: OutCell[] = [
      num(code),
      cell(accession, accFill ? { fillRgb: accFill } : dead ? { fillRgb: DARK_GREY } : {}),
      cell(num(register), dead ? { fillRgb: DARK_GREY } : {}),
      cell(null, dead ? { fillRgb: DARK_GREY } : {}),
      cell(code === "160" || code === "187" ? "CITA" : "EEAD-CSIC", dead ? { fillRgb: DARK_GREY } : {}),
      plotCell(plot),
      row === "?" ? "?" : num(row),
      position > 0 ? position : null,
    ];
    const density = ["1", "3", "5", "7", "9"][Number(code) % 5]!;
    const typed = TYPED[key] ?? [null, null, null, null, null];
    const dateCell = (d: string | null): OutCell => (d === null ? cell(null) : /^\d{4}-\d{2}-\d{2}$/.test(d) ? cell({ date: d }) : cell(d));
    const line: OutCell[] = [
      ...identityCells,
      cell(Number(density)),
      cell(Number(code) % 2 ? "Rosette" : "Campanulate"),
      cell(Number(code) % 3 ? "5" : ">5"),
      ...typed.map(dateCell),
      cell(null),
      cell(null),
      cell(null),
    ];
    for (const [label, estimated] of labels) line.push(cell(label, estimated ? { fontRgb: RED } : {}));
    rows.push(line);
  }
  return { name: "MOSAIC_Ppersica_25 26", rows, freezeRows: 0 };
}

save("flowering_flights.xlsx", [flightSheet()]);

// ---------------------------------------------------------------- flowering by visit

const VISITS = ["2026-02-19", "2026-02-24", "2026-03-02", "2026-03-05", "2026-03-09", "2026-03-13", "2026-03-19", "2026-04-04"];
const VISIT_LABELS: Record<string, (string | null)[]> = {
  "1|1": ["F0", "Tratam", "E-F0", "F10", "F50", "F80-C", "F95-C10", "C90"],
  "1|2": ["F0", "Tratam", "F0", "F5-10", "F50", "F70", "F90-C", "C90"],
  "1|3": [null, null, null, null, null, null, null, null],
  "4|1": ["F0", null, "F0", "F0", "F0", "F0", "F0", "F0"],
  "68|1": ["DE-F1", "Tratam", "F30", "F60", "F95-C10", "C50", "C90", null],
  "160|1": ["F0", null, "F0", "F10", "F50", "F80", "C10", "C90"],
  "160|2": ["F0", null, "F0", "F10", "F50", "F80", "C10", "C90"],
};

function visitSheet(name: string, plots: string[]): OutSheet {
  const identity = ["Cultivar_code", "Accession", "Accession number", "ID GWAS Mas-Gomez", "Origin", "Parcela", "Fila", "Arbol", null, "Rep_Tree"];
  const dates = ["Fecha_F10", "Fecha_F50", "Fecha_F80", "Fecha_C10", "Fecha_C90", "F10_C10_dias", "F10_C90_dias"];
  // visit columns with the events of the season interleaved by date
  type Column = { kind: "visit"; date: string } | { kind: "event"; label: string };
  const columns: Column[] = [];
  for (const d of VISITS) {
    if (d === "2026-02-24") columns.push({ kind: "event", label: "PODA 24 feb" });
    if (d === "2026-03-02") columns.push({ kind: "event", label: "DRON 2 Mar" });
    columns.push({ kind: "visit", date: d });
  }
  const header: OutCell[] = [...identity, ...dates, ...columns.map((c) => (c.kind === "visit" ? { date: c.date } : c.label))];
  const top: OutCell[] = ["* En color negro los datos fenotipados en ese dia, y en rojo los estimados"];
  while (top.length < identity.length + dates.length - 1) top.push(null);
  top.push("Tªmax-Tª min");
  for (const c of columns) top.push(c.kind === "visit" && c.date === "2026-03-09" ? "16,7-7,1" : null);
  const rows: OutCell[][] = [top, header];
  for (const [code, accession, register, plot, row, position, rep] of ROSTER) {
    if (!plots.includes(plot)) continue;
    const labels = VISIT_LABELS[`${code}|${rep}`] ?? [];
    const line: OutCell[] = [num(code), accession, num(register), null, plot === "1.4" ? "CITA" : "EEAD-CSIC", plotCell(plot), num(row), position, code === "68" ? "Early" : null, rep];
    const typed = TYPED[`${code}|${rep}`] ?? [null, null, null, null, null];
    for (const d of typed) line.push(d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? { date: d } : d);
    line.push(null, null);
    let i = 0;
    for (const c of columns) {
      if (c.kind === "event") line.push(c.label === "DRON 2 Mar" ? (labels[2] ?? null) : null);
      else line.push(labels[i++] ?? null);
    }
    rows.push(line);
  }
  return { name, rows, freezeRows: 0 };
}

save("flowering_list.xlsx", [visitSheet("EEAD_J4-7_Melocotonero", ["J4", "J5", "L8"]), visitSheet("CITA_1-4_Melocotonero", ["1.4"])]);

// ---------------------------------------------------------------- tree registry

function registrySheet(): OutSheet {
  const header = ["ID MOSAIC", "Origin", "Referencia", "réplicas/muestreo", "Variedad", "Accession number", "Parcela", "Floración", "Maduración", "Muestreo_1", "Muestreo_2"];
  const rows: OutCell[][] = [["Registro de árboles (ejemplo)"], header];
  const seen = new Set<string>();
  for (const [code, accession, register, plot] of ROSTER) {
    if (seen.has(code) || code === "178") continue;
    seen.add(code);
    const reference = Number(code) % 2 === 1;
    rows.push([Number(code), plot === "1.4" || plot === "P II" ? "CITA" : "EEAD-CSIC", reference ? "Referencia" : null, reference ? 3 : 1, accession, register, plot, code === "68" ? "Temprana" : "Media", "Media", reference ? { date: "2025-11-13" } : null, reference ? { date: "2025-11-20" } : null]);
  }
  return { name: "Sampling", rows, freezeRows: 0 };
}

save("sampling_registry.xlsx", [{ name: "Portada", rows: [["Peach sampling (ejemplo)"]] }, registrySheet()]);

// ---------------------------------------------------------------- forcing workbook

function forcingWorkbook(): Uint8Array {
  const seen = new Set<string>();
  const trees: ObservationUnit[] = [];
  for (const [code, accession, register, plot] of ROSTER) {
    if (seen.has(code) || code === "178") continue;
    seen.add(code);
    const reference = Number(code) % 2 === 1;
    const t: ObservationUnit = { id: ulid(), name: code, level: "tree", cultivarCode: code, accession, accessionNumber: register, plot, isReference: reference, attributes: { replicates: reference ? 3 : 1 } };
    if (code === "68") t.earlyGroup = true;
    trees.push(t);
  }
  const s1 = planSampling(trees, { number: 1, kind: "full", cutDate: "2025-11-13", chillPortions: 10.9 });
  const s2 = planSampling(trees, { number: 2, kind: "full", cutDate: "2025-11-20", chillPortions: 15.2 });
  const tubes = [...tubesAsUnits(s1), ...tubesAsUnits(s2)];
  const observations: Observation[] = [];
  let k = 0;
  for (const tube of tubes) {
    const sampling = tube.attributes?.["samplingNumber"] === 1 ? s1.sampling : s2.sampling;
    const released = sampling.number === 1 ? 1 + (k % 3) : 4 + (k % 4);
    observations.push({
      id: ulid(),
      unitId: tube.id,
      variableId: "budStageCounts",
      value: { AorB: 10 - released, BC: Math.min(released, 2), C: Math.max(released - 2, 0), D: 0, E: 0, F: 0 },
      observationTimeStamp: `${sampling.cutDate.slice(0, 8)}${String(Number(sampling.cutDate.slice(8)) + 10).padStart(2, "0")}T10:00:00Z`,
      deviceId: "fixture",
      samplingId: sampling.id,
    });
    k++;
  }
  const ds: ForcingDataset = { trees, tubes, samplings: [s1.sampling, s2.sampling], observations };
  return exportForcingWorkbook(ds, { consolidatedName: "2025-2026" });
}

writeFileSync(resolve(OUT, "forcing_workbook.xlsx"), forcingWorkbook());
console.log("forcing_workbook.xlsx: written with the exporter");

/**
 * Reproduction test 2 of the construction plan: the 2025-2026 forcing season, as
 * recorded in the group's workbooks, must come out of the app's arithmetic exactly as
 * it came out of the R pipeline (`Analisis_cp50_v3.Rmd`). Runs only where the real
 * files exist (local.config.json); skips elsewhere.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cp50Linear, detectDrops, fractionReleased, type CurvePoint } from "@core/forcing";
import { datasetFromConsolidated, importConsolidatedCp, importForcingWorkbook } from "@core/importers/mosaicForcing";
import { exportForcingWorkbook } from "@core/exporters/forcingWorkbook";
import { parseCsv } from "./helpers/csv";
import { localPath, readLocalBytes } from "./helpers/local";

/** Manual exclusions the pipeline applies before CP50 (tree, sampling), plus tree 135 entirely. */
const EXCLUDED_PAIRS = new Set(["58:10", "113:9", "24:13", "125:13", "47:13", "84:10", "15:13", "14:13"]);
const EXCLUDED_TREES = new Set(["135"]);

interface TreeCurve {
  cultivarCode: string;
  accession: string;
  curve: CurvePoint[];
}

/** Mean of replicates per tree and sampling, as `df_means` does: NA rows dropped, cap at 1. */
function buildCurves(rows: ReturnType<typeof importConsolidatedCp>["rows"], applyExclusions: boolean): Map<string, TreeCurve> {
  const groups = new Map<string, { accession: string; cp: number; vals: number[] }>();
  for (const r of rows) {
    if (r.fractionReleased === null || r.cp === null) continue;
    if (applyExclusions && (EXCLUDED_TREES.has(r.cultivarCode) || EXCLUDED_PAIRS.has(`${r.cultivarCode}:${r.samplingNumber}`))) continue;
    const key = `${r.cultivarCode}:${r.samplingNumber}`;
    const g = groups.get(key) ?? { accession: r.accession, cp: r.cp, vals: [] };
    g.vals.push(Math.min(r.fractionReleased, 1));
    groups.set(key, g);
  }
  const curves = new Map<string, TreeCurve>();
  for (const [key, g] of groups) {
    const [code, samp] = key.split(":") as [string, string];
    const tc = curves.get(code) ?? { cultivarCode: code, accession: g.accession, curve: [] };
    tc.curve.push({ samplingNumber: Number(samp), cp: g.cp, fraction: g.vals.reduce((a, b) => a + b, 0) / g.vals.length });
    curves.set(code, tc);
  }
  return curves;
}

const consolidated = readLocalBytes("mosaic", "cp_data_def");
const resultsPath = localPath("mosaic", "cp50_results");
const dropsPath = localPath("mosaic", "descensos_curva");
const ready = Boolean(consolidated && resultsPath && dropsPath);

describe("reproduction 2: forcing season 2025-2026 (local only)", () => {
  it.skipIf(!ready)("CP50 linear per tree equals cp50_results.csv after the same exclusions", () => {
    const { rows } = importConsolidatedCp(consolidated!);
    expect(rows.length).toBeGreaterThan(1000);
    const curves = buildCurves(rows, true);
    const expected = parseCsv(readFileSync(resultsPath!, "utf-8"));
    expect(expected).toHaveLength(50);
    const mismatches: string[] = [];
    for (const e of expected) {
      const tc = curves.get(e["Cultivar_code"]!);
      if (!tc) {
        mismatches.push(`${e["Cultivar_code"]} missing`);
        continue;
      }
      const r = cp50Linear(tc.curve);
      const want = Number(e["CP50_linear"]);
      if (r.method !== e["method_linear"] || r.cp50 === null || Math.abs(r.cp50 - want) > 0.0051) {
        mismatches.push(`${e["Cultivar_code"]} ${e["Accession"]}: app ${r.method} ${r.cp50?.toFixed(3)} vs R ${e["method_linear"]} ${want}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it.skipIf(!ready)("CP50 before exclusions equals the pipeline's pre-exclusion values", () => {
    const beforeAfter = localPath("mosaic", "cp50_results")!.replace("cp50_results.csv", "cp50_before_after_exclusions.csv");
    const rows = importConsolidatedCp(consolidated!).rows;
    const curves = buildCurves(rows, false);
    const expected = parseCsv(readFileSync(beforeAfter, "utf-8"));
    const mismatches: string[] = [];
    for (const e of expected) {
      const r = cp50Linear(curves.get(e["Cultivar_code"]!)!.curve);
      const want = Number(e["CP50_linear_pre"]);
      if (r.cp50 === null || Math.abs(r.cp50 - want) > 0.0051) mismatches.push(`${e["Cultivar_code"]}: ${r.cp50?.toFixed(3)} vs ${want}`);
    }
    expect(mismatches).toEqual([]);
  });

  it.skipIf(!ready)("drops on the raw curves match descensos_curva.csv, tree by tree and with the same severity", () => {
    const rows = importConsolidatedCp(consolidated!).rows;
    const curves = buildCurves(rows, false);
    const expected = parseCsv(readFileSync(dropsPath!, "utf-8"));
    const wanted = new Map(expected.map((e) => [`${e["Cultivar_code"]}:${e["sampling_curr"]}`, e]));
    const found = new Map<string, { severity: string; delta: number }>();
    for (const tc of curves.values()) {
      for (const d of detectDrops(tc.curve)) found.set(`${tc.cultivarCode}:${d.to.samplingNumber}`, { severity: d.severity, delta: d.delta });
    }
    const missing = [...wanted.keys()].filter((k) => !found.has(k));
    const extra = [...found.keys()].filter((k) => !wanted.has(k));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    const severityMismatch = [...wanted.entries()]
      .filter(([k, e]) => found.get(k)!.severity !== e["severidad"] || Math.abs(found.get(k)!.delta - Number(e["delta_pct"])) > 0.0011)
      .map(([k, e]) => `${k}: app ${found.get(k)!.severity} ${found.get(k)!.delta.toFixed(3)} vs R ${e["severidad"]} ${e["delta_pct"]}`);
    expect(severityMismatch).toEqual([]);
  });
});

function cp50Mismatches(bytes: Uint8Array, tolerance = 0.0051): string[] {
  const back = importConsolidatedCp(bytes);
  const curves = buildCurves(back.rows.filter((r) => r.samplingNumber >= 6), true);
  const expected = parseCsv(readFileSync(resultsPath!, "utf-8"));
  const mismatches: string[] = [];
  for (const e of expected) {
    const tc = curves.get(e["Cultivar_code"]!);
    const r = tc ? cp50Linear(tc.curve) : null;
    const want = Number(e["CP50_linear"]);
    if (!r || r.cp50 === null || Math.abs(r.cp50 - want) > tolerance) mismatches.push(`${e["Cultivar_code"]} ${e["Accession"]}: ${r?.method} ${r?.cp50?.toFixed(3)} vs ${want}`);
  }
  return mismatches;
}

describe("round trip: season -> app -> exported workbook -> pipeline arithmetic (local only)", () => {
  it.skipIf(!ready)("consolidated sheet -> dataset -> export -> import gives the same 50 CP50 values exactly", () => {
    const ds = datasetFromConsolidated(importConsolidatedCp(consolidated!).rows);
    expect(ds.samplings.map((s) => s.number)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14]);
    const bytes = exportForcingWorkbook(ds, { consolidatedName: "2025-2026" });
    expect(importConsolidatedCp(bytes).sheet).toBe("2025-2026");
    expect(cp50Mismatches(bytes)).toEqual([]);
  });

  const workbook = readLocalBytes("mosaic", "breaking_dormancy");
  it.skipIf(!workbook || !ready)("per-sampling workbook -> export -> import reproduces the CP50 of every tree whose two source files agree", () => {
    const imp = importForcingWorkbook(workbook!);
    const bytes = exportForcingWorkbook(imp, { consolidatedName: "2025-2026" });
    // Counts carry full precision while the consolidated sheet rounds fractions to two
    // decimals, so CP50 can move by a few hundredths; beyond that, the two source files
    // disagree on eleven tubes (hand edits in one file only) and those trees differ.
    const mismatches = cp50Mismatches(bytes, 0.05);
    expect(mismatches.length, mismatches.join("\n")).toBeLessThanOrEqual(8);
  });
});

describe("per-sampling workbook vs consolidated sheet (local only)", () => {
  const workbook = readLocalBytes("mosaic", "breaking_dormancy");
  it.skipIf(!workbook || !consolidated)("bud counts give the same %Nb>BC the consolidated sheet stores", () => {
    const imp = importForcingWorkbook(workbook!);
    expect(imp.samplings.length).toBe(14);
    expect(imp.trees.length).toBeGreaterThan(40);
    const cons = importConsolidatedCp(consolidated!).rows;
    const consByTube = new Map(cons.map((r) => [`${r.cultivarCode}_${r.samplingNumber}_${r.rep}`, r]));
    const tubeById = new Map(imp.tubes.map((t) => [t.id, t]));
    let compared = 0;
    const mismatches: string[] = [];
    for (const o of imp.observations) {
      const tube = tubeById.get(o.unitId)!;
      const c = consByTube.get(tube.name);
      if (!c || c.fractionReleased === null) continue;
      const f = fractionReleased(o.value as never);
      if (f === null) continue;
      compared++;
      // The consolidated sheet stores the fraction rounded to two decimals.
      if (Math.abs(f - Math.min(c.fractionReleased, 1)) > 0.0051) mismatches.push(`${tube.name}: counts give ${f.toFixed(4)}, sheet has ${c.fractionReleased}`);
    }
    expect(compared).toBeGreaterThan(500);
    // Eleven tubes differ between the two files (hand edits in one of them, two >1
    // artefacts); the definition of %Nb>BC as buds beyond B-C over total holds elsewhere.
    expect(mismatches.length, mismatches.join("\n")).toBeLessThanOrEqual(Math.ceil(compared * 0.03));
  });
});

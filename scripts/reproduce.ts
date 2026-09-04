/**
 * Reproduction report against the real 2025-2026 workbooks (paths in local.config.json).
 * Prints, for the forcing season, how the app's arithmetic compares with the R
 * pipeline outputs, and for the flowering list, how the derived dates compare with the
 * typed ones. Run with `npm run reproduce`. Nothing here writes to the workbooks.
 */
import { existsSync, readFileSync } from "node:fs";
import { cp50Linear, detectDrops, type CurvePoint } from "../src/core/forcing";
import { datasetFromConsolidated, importConsolidatedCp, importForcingWorkbook } from "../src/core/importers/mosaicForcing";
import { importFloweringList } from "../src/core/importers/mosaicFlowering";
import { exportForcingWorkbook } from "../src/core/exporters/forcingWorkbook";
import { deriveDatesFromLabels } from "../src/core/phenology";

if (!existsSync("local.config.json")) {
  console.error("local.config.json not found: copy local.config.example.json and point it to the real workbooks.");
  process.exit(1);
}
const cfg = JSON.parse(readFileSync("local.config.json", "utf-8")) as { mosaic: Record<string, string> };
const bytes = (key: string) => (cfg.mosaic[key] && existsSync(cfg.mosaic[key]!) ? new Uint8Array(readFileSync(cfg.mosaic[key]!)) : null);

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const split = (l: string) => [...l.matchAll(/("([^"]*)"|[^,]*)(,|$)/g)].map((m) => (m[2] ?? m[1] ?? "").trim()).slice(0, -1);
  const header = split(lines[0]!);
  return lines.slice(1).map((l) => Object.fromEntries(header.map((h, i) => [h, split(l)[i] ?? ""])));
}

const consolidated = bytes("cp_data_def");
if (consolidated && cfg.mosaic["cp50_results"] && existsSync(cfg.mosaic["cp50_results"])) {
  const rows = importConsolidatedCp(consolidated).rows;
  const excludedPairs = new Set(["58:10", "113:9", "24:13", "125:13", "47:13", "84:10", "15:13", "14:13"]);
  const curves = new Map<string, CurvePoint[]>();
  const groups = new Map<string, { cp: number; vals: number[] }>();
  for (const r of rows) {
    if (r.fractionReleased === null || r.cp === null || r.cultivarCode === "135" || excludedPairs.has(`${r.cultivarCode}:${r.samplingNumber}`)) continue;
    const k = `${r.cultivarCode}:${r.samplingNumber}`;
    const g = groups.get(k) ?? { cp: r.cp, vals: [] };
    g.vals.push(Math.min(r.fractionReleased, 1));
    groups.set(k, g);
  }
  for (const [k, g] of groups) {
    const [code, s] = k.split(":") as [string, string];
    const list = curves.get(code) ?? [];
    list.push({ samplingNumber: Number(s), cp: g.cp, fraction: g.vals.reduce((a, b) => a + b, 0) / g.vals.length });
    curves.set(code, list);
  }
  const expected = parseCsv(readFileSync(cfg.mosaic["cp50_results"], "utf-8"));
  let ok = 0;
  const bad: string[] = [];
  for (const e of expected) {
    const r = cp50Linear(curves.get(e["Cultivar_code"]!) ?? []);
    if (r.cp50 !== null && Math.abs(r.cp50 - Number(e["CP50_linear"])) <= 0.0051) ok++;
    else bad.push(`${e["Cultivar_code"]} ${e["Accession"]}: ${r.method} ${r.cp50?.toFixed(3)} vs ${e["CP50_linear"]}`);
  }
  console.log(`CP50 linear: ${ok}/${expected.length} trees identical to cp50_results.csv`);
  for (const b of bad) console.log("  differs:", b);
  let drops = 0;
  for (const c of curves.values()) drops += detectDrops(c).length;
  console.log(`Drops detected on the post-exclusion curves: ${drops}`);
  const ds = datasetFromConsolidated(rows);
  const exported = exportForcingWorkbook(ds, { consolidatedName: "2025-2026" });
  console.log(`Exported workbook from the consolidated sheet: ${(exported.length / 1024).toFixed(0)} KB, ${ds.tubes.length} tubes, ${ds.observations.length} readings`);
}

const workbook = bytes("breaking_dormancy");
if (workbook) {
  const imp = importForcingWorkbook(workbook);
  console.log(`Per-sampling workbook: ${imp.samplings.length} samplings, ${imp.trees.length} trees, ${imp.tubes.length} tubes, ${imp.observations.length} readings (${imp.observations.filter((o) => o.variableId === "budStageCounts").length} with counts)`);
  for (const w of imp.warnings.slice(0, 5)) console.log("  warning:", w);
}

const flowering = bytes("flowering_list");
if (flowering) {
  const imp = importFloweringList(flowering);
  const byTree = new Map<string, { date: string; label: string }[]>();
  for (const o of imp.observations) {
    const list = byTree.get(o.unitId) ?? [];
    list.push({ date: o.observationTimeStamp.slice(0, 10), label: /raw:(.*)$/.exec(o.note ?? "")?.[1] ?? "" });
    byTree.set(o.unitId, list);
  }
  const stats: Record<string, { compared: number; exact: number; within3: number }> = {};
  for (const key of ["F10", "F50", "F80", "C10", "C90"] as const) {
    const s = { compared: 0, exact: 0, within3: 0 };
    for (const r of imp.reported) {
      const typed = r[key];
      const visits = byTree.get(r.treeId);
      if (!typed || !visits) continue;
      const d = deriveDatesFromLabels(visits).dates[key];
      if (!d) continue;
      s.compared++;
      const gap = Math.abs((Date.parse(d) - Date.parse(typed)) / 86_400_000);
      if (gap === 0) s.exact++;
      if (gap <= 3) s.within3++;
    }
    stats[key] = s;
  }
  console.log(`Flowering list: ${imp.trees.length} trees, ${imp.observations.length} visit labels, ${imp.unparsed.length} unparsed, ${imp.events.length} field events`);
  for (const [k, s] of Object.entries(stats)) console.log(`  ${k}: derived vs typed, ${s.exact}/${s.compared} exact, ${s.within3}/${s.compared} within 3 days`);
}

import { readFileSync } from "node:fs";
import { readWorkbook, findHeader } from "../src/core/xlsx/reader";
import { importForcingWorkbook } from "../src/core/importers/mosaicForcing";
const cfg = JSON.parse(readFileSync("local.config.json", "utf-8"));
const bytes = new Uint8Array(readFileSync(cfg.mosaic.breaking_dormancy));
const wb = readWorkbook(bytes);
for (const s of wb.sheets) {
  const h = findHeader(s, { require: ["CP", "Cultivar_code"], minCells: 8 });
  const keys = h ? [...h.columns.keys()] : [];
  console.log(s.name.padEnd(18), "rows", String(s.rows.length).padStart(5), "| header row", h?.rowIndex ?? "-", "| code col:", keys.find(k => /Sample(_\d+)?_code/i.test(k)) ?? "NONE", "| sampling col:", keys.find(k => /^(Sampling_number|SAMPLING)$/i.test(k)) ?? "NONE");
}
const imp = importForcingWorkbook(bytes);
console.log("\nsamplings:", imp.samplings.map(s => `${s.number}:${s.cutDate}:${s.treeIds.length}t`).join(" "));
console.log("trees:", imp.trees.length, "tubes:", imp.tubes.length, "observations:", imp.observations.length);
console.log("warnings:", imp.warnings.slice(0, 10));

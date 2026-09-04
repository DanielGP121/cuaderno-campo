import { readFileSync } from "node:fs";
import { readWorkbook, findHeader, sheetByName } from "../src/core/xlsx/reader";
const cfg = JSON.parse(readFileSync("local.config.json", "utf-8"));
const wb = readWorkbook(new Uint8Array(readFileSync(cfg.mosaic.breaking_dormancy)));
for (const name of ["1_Sampling", "8_Sampling", "12_Sampling"]) {
  const s = sheetByName(wb, name)!;
  const h = findHeader(s, { require: ["CP", "Cultivar_code"], minCells: 8 })!;
  const header = s.rows[h.rowIndex]!;
  console.log("\n== " + name + " header:", header.map((v, i) => `${i}:${v ?? "·"}`).join(" | "));
  const rows = s.rows.slice(h.rowIndex + 1);
  const empty = rows.find(r => r[0] && (r[17] === null || r[17] === undefined));
  const filled = rows.find(r => r[0] && typeof r[17] === "number");
  console.log("row without counts:", JSON.stringify(empty));
  console.log("row with counts:   ", JSON.stringify(filled));
  const withCounts = rows.filter(r => r[0] && typeof r[17] === "number").length;
  console.log("rows:", rows.filter(r => r[0]).length, "with Total_Nb_Buds:", withCounts);
}
const cons = readWorkbook(new Uint8Array(readFileSync(cfg.mosaic.cp_data_def)));
const c = cons.sheets[0]!;
const h = findHeader(c, { require: ["Cultivar_code"] })!;
console.log("\n== consolidated header:", c.rows[h.rowIndex]!.map((v, i) => `${i}:${v ?? "·"}`).join(" | "));
console.log("consolidated rows:", c.rows.length - h.rowIndex - 1, "| sampling numbers:", [...new Set(c.rows.slice(h.rowIndex + 1).map(r => r[4]))].join(","));

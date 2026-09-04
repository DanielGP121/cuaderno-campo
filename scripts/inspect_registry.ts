import { readFileSync } from "node:fs";
import { readWorkbook, findHeader, sheetByName } from "../src/core/xlsx/reader";
const cfg = JSON.parse(readFileSync("local.config.json", "utf-8"));
const wb = readWorkbook(new Uint8Array(readFileSync(cfg.mosaic.sampling_registry)));
console.log("sheets:", wb.sheets.map(s => `${s.name}(${s.rows.length})`).join(", "));
const s = sheetByName(wb, "Sampling")!;
const h = findHeader(s, { require: ["ID MOSAIC"] })!;
console.log("header row", h.rowIndex, ":", s.rows[h.rowIndex]!.map((v, i) => `${i}:${v ?? "·"}`).join(" | "));
for (const r of s.rows.slice(h.rowIndex + 1, h.rowIndex + 4)) console.log(JSON.stringify(r));
const fl = readWorkbook(new Uint8Array(readFileSync(cfg.mosaic.flowering_list)));
const f = sheetByName(fl, "EEAD_J4-7_Melocotonero")!;
const fh = findHeader(f, { require: ["Cultivar_code", "Fecha_F50"] })!;
console.log("\nflowering header:", f.rows[fh.rowIndex]!.map((v, i) => `${i}:${v ?? "·"}`).join(" | "));
console.log("rows:", f.rows.length - fh.rowIndex - 1);
for (const r of f.rows.slice(fh.rowIndex + 1, fh.rowIndex + 3)) console.log(JSON.stringify(r));
const stages = new Map<string, number>();
for (const r of f.rows.slice(fh.rowIndex + 1)) for (let i = 17; i < r.length; i++) { const v = r[i]; if (typeof v === "string") stages.set(v, (stages.get(v) ?? 0) + 1); }
console.log("stage labels used:", [...stages.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(" "));

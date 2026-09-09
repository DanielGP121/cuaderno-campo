import { readFileSync } from "node:fs";
import { columnLetters, readWorkbook, sheetByName } from "../src/core/xlsx/reader";
import { importPlotMaps } from "../src/core/importers/plotMapRgs";
import { layoutCounts } from "../src/core/layout";
const cfg = JSON.parse(readFileSync("local.config.json", "utf-8"));
const bytes = new Uint8Array(readFileSync(cfg.drones.plot_maps));
const wb = readWorkbook(bytes);
const s = sheetByName(wb, "coleccion EEAD")!;
for (const r of [2, 3, 4]) {
  const row = s.rows[r] ?? [];
  console.log(`row ${r + 1} (len ${row.length}):`, row.map((v, c) => (v === null || v === undefined ? null : `${columnLetters(c)}=${JSON.stringify(v)}`)).filter(Boolean).join(" "));
}
console.log("merges sample:", s.merges.slice(0, 12).join(","), "pictures:", s.pictures.length);
const cita = sheetByName(wb, "coleccion CITA")!;
console.log("CITA pictures:", cita.pictures.length, "rows with icons:", [...new Set(cita.pictures.map((p) => p.row))].sort((a, b) => a - b));
const imp = importPlotMaps(bytes);
for (const l of imp.layouts) {
  console.log(`\n${l.plot} (${l.source.sheet}) site=${l.site} planted=${l.planted} frame=${l.spacingRaw} rootstock=${l.rootstock}`);
  console.log("  landmarks:", l.landmarks.join(" | "), "\n  notes:", l.notes.join(" | "));
  console.log("  counts:", JSON.stringify(layoutCounts(l)));
  for (const row of l.rows.slice(0, 2)) console.log(`  FILA ${row.name}:`, row.positions.map((p) => `${p.position}${p.kind === "tree" ? "" : "(" + p.kind[0] + ")"}:${(p.label ?? "").slice(0, 8)}${p.cultivarCode ? "#" + p.cultivarCode : ""}${p.accessionNumber ? "/" + p.accessionNumber : ""}${p.mark ? " " + p.mark : ""}`).join(" | "));
}
console.log("\nwarnings:", imp.warnings.length, "\n" + imp.warnings.slice(0, 15).join("\n"));

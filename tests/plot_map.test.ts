import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layoutCounts, positionAt, walkOrder } from "@core/layout";
import { detectDialect, importPlotMaps, parsePlotMapSheets } from "@core/importers/plotMapRgs";
import { cellText, findHeader, readWorkbook } from "@core/xlsx/reader";
import { citaSheet, collectionSheet, eufrinSheet, prospectionSheet, sheet } from "./helpers/syntheticMaps";
import { localPath, readLocalBytes } from "./helpers/local";

describe("plot map dialects", () => {
  it("recognises each dialect from the content of the sheet", () => {
    expect(detectDialect(collectionSheet)).toBe("collection");
    expect(detectDialect(eufrinSheet)).toBe("eufrin");
    expect(detectDialect(citaSheet)).toBe("cita-collection");
    expect(detectDialect(prospectionSheet)).toBe("prospection");
    expect(detectDialect(sheet("UPOV", [[null, "texto"]]))).toBe("unknown");
  });

  it("reads an EEAD collection sheet: positions by column, symbols, identity, two plots", () => {
    const imp = parsePlotMapSheets([collectionSheet]);
    expect(imp.layouts.map((l) => l.plot)).toEqual(["J9", "K1"]);
    const j9 = imp.layouts[0]!;
    expect(j9.planted).toBe("1-1-2000");
    expect(j9.spacingRaw).toBe("5 x 4");
    expect(j9.landmarks).toContain("RIEGO (derecha)");
    expect(j9.rows.map((r) => r.name)).toEqual(["2", "1"]);
    const fila2 = j9.rows[0]!;
    expect(fila2.positions.length).toBe(7);
    expect(positionAt(j9, "2", 1)).toMatchObject({ label: "ALFA", status: "alive", accessionNumber: "1234", blockIndex: 1, blockSize: 2 });
    expect(positionAt(j9, "2", 2)).toMatchObject({ label: "ALFA", status: "doubtful", mark: "·?" });
    expect(positionAt(j9, "2", 3)).toMatchObject({ label: "BETA", status: "missing", cultivarCode: "7", accessionNumber: "2345" });
    expect(positionAt(j9, "2", 5)).toMatchObject({ label: "GAMMA", cultivarCode: "9", accessionNumber: "3456", status: "alive" });
    expect(positionAt(j9, "2", 6)).toMatchObject({ kind: "empty", status: "unchecked" });
    expect(positionAt(j9, "2", 7)).toMatchObject({ status: "alive", mark: "·" });
    expect(imp.warnings.some((w) => /2 symbols in one cell/.test(w))).toBe(true);
    expect(positionAt(j9, "1", 2)).toMatchObject({ label: "DELTA", cultivarCode: "12", accessionNumber: "4567", blockIndex: 2, blockSize: 3 });
    const k1 = imp.layouts[1]!;
    expect(positionAt(k1, "3", 2)).toMatchObject({ label: "OMEGA", status: "missing", cultivarCode: "20" });
    // units: one per position, named croquis-campo style, with the map status as attribute
    expect(imp.trees.length).toBe(13);
    const alfa1 = imp.trees.find((t) => t.name === "J9-F02-A001")!;
    expect(alfa1).toMatchObject({ plot: "J9", row: 2, position: 1, accession: "ALFA", accessionNumber: "1234", site: "EEAD" });
    expect(alfa1.attributes?.["mapStatus"]).toBe("alive");
  });

  it("reads a EUFRIN sheet: guards, blocks of three, fillers with metres, MOSAIC ids per block", () => {
    const imp = parsePlotMapSheets([eufrinSheet]);
    expect(imp.layouts.length).toBe(1);
    const l9 = imp.layouts[0]!;
    expect(l9.plot).toBe("L9");
    expect(l9.rootstock).toBe("GF677");
    expect(l9.landmarks).toContain("CASA (izquierda)");
    const row = l9.rows[0]!;
    expect(row.positions.length).toBe(11);
    expect(positionAt(l9, "1", 1)).toMatchObject({ kind: "guard", label: "BIG TOP", status: "alive" });
    expect(positionAt(l9, "1", 1)?.cultivarCode).toBeUndefined();
    expect(positionAt(l9, "1", 2)).toMatchObject({ kind: "tree", label: "ALFA", cultivarCode: "80", blockIndex: 1, blockSize: 3 });
    expect(positionAt(l9, "1", 2)?.attributes?.["eufrinNumber"]).toBe(1);
    expect(positionAt(l9, "1", 4)).toMatchObject({ label: "ALFA", cultivarCode: "80", blockIndex: 3 });
    expect(positionAt(l9, "1", 5)).toMatchObject({ kind: "filler", label: "GF677" });
    expect(positionAt(l9, "1", 6)).toMatchObject({ kind: "filler", note: "13m" });
    expect(positionAt(l9, "1", 8)).toMatchObject({ label: "BETA", cultivarCode: "81" });
    expect(positionAt(l9, "1", 11)).toMatchObject({ kind: "guard", label: "GLADYS" });
    expect(l9.notes.some((n) => /Arbol guarda/i.test(n))).toBe(true);
  });

  it("reads a CITA collection sheet: letters, pairs numbered right to left, icons as living trees", () => {
    const imp = parsePlotMapSheets([citaSheet]);
    const l = imp.layouts[0]!;
    expect(l.plot).toBe("1.4");
    expect(l.site).toBe("CITA");
    expect(l.rows.map((r) => r.name)).toEqual(["J", "I"]);
    expect(l.rows[0]!.numberingLeftToRight).toBe(false);
    expect(positionAt(l, "J", 6)).toMatchObject({ label: "Uno", cultivarCode: "101", accessionNumber: "5001", status: "alive", blockIndex: 1 });
    expect(positionAt(l, "J", 5)).toMatchObject({ label: "Uno", status: "alive", blockIndex: 2 });
    expect(positionAt(l, "J", 4)).toMatchObject({ label: "Dos bis", cultivarCode: "102", accessionNumber: "5002", status: "alive" });
    expect(positionAt(l, "J", 3)).toMatchObject({ status: "missing" });
    expect(positionAt(l, "J", 2)).toMatchObject({ label: "A4/79", accessionNumber: "A4/79", status: "alive" });
    expect(positionAt(l, "J", 1)).toMatchObject({ status: "missing" });
    expect(positionAt(l, "J", 1)?.cultivarCode).toBeUndefined();
    expect(positionAt(l, "I", 3)).toMatchObject({ label: "Cuatro", cultivarCode: "103", status: "alive" });
    expect(l.landmarks).toContain("PASILLO (derecha)");
    expect(l.landmarks).toContain("rosa de los vientos (arriba derecha)");
    const first = walkOrder(l)[0]!;
    expect([first.row.name, first.position.position]).toEqual(["J", 6]);
    expect(imp.trees.find((t) => t.name === "1.4-FJ-A006")).toMatchObject({ plot: "1.4", rowLabel: "J", position: 6, cultivarCode: "101" });
  });

  it("reads a prospection sheet: pairs per cell, marks, identity lines, planting dates", () => {
    const imp = parsePlotMapSheets([prospectionSheet]);
    const l = imp.layouts[0]!;
    expect(l.plot).toBe("P II");
    expect(l.spacingRaw).toBe("5 x 3");
    expect(l.planted).toBe("2006-01-18 / 2007-01-18");
    expect(l.landmarks).toContain("N (arriba)");
    expect(l.landmarks).toContain("CAMINO CENTRAL (abajo)");
    expect(l.rows.map((r) => r.name)).toEqual(["2", "1"]);
    expect(positionAt(l, "2", 1)).toMatchObject({ status: "missing", mark: "X" });
    expect(positionAt(l, "2", 3)).toMatchObject({ status: "alive", cultivarCode: "184", accessionNumber: "VS-045", label: "Alquezar 139", blockIndex: 1, blockSize: 2 });
    expect(positionAt(l, "2", 3)?.attributes).toMatchObject({ species: "Melocoton", prospectionNumber: 139 });
    expect(positionAt(l, "2", 4)).toMatchObject({ status: "dead", mark: "x", cultivarCode: "184" });
    expect(positionAt(l, "2", 5)).toMatchObject({ cultivarCode: "185", accessionNumber: "VS-046" });
    expect(positionAt(l, "1", 1)).toMatchObject({ status: "alive" });
    expect(positionAt(l, "1", 4)).toMatchObject({ kind: "filler", label: "patrón" });
    expect(positionAt(l, "1", 3)?.cultivarCode).toBeUndefined();
  });
});

describe("real plot maps of the 2026 flights (local only)", () => {
  const bytes = readLocalBytes("drones", "plot_maps");

  it.skipIf(!bytes)("imports the five plots with the names the flowering lists use", () => {
    const imp = importPlotMaps(bytes!, { fileName: "Melocotonero_2025_planos_DRON_RGS.xlsx" });
    expect(imp.layouts.map((l) => l.plot).sort()).toEqual(["1.4", "J4", "J5", "L8", "P II"]);
    for (const l of imp.layouts) console.log(`${l.plot}: ${JSON.stringify(layoutCounts(l))} planted=${l.planted ?? "-"} frame=${l.spacingRaw ?? "-"} rootstock=${l.rootstock ?? "-"} landmarks=${l.landmarks.join("; ")}`);
    console.log("warnings:", imp.warnings.length, imp.warnings.slice(0, 12).join("\n"));
    const j5 = imp.layouts.find((l) => l.plot === "J5")!;
    expect(j5.rows.length).toBe(17);
    expect(j5.rows[0]!.name).toBe("17");
    expect(positionAt(j5, "15", 4)).toMatchObject({ label: "ROYAL GLORY", cultivarCode: "68", accessionNumber: "3662", blockIndex: 1, blockSize: 3 });
    expect(positionAt(j5, "15", 6)).toMatchObject({ label: "ROYAL GLORY", cultivarCode: "68", blockIndex: 3 });
    expect(positionAt(j5, "15", 1)).toMatchObject({ label: "MAYCREST", accessionNumber: "3663" });
    expect(positionAt(j5, "15", 1)?.cultivarCode).toBeUndefined();
    expect(positionAt(j5, "17", 19)).toMatchObject({ label: "GROC GEBUT", cultivarCode: "79", accessionNumber: "3688" });
    expect(positionAt(j5, "17", 20)).toMatchObject({ label: "GROC GEBUT", cultivarCode: "79" });
    expect(positionAt(j5, "17", 21)).toBeUndefined();
    expect(j5.spacingRaw).toBe("5 x 4");
    expect(j5.rootstock).toBe("ADESOTO");
    expect(j5.planted).toBe("11-1-2005");
    expect(j5.landmarks).toContain("CAMINO (izquierda)");
    expect(j5.landmarks).toContain("RIEGO (derecha)");
    const j4 = imp.layouts.find((l) => l.plot === "J4")!;
    expect(j4.rows.map((r) => r.name)).toEqual(["10", "9", "8"]);
    expect(positionAt(j4, "8", 1)).toMatchObject({ label: "SUMMERGRAND", cultivarCode: "1", accessionNumber: "3801", status: "alive" });
    expect(positionAt(j4, "8", 2)).toMatchObject({ cultivarCode: "1", status: "missing" });
    expect(positionAt(j4, "8", 16)).toMatchObject({ label: "MONTAÑANA", cultivarCode: "4", accessionNumber: "3148" });
    expect(positionAt(j4, "9", 4)).toMatchObject({ label: "CHUCHO PICUDO", cultivarCode: "5", accessionNumber: "3575" });
    expect(positionAt(j4, "10", 1)).toMatchObject({ kind: "empty", status: "unchecked" });
    expect(j4.planted).toBe("2009-2013-2017");
    const l8 = imp.layouts.find((l) => l.plot === "L8")!;
    expect(l8.rows.map((r) => r.name)).toEqual(["5", "4", "3", "2", "1"]);
    expect(l8.rows.every((r) => r.positions.length === 14)).toBe(true);
    expect(positionAt(l8, "5", 1)).toMatchObject({ kind: "guard" });
    expect(positionAt(l8, "5", 2)).toMatchObject({ label: "AMBRA", cultivarCode: "92", blockIndex: 1, blockSize: 3 });
    expect(positionAt(l8, "5", 2)?.attributes?.["eufrinNumber"]).toBe(5);
    expect(positionAt(l8, "5", 5)).toMatchObject({ label: "VENUS", cultivarCode: "93" });
    expect(positionAt(l8, "5", 8)).toMatchObject({ label: "FLATSTAR", cultivarCode: "94" });
    expect(positionAt(l8, "5", 11)).toMatchObject({ label: "NECTAPERF" });
    expect(positionAt(l8, "5", 14)).toMatchObject({ kind: "guard", label: "GF 677" });
    // the guard BIG TOP has no code on the map; the flowering list counts it as tree 1 of code 81
    expect(positionAt(l8, "1", 1)).toMatchObject({ kind: "guard", label: "BIG TOP", cultivarCode: "81" });
    expect(positionAt(l8, "1", 1)?.attributes?.["codeInferred"]).toBe(true);
    expect(positionAt(l8, "1", 5)).toMatchObject({ label: "BIG TOP", cultivarCode: "81" });
    expect(positionAt(l8, "1", 5)?.attributes?.["codeInferred"]).toBeUndefined();
    expect(positionAt(l8, "3", 9)).toMatchObject({ kind: "filler", note: "13m" });
    expect(positionAt(l8, "2", 14)).toMatchObject({ kind: "guard", label: "GLADYS" });
    expect(l8.rootstock).toBe("GF677");
    expect(l8.landmarks).toContain("CASA (izquierda)");
    expect(l8.landmarks).toContain("CAMINO (derecha)");
    const cita = imp.layouts.find((l) => l.plot === "1.4")!;
    expect(cita.rows.map((r) => r.name)).toEqual(["J", "I", "H", "G", "F"]);
    expect(cita.rows.every((r) => r.positions.length === 54)).toBe(true);
    expect(cita.rows.map((r) => r.positions.filter((p) => p.status === "alive").length)).toEqual([49, 54, 54, 53, 50]);
    expect(positionAt(cita, "J", 1)).toMatchObject({ label: "Mid Gold", accessionNumber: "5120", cultivarCode: "160", status: "alive" });
    expect(positionAt(cita, "J", 54)).toMatchObject({ label: "Pavia Blanca", accessionNumber: "5582", cultivarCode: "177" });
    expect(positionAt(cita, "I", 46)?.label).toBe("Rojo de Tudela");
    expect(cita.landmarks).toContain("PASILLO (derecha)");
    const pii = imp.layouts.find((l) => l.plot === "P II")!;
    expect(pii.rows.map((r) => r.name)).toEqual(["5", "4", "3", "2", "1"]);
    expect(pii.spacingRaw).toBe("5 x 3");
    expect(positionAt(pii, "5", 9)).toMatchObject({ cultivarCode: "187", accessionNumber: "VS-071", status: "alive" });
    expect(positionAt(pii, "5", 10)).toMatchObject({ cultivarCode: "187", blockIndex: 2 });
    expect(positionAt(pii, "1", 29)).toMatchObject({ cultivarCode: "183", accessionNumber: "VS-096" });
    const codes = new Set(pii.rows.flatMap((r) => r.positions.map((p) => p.cultivarCode).filter(Boolean)));
    expect([...codes].sort()).toEqual(["180", "181", "182", "183", "184", "185", "186", "187", "188", "189", "190", "191"]);
  });

  const flights = localPath("drones", "flowering_flights");
  it.skipIf(!bytes || !flights)("places the trees of the flight list where the maps draw them (reproduction 5)", () => {
    const imp = importPlotMaps(bytes!);
    const wb = readWorkbook(new Uint8Array(readFileSync(flights!)));
    const s = wb.sheets[0]!;
    const h = findHeader(s, { require: ["Cultivar_code", "Parcela", "Fila", "Arbol"] })!;
    const c = h.columns;
    const rows = s.rows.slice(h.rowIndex + 1).filter((r) => r[c.get("Cultivar_code")!] !== null && r[c.get("Cultivar_code")!] !== undefined);
    let placed = 0;
    let sameCode = 0;
    let noPosition = 0;
    const lines: string[] = ["plot,row,position,list_code,list_accession,map_label,map_code,map_status,verdict"];
    for (const r of rows) {
      const code = cellText(r[c.get("Cultivar_code")!] ?? null);
      const plot = cellText(r[c.get("Parcela")!] ?? null);
      const row = cellText(r[c.get("Fila")!] ?? null);
      const pos = Number(r[c.get("Arbol")!] ?? NaN);
      const accession = cellText(r[c.get("Accession")!] ?? null);
      if (!Number.isFinite(pos) || pos <= 0) {
        noPosition++;
        lines.push(`${plot},${row},,${code},${accession},,,,no position in list`);
        continue;
      }
      const layout = imp.layouts.find((l) => l.plot === plot);
      const p = layout ? positionAt(layout, row, pos) : undefined;
      if (!p) {
        lines.push(`${plot},${row},${pos},${code},${accession},,,,not drawn on the map`);
        continue;
      }
      placed++;
      const verdict = p.cultivarCode === code ? "same code" : p.cultivarCode ? "different code" : "no code on map";
      if (verdict === "same code") sameCode++;
      lines.push(`${plot},${row},${pos},${code},${accession},${(p.label ?? "").replace(/,/g, " ")},${p.cultivarCode ?? ""},${p.status ?? ""},${verdict}`);
    }
    if (!existsSync("local")) mkdirSync("local");
    writeFileSync("local/plot_map_vs_list.csv", lines.join("\n") + "\n", "utf-8");
    console.log(`trees in the flight list: ${rows.length}; with a position: ${rows.length - noPosition}; drawn on a map: ${placed}; same MOSAIC code on the map: ${sameCode}. Detail in local/plot_map_vs_list.csv`);
    // 2026 maps: 470 trees with a position, 468 drawn (the two of L7 have no map), all with the same code.
    expect(placed / (rows.length - noPosition)).toBeGreaterThan(0.99);
    expect(sameCode).toBe(placed);
  });
});

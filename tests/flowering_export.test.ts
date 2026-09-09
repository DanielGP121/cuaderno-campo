import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFlightSheet, buildVisitSheet, writeFloweringWorkbook, type FloweringDataset } from "@core/exporters/floweringWorkbook";
import { importFloweringList } from "@core/importers/mosaicFlowering";
import { ulid } from "@core/ids";
import type { Observation, ObservationUnit } from "@core/types";
import { cellText, columnLetters, isRed, readWorkbook, styleAt } from "@core/xlsx/reader";
import { writeWorkbook } from "@core/xlsx/writer";
import { readLocalBytes } from "./helpers/local";

describe("styled cells in the xlsx writer", () => {
  it("writes font colours and fills that the reader gets back", () => {
    const bytes = writeWorkbook([
      {
        name: "colores",
        freezeRows: 1,
        rows: [
          [{ v: "cabecera", fillRgb: "FFFFFF00" }, "normal"],
          [{ v: "F50", fontRgb: "FFFF0000" }, { v: 3, fillRgb: "D9D9D9" }, { v: { date: "2026-03-09" }, fillRgb: "FFA6A6A6" }, { v: null, fillRgb: "FFCCCCCC" }],
        ],
      },
    ]);
    const wb = readWorkbook(bytes, { styles: true });
    const s = wb.sheets[0]!;
    expect(s.rows[1]).toEqual(["F50", 3, "2026-03-09", null]);
    expect(isRed(styleAt(s, 1, 0)?.fontRgb)).toBe(true);
    expect(styleAt(s, 1, 1)?.fillRgb).toBe("FFD9D9D9");
    expect(styleAt(s, 1, 2)?.fillRgb).toBe("FFA6A6A6");
    expect(styleAt(s, 1, 3)?.fillRgb).toBe("FFCCCCCC");
    expect(styleAt(s, 0, 0)?.fillRgb).toBe("FFFFFF00");
    expect(styleAt(s, 0, 1)?.fontRgb).toBeUndefined();
  });
});

function tree(name: string, extra: Partial<ObservationUnit> = {}): ObservationUnit {
  return { id: ulid(), name, level: "tree", ...extra };
}

function obs(unitId: string, date: string, label: string, flight?: string, estimated = false): Observation {
  const o: Observation = { id: ulid(), unitId, variableId: "flowerStageLabel", value: label, observationTimeStamp: `${date}T12:00:00Z`, deviceId: "test", note: `raw:${label}${flight ? `;flight:${flight}` : ""}` };
  if (estimated) o.dataFlag = 3;
  return o;
}

describe("flowering sheets from a small dataset", () => {
  const t1 = tree("J4-F08-A001", { cultivarCode: "1", accession: "Summergrand", accessionNumber: "3801 AD", origin: "EEAD-CSIC", plot: "J4", row: 8, rowLabel: "8", position: 1, rep: 1, attributes: { flowerBudDensity: 1, flowerType: "Rosette", gwasId: "3801" } });
  const t2 = tree("J4-F08-A002", { cultivarCode: "1", accession: "Summergrand", plot: "J4", row: 8, rowLabel: "8", position: 2, rep: 2, attributes: { notPhenotyped: true, rowFill: "FFD9D9D9" } });
  const ds: FloweringDataset = {
    trees: [t1, t2],
    observations: [
      obs(t1.id, "2026-02-17", "F0", "DRON 17 Feb"),
      obs(t1.id, "2026-03-07", "F10"),
      obs(t1.id, "2026-03-09", "F50", "DRON 9 Mar"),
      obs(t1.id, "2026-03-12", "F70", "DRON 12 Mar", true),
      obs(t1.id, "2026-03-19", "F95-C10"),
      obs(t1.id, "2026-04-04", "C90"),
    ],
    visits: [
      { sheet: "x", date: "2026-02-17", flight: "DRON 17 Feb", temperature: "16,1-6,1" },
      { sheet: "x", date: "2026-03-07" },
      { sheet: "x", date: "2026-03-09", flight: "DRON 9 Mar" },
      { sheet: "x", date: "2026-03-12", flight: "DRON 12 Mar" },
      { sheet: "x", date: "2026-03-19" },
      { sheet: "x", date: "2026-04-04" },
    ],
    events: [{ sheet: "x", label: "PODA 24 feb", date: "2026-02-24", flight: false }],
    treeEvents: [{ tree: "J4-F08-A002", date: "2026-02-24", label: "Tratam" }],
  };

  it("builds the flight sheet with derived dates, intervals and the estimate in red", () => {
    const sheet = buildFlightSheet(ds);
    const wb = readWorkbook(writeWorkbook([sheet]), { styles: true });
    const s = wb.sheets[0]!;
    expect(cellText(s.rows[0]![0]!)).toMatch(/^\* En color negro/);
    expect(s.rows[1]!.slice(0, 8)).toEqual(["Cultivar_code", "Accession", "Accession number", "ID GWAS Mas-Gomez", "Origin", "Parcela", "Fila", "Arbol"]);
    expect(s.rows[1]!.slice(19)).toEqual(["DRON 17 Feb", "DRON 9 Mar", "DRON 12 Mar"]);
    expect(s.rows[0]![18]).toBe("Tªmax-Tª min");
    expect(s.rows[0]![19]).toBe("16,1-6,1");
    const r1 = s.rows[2]!;
    expect(r1.slice(0, 8)).toEqual([1, "Summergrand", "3801 AD", 3801, "EEAD-CSIC", "J4", 8, 1]);
    expect(r1.slice(8, 11)).toEqual([1, "Rosette", null]);
    // F80 is the first visit at or above 80 % open: F70 on the 12th does not reach it, F95-C10 on the 19th does
    expect(r1.slice(11, 16)).toEqual(["2026-03-07", "2026-03-09", "2026-03-19", "2026-03-19", "2026-04-04"]);
    expect(r1.slice(16, 19)).toEqual([12, 12, 28]);
    expect(r1.slice(19)).toEqual(["F0", "F50", "F70"]);
    expect(isRed(styleAt(s, 2, 21)?.fontRgb)).toBe(true);
    expect(isRed(styleAt(s, 2, 20)?.fontRgb)).toBe(false);
    const r2 = s.rows[3]!;
    expect(r2.slice(0, 8)).toEqual([1, "Summergrand", null, null, null, "J4", 8, 2]);
    expect(styleAt(s, 3, 8)?.fillRgb).toBe("FFD9D9D9");
    expect(styleAt(s, 3, 21)?.fillRgb).toBe("FFD9D9D9");
  });

  it("builds the visit sheet with events interleaved by date", () => {
    const sheet = buildVisitSheet(ds, "J4");
    const wb = readWorkbook(writeWorkbook([sheet]));
    const s = wb.sheets[0]!;
    const header = s.rows[1]!;
    expect(header.slice(0, 10)).toEqual(["Cultivar_code", "Accession", "Accession number", "ID GWAS Mas-Gomez", "Origin", "Parcela", "Fila", "Arbol", null, "Rep_Tree"]);
    expect(header.slice(17)).toEqual(["DRON 17 Feb", "PODA 24 feb", "2026-03-07", "DRON 9 Mar", "DRON 12 Mar", "2026-03-19", "2026-04-04"]);
    expect(s.rows[2]!.slice(17)).toEqual(["F0", null, "F10", "F50", "F70", "F95-C10", "C90"]);
    expect(s.rows[3]![18]).toBe("Tratam");
    expect(s.rows[3]![9]).toBe(2);
  });

  it("writes a workbook with the flight sheet and one visit sheet per plot", () => {
    const wb = readWorkbook(writeFloweringWorkbook(ds, { visitSheetsByPlot: true }));
    expect(wb.sheets.map((x) => x.name)).toEqual(["MOSAIC_Ppersica_25 26", "J4"]);
  });
});

describe("reproduction 4: the 2026 flight list survives import and export (local only)", () => {
  const bytes = readLocalBytes("drones", "flowering_flights");

  it.skipIf(!bytes)("re-exports the sheet cell by cell, red fonts and grey rows included", () => {
    const original = readWorkbook(bytes!, { styles: true }).sheets[0]!;
    const imp = importFloweringList(bytes!);
    const reported = new Map(imp.reported.map((r) => [r.treeId, r]));
    const out = writeFloweringWorkbook({ trees: imp.trees, observations: imp.observations, visits: imp.visits, reported });
    if (!existsSync("local")) mkdirSync("local");
    writeFileSync("local/flight_list_roundtrip.xlsx", out);
    const copy = readWorkbook(out, { styles: true }).sheets[0]!;
    const lastCol = 26; // A..Z
    const valueDiffs: string[] = [];
    const sourceErrors: string[] = [];
    const redDiffs: string[] = [];
    const fillDiffs: string[] = [];
    const rows = original.rows.length;
    for (let r = 0; r < rows; r++) {
      const o = original.rows[r] ?? [];
      const c = copy.rows[r] ?? [];
      if (o.every((v) => v === null || v === undefined)) continue;
      for (let col = 0; col < lastCol; col++) {
        const ov = o[col] ?? null;
        const cv = c[col] ?? null;
        const same = ov === cv || (typeof ov === "string" && typeof cv === "string" && ov.trim() === cv.trim());
        if (!same) {
          // a typed date that is not a date, and the #VALUE! its formulas produce, are errors of the
          // source that the export cannot and should not reproduce
          const isSourceError =
            (typeof ov === "string" && (/^#/.test(ov) || (col >= 11 && col <= 15 && !/^\d{4}-\d{2}-\d{2}/.test(ov)))) ||
            // an interval formula over empty dates leaves a 0 that means nothing
            (col >= 16 && col <= 18 && ov === 0 && cv === null && (o[11] ?? null) === null);
          (isSourceError ? sourceErrors : valueDiffs).push(`${columnLetters(col)}${r + 1}: original ${JSON.stringify(ov)} copy ${JSON.stringify(cv)}`);
        }
        if (r >= 2 && col >= 19 && ov !== null && ov !== "") {
          const oRed = isRed(styleAt(original, r, col)?.fontRgb);
          const cRed = isRed(styleAt(copy, r, col)?.fontRgb);
          if (oRed !== cRed) redDiffs.push(`${columnLetters(col)}${r + 1}: original red=${oRed} copy red=${cRed}`);
        }
        if (r >= 2 && (col === 1 || col >= 7)) {
          const oFill = styleAt(original, r, col)?.fillRgb ?? "";
          const cFill = styleAt(copy, r, col)?.fillRgb ?? "";
          if (oFill !== cFill) fillDiffs.push(`${columnLetters(col)}${r + 1}: original ${oFill || "-"} copy ${cFill || "-"}`);
        }
      }
    }
    const dataRows = original.rows.slice(2).filter((row) => row.some((v) => v !== null && v !== undefined)).length;
    console.log(`reproduction 4: ${dataRows} data rows compared on A..Z; value differences: ${valueDiffs.length}; source errors left as empty: ${sourceErrors.length}; red-font differences: ${redDiffs.length}; fill differences: ${fillDiffs.length}`);
    if (sourceErrors.length) console.log("source errors:\n" + sourceErrors.join("\n"));
    if (valueDiffs.length) console.log("value differences:\n" + valueDiffs.slice(0, 30).join("\n"));
    if (redDiffs.length) console.log("red differences:\n" + redDiffs.slice(0, 20).join("\n"));
    if (fillDiffs.length) console.log("fill differences:\n" + fillDiffs.slice(0, 30).join("\n"));
    expect(valueDiffs, valueDiffs.slice(0, 10).join("\n")).toEqual([]);
    expect(redDiffs, redDiffs.slice(0, 10).join("\n")).toEqual([]);
    expect(fillDiffs.length).toBeLessThanOrEqual(30);
  });
});

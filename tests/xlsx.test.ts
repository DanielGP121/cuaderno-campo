import { describe, expect, it } from "vitest";
import { cellText, columnIndex, columnLetters, findHeader, isoToSerial, readWorkbook, serialToIso, sheetByName } from "@core/xlsx/reader";
import { writeWorkbook } from "@core/xlsx/writer";
import { readLocalBytes } from "./helpers/local";

describe("xlsx addressing and serial dates", () => {
  it("converts columns and Excel serials both ways", () => {
    expect(columnIndex("A")).toBe(0);
    expect(columnIndex("Z")).toBe(25);
    expect(columnIndex("AA")).toBe(26);
    expect(columnLetters(27)).toBe("AB");
    expect(serialToIso(45999)).toBe("2025-12-08");
    expect(isoToSerial("2025-12-08")).toBe(45999);
    expect(serialToIso(isoToSerial("2026-03-09T10:30:00"))).toBe("2026-03-09T10:30:00");
  });
});

describe("xlsx round trip", () => {
  it("writes a workbook the reader loads back with types and dates intact", () => {
    const bytes = writeWorkbook([
      {
        name: "Datos: prueba/1",
        freezeRows: 1,
        rows: [
          ["Sample_code", "Date Sampling", "CP", "%Nb>BC", "ok", "nota"],
          ["3_1_A", { date: "2025-11-13" }, 10.9, { percent: 0.5 }, true, "áéíóú & <ñ>"],
          ["3_1_B", { date: "2025-11-13T09:15:00" }, 0, null, false, ""],
        ],
      },
      { name: "vacía", rows: [] },
    ]);
    const wb = readWorkbook(bytes);
    expect(wb.sheets.map((s) => s.name)).toEqual(["Datos_ prueba_1", "vacía"]);
    const s = wb.sheets[0]!;
    expect(s.rows[0]).toEqual(["Sample_code", "Date Sampling", "CP", "%Nb>BC", "ok", "nota"]);
    expect(s.rows[1]).toEqual(["3_1_A", "2025-11-13", 10.9, 0.5, true, "áéíóú & <ñ>"]);
    expect(s.rows[2]![1]).toBe("2025-11-13T09:15:00");
    expect(s.rows[2]![3]).toBeNull();
    const h = findHeader(s);
    expect(h?.rowIndex).toBe(0);
    expect(h?.columns.get("CP")).toBe(2);
    expect(cellText(null)).toBe("");
  });
});

describe("real MOSAIC workbooks (local only)", () => {
  const dormancy = readLocalBytes("mosaic", "breaking_dormancy");
  it.skipIf(!dormancy)("reads the forcing workbook: 14 sampling sheets, dates by style, tube codes", () => {
    const wb = readWorkbook(dormancy!);
    const names = wb.sheets.map((s) => s.name);
    expect(names[0]).toBe("Stages");
    expect(names.filter((n) => /Sampling/i.test(n))).toHaveLength(14);
    const s1 = sheetByName(wb, "1_Sampling")!;
    const h = findHeader(s1)!;
    expect(h.columns.get("Sample_code")).toBe(0);
    const first = s1.rows[h.rowIndex + 1]!;
    expect(first[0]).toBe("3_1_A");
    expect(first[h.columns.get("Date Sampling")!]).toBe("2025-11-13");
    expect(first[h.columns.get("Date Reading_JD")!]).toBe("2025-11-24");
    expect(first[h.columns.get("CP")!]).toBe(10.9);
    expect(first[h.columns.get("REP")!]).toBe("A");
  });

  const flowering = readLocalBytes("mosaic", "flowering_list");
  it.skipIf(!flowering)("reads the flowering list: per-plot sheets, visit dates as column headers", () => {
    const wb = readWorkbook(flowering!);
    const s = sheetByName(wb, "EEAD_J4-7_Melocotonero")!;
    const h = findHeader(s, { require: ["Cultivar_code", "Fecha_F50"] })!;
    expect(h.rowIndex).toBe(1);
    expect(h.columns.get("Cultivar_code")).toBe(0);
    expect(h.columns.has("Fecha_F50")).toBe(true);
    const header = s.rows[h.rowIndex]!;
    const visitDates = header.filter((v) => typeof v === "string" && /^2026-0[2-4]-\d\d$/.test(v));
    expect(visitDates.length).toBeGreaterThan(5);
    const summergrand = s.rows[h.rowIndex + 1]!;
    expect(summergrand[h.columns.get("Accession")!]).toBe("Summergrand");
    expect(summergrand[h.columns.get("Fecha_F50")!]).toBe("2026-03-09");
  });

  const registry = readLocalBytes("mosaic", "sampling_registry");
  it.skipIf(!registry)("reads the tree registry sheet", () => {
    const wb = readWorkbook(registry!);
    const s = sheetByName(wb, "Sampling")!;
    const h = findHeader(s, { require: ["ID MOSAIC"] })!;
    expect(h.columns.has("ID MOSAIC")).toBe(true);
    expect(s.rows.length).toBeGreaterThan(100);
  });
});

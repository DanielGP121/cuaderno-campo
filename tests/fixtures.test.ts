/**
 * The importers on the synthetic workbooks under tests/fixtures/ (written by
 * scripts/make_fixtures.ts in the exact layouts of the group's files). These run on
 * every clone; the reproduction tests against the real workbooks stay local-only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { positionAt } from "@core/layout";
import { importFloweringList } from "@core/importers/mosaicFlowering";
import { importForcingWorkbook } from "@core/importers/mosaicForcing";
import { importTreeRegistry } from "@core/importers/mosaicRegistry";
import { importPlotMaps } from "@core/importers/plotMapRgs";
import { readWorkbook } from "@core/xlsx/reader";

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(process.cwd(), "tests/fixtures", name)));
}

describe("synthetic plot maps (tests/fixtures/plot_maps.xlsx)", () => {
  it("reads the collection, EUFRIN and prospection dialects from a real workbook, merged ranges included", () => {
    const wb = readWorkbook(fixture("plot_maps.xlsx"));
    expect(wb.sheets.map((s) => s.name)).toEqual(["coleccion TEST", "EUFRIN TEST", "Prospe TEST"]);
    expect(wb.sheets[0]!.merges).toContain("E3:F3");
    const imp = importPlotMaps(fixture("plot_maps.xlsx"), { fileName: "plot_maps.xlsx" });
    expect(imp.layouts.map((l) => l.plot)).toEqual(["J9", "K1", "L9", "P II"]);
    const j9 = imp.layouts[0]!;
    expect(j9.rows.map((r) => r.name)).toEqual(["2", "1"]);
    expect(positionAt(j9, "2", 1)).toMatchObject({ label: "ALFA", status: "alive", accessionNumber: "1234", blockIndex: 1, blockSize: 2 });
    expect(positionAt(j9, "2", 3)).toMatchObject({ label: "BETA", status: "missing", cultivarCode: "7" });
    expect(positionAt(j9, "2", 6)).toMatchObject({ kind: "empty" });
    expect(positionAt(j9, "1", 2)).toMatchObject({ label: "DELTA", cultivarCode: "12", blockSize: 3 });
    expect(j9.spacingRaw).toBe("5 x 4");
    const l9 = imp.layouts[2]!;
    expect(positionAt(l9, "1", 1)).toMatchObject({ kind: "guard", label: "BIG TOP" });
    expect(positionAt(l9, "1", 2)).toMatchObject({ kind: "tree", label: "ALFA", cultivarCode: "80" });
    expect(positionAt(l9, "1", 6)).toMatchObject({ kind: "filler", note: "13m" });
    expect(l9.rootstock).toBe("GF677");
    const pii = imp.layouts[3]!;
    expect(pii.spacingRaw).toBe("5 x 3");
    expect(positionAt(pii, "2", 3)).toMatchObject({ status: "alive", cultivarCode: "184", accessionNumber: "VS-045" });
    expect(positionAt(pii, "2", 4)).toMatchObject({ status: "dead", mark: "x" });
    expect(positionAt(pii, "1", 4)).toMatchObject({ kind: "filler" });
    expect(imp.trees.find((t) => t.name === "J9-F02-A001")).toMatchObject({ plot: "J9", row: 2, position: 1, accession: "ALFA", site: "EEAD" });
    expect(imp.layouts.every((l) => l.source.file === "plot_maps.xlsx")).toBe(true);
  });
});

describe("synthetic flowering by drone flight (tests/fixtures/flowering_flights.xlsx)", () => {
  const imp = importFloweringList(fixture("flowering_flights.xlsx"));

  it("reads the roster, the flights with their temperatures and the labels, red ones flagged", () => {
    expect(imp.trees).toHaveLength(12);
    expect(imp.events.filter((e) => e.flight).map((e) => e.date)).toEqual(["2026-02-17", "2026-03-02", "2026-03-09"]);
    expect(imp.visits.map((v) => v.temperature)).toEqual(["16,1-6,1", "17,3-2,4", "16,7-7,1"]);
    expect(imp.observations).toHaveLength(32);
    expect(imp.observations.filter((o) => o.dataFlag === 3)).toHaveLength(4);
    expect(imp.observations.every((o) => /flight:DRON/.test(o.note ?? ""))).toBe(true);
    expect(imp.unparsed.map((u) => u.label)).toEqual(["C100-C20"]);
    expect(imp.treeEvents.map((e) => [e.tree, e.label])).toEqual([["L8-F05-A002", "Tratam"]]);
  });

  it("keeps what the colours and the odd cells mean", () => {
    const grey = imp.trees.filter((t) => t.attributes?.["notPhenotyped"] === true);
    expect(grey.map((t) => t.name)).toEqual(["J4-F08-A003"]);
    expect(grey[0]!.attributes?.["rowFill"]).toBe("FFD9D9D9");
    expect(imp.trees.filter((t) => t.attributes?.["listStatus"] === "dead").map((t) => t.accession)).toEqual(["Montedemo"]);
    expect(imp.trees.filter((t) => t.attributes?.["accessionFill"] === "FFFFCCFF")).toHaveLength(3);
    expect(imp.trees.filter((t) => t.attributes?.["accessionFill"] === "FFFFFF00")).toHaveLength(2);
    const first = imp.trees.find((t) => t.cultivarCode === "1" && t.position === 1)!;
    expect(first).toMatchObject({ name: "J4-F08-A001", plot: "J4", row: 8, rowLabel: "8", position: 1, accessionNumber: "3801 AD" });
    expect(first.attributes).toMatchObject({ flowerBudDensity: 3, flowerType: "Rosette", petalsPerFlower: "5" });
    const cita = imp.trees.find((t) => t.cultivarCode === "160" && t.position === 1)!;
    expect(cita).toMatchObject({ name: "1.4-FJ-A001", plot: "1.4", rowLabel: "J" });
    expect(cita.row).toBeUndefined();
    const loose = imp.trees.filter((t) => t.cultivarCode === "178");
    // no replicate column on the flight sheet: the loose tree is named by its code alone
    expect(loose.map((t) => t.name)).toEqual(["178"]);
    expect(imp.warnings.some((w) => /no position/.test(w))).toBe(true);
    expect(imp.warnings.some((w) => /8,\/3\/2026/.test(w))).toBe(true);
    expect(imp.reported).toHaveLength(4);
    const typed = imp.reported.find((r) => r.treeId === first.id)!;
    expect(typed).toMatchObject({ F10: "2026-03-02", F50: "2026-03-09", F80: "2026-03-13", C10: "2026-03-19", C90: "2026-04-04" });
  });
});

describe("synthetic flowering by visit (tests/fixtures/flowering_list.xlsx)", () => {
  const imp = importFloweringList(fixture("flowering_list.xlsx"));

  it("reads one sheet per plot, the visit dates, the events and the early group", () => {
    expect(imp.trees).toHaveLength(10);
    expect(new Set(imp.trees.map((t) => t.attributes?.["sheet"]))).toEqual(new Set(["EEAD_J4-7_Melocotonero", "CITA_1-4_Melocotonero"]));
    expect(imp.visits.filter((v) => v.sheet === "EEAD_J4-7_Melocotonero").map((v) => v.date)).toEqual(["2026-02-19", "2026-02-24", "2026-03-02", "2026-03-02", "2026-03-05", "2026-03-09", "2026-03-13", "2026-03-19", "2026-04-04"]);
    expect(imp.events.map((e) => e.label)).toEqual(["PODA 24 feb", "DRON 2 Mar", "PODA 24 feb", "DRON 2 Mar"]);
    expect(imp.events.filter((e) => !e.flight).every((e) => e.date === "2026-02-24")).toBe(true);
    expect(imp.trees.filter((t) => t.earlyGroup).map((t) => t.cultivarCode)).toEqual(["68", "68", "68"]);
    expect(imp.treeEvents.filter((e) => e.label === "Tratam")).toHaveLength(3);
    expect(imp.observations.length).toBeGreaterThan(40);
    expect(imp.unparsed).toHaveLength(0);
    const cita = imp.trees.find((t) => t.attributes?.["sheet"] === "CITA_1-4_Melocotonero" && t.rep === 2)!;
    expect(cita).toMatchObject({ plot: "1.4", name: "1.4-FJ-A002", rowLabel: "J" });
    expect(imp.visits.find((v) => v.date === "2026-03-09")?.temperature).toBe("16,7-7,1");
  });
});

describe("synthetic tree registry (tests/fixtures/sampling_registry.xlsx)", () => {
  it("reads the Sampling sheet: references, replicates, early group, cut dates", () => {
    const imp = importTreeRegistry(fixture("sampling_registry.xlsx"));
    expect(imp.trees.map((t) => t.cultivarCode)).toEqual(["1", "4", "68", "92", "160", "187"]);
    expect(imp.trees.filter((t) => t.isReference).map((t) => t.cultivarCode)).toEqual(["1", "187"]);
    expect(imp.trees.find((t) => t.cultivarCode === "1")!.attributes?.["replicates"]).toBe(3);
    expect(imp.trees.find((t) => t.cultivarCode === "68")).toMatchObject({ earlyGroup: true, accession: "Royal Demo", accessionNumber: "3662 AD", plot: "J5", origin: "EEAD-CSIC" });
    expect(imp.cutDates.get("1")?.get(1)).toBe("2025-11-13");
    expect(imp.cutDates.get("187")?.get(2)).toBe("2025-11-20");
    expect(imp.cutDates.has("4")).toBe(false);
  });
});

describe("synthetic forcing workbook (tests/fixtures/forcing_workbook.xlsx)", () => {
  it("reads the per-sampling sheets the exporter writes: samplings, tubes, counts", () => {
    const imp = importForcingWorkbook(fixture("forcing_workbook.xlsx"));
    expect(imp.samplings.map((s) => s.number)).toEqual([1, 2]);
    expect(imp.samplings[0]).toMatchObject({ cutDate: "2025-11-13", chillPortions: 10.9 });
    expect(imp.trees.map((t) => t.cultivarCode).sort()).toEqual(["1", "187"]);
    expect(imp.tubes).toHaveLength(12);
    expect(imp.tubes.map((t) => t.name)).toContain("1_1_A");
    expect(imp.observations).toHaveLength(12);
    const counts = imp.observations[0]!.value as Record<string, number>;
    expect(counts["AorB"]! + counts["BC"]! + counts["C"]!).toBe(10);
  });
});

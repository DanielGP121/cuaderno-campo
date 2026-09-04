/**
 * The store layer (IndexedDB event log + actions) exercised in Node with an in-memory
 * IndexedDB. Covers the season import id-mapping, sampling creation, cut marks,
 * chamber readings with the drop warning, and the export built from the state.
 */
import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it } from "vitest";

// localStorage is used by the UI modules the store does not import; the store itself
// only needs IndexedDB, which fake-indexeddb provides on globalThis.
const store = await import("../src/app/store");
const { datasetFromState, treeCurve, dropAt, tubesOf } = await import("../src/app/forcingData");
const { demoTrees } = await import("../src/app/demo");
const { exportForcingWorkbook } = await import("@core/exporters/forcingWorkbook");
const { importConsolidatedCp } = await import("@core/importers/mosaicForcing");
const { readLocalBytes } = await import("./helpers/local");
const { importForcingWorkbook } = await import("@core/importers/mosaicForcing");

describe("store on an in-memory IndexedDB", () => {
  beforeAll(async () => {
    await store.init();
    await store.setDeviceLabel("test phone");
  });

  it("creates a sampling from the demo collection, marks cuts and saves readings with a drop warning", async () => {
    expect(store.ready.value).toBe(true);
    await store.importRegistry({ trees: demoTrees(), cutDates: new Map(), warnings: [] });
    expect(store.trees.value).toHaveLength(12);
    const s1 = await store.createSampling({ number: 1, kind: "full", cutDate: "2026-11-12", chillPortions: 10 });
    expect(s1.treeIds).toHaveLength(7);
    const tubes1 = store.tubesOfSampling(s1);
    expect(tubes1.map((t) => t.name).sort()).toContain("1_1_A");
    expect(tubes1.filter((t) => t.parentId === s1.treeIds[0]!)).toHaveLength(3);
    const s2 = await store.createSampling({ number: 2, kind: "early", cutDate: "2026-11-18", chillPortions: 14 });
    expect(s2.treeIds).toHaveLength(3);

    const tree1 = store.trees.value.find((t) => t.cultivarCode === "1")!;
    expect(store.isCut(s1, tree1)).toBe(false);
    await store.markCut(s1, tree1, true);
    expect(store.isCut(s1, tree1)).toBe(true);
    await store.markCut(s1, tree1, false);
    expect(store.isCut(s1, tree1)).toBe(false);

    // Readings: tree 2 (early) read in samplings 1 and 2, then a drop in sampling 3.
    const tree2 = store.trees.value.find((t) => t.cultivarCode === "2")!;
    for (const tube of tubesOf(store.state.value, tree2, s1)) await store.saveReading(tube, s1, { AorB: 8, BC: 2, C: 0, D: 0, E: 0, F: 0 }, "", "2026-11-22");
    for (const tube of tubesOf(store.state.value, tree2, s2)) await store.saveReading(tube, s2, { AorB: 2, BC: 5, C: 3, D: 0, E: 0, F: 0 }, "ok", "2026-11-28");
    const s3 = await store.createSampling({ number: 3, kind: "full", cutDate: "2026-11-25", chillPortions: 20 });
    const [tubeA] = tubesOf(store.state.value, tree2, s3);
    const provisional = treeCurve(store.state.value, tree2, { tubeId: tubeA!.id, counts: { AorB: 9, BC: 1, C: 0, D: 0, E: 0, F: 0 } });
    expect(provisional.map((p) => [p.samplingNumber, Number(p.fraction!.toFixed(2))])).toEqual([[1, 0.2], [2, 0.8], [3, 0.1]]);
    expect(dropAt(provisional, 3)?.severity).toBe("severo");

    const ds = datasetFromState(store.state.value);
    expect(ds.samplings).toHaveLength(3);
    const bytes = exportForcingWorkbook(ds, { consolidatedName: "2026-2027" });
    const back = importConsolidatedCp(bytes);
    expect(back.sheet).toBe("2026-2027");
    const rows2 = back.rows.filter((r) => r.cultivarCode === "2");
    expect(rows2.filter((r) => r.samplingNumber === 1).map((r) => r.fractionReleased)).toEqual([0.2, 0.2, 0.2]);
    expect(rows2.find((r) => r.samplingNumber === 2 && r.rep === "A")?.fractionReleased).toBeCloseTo(0.8);
  });

  const workbook = readLocalBytes("mosaic", "breaking_dormancy");
  it.skipIf(!workbook)("imports a real season on top of the demo without duplicating trees, and exports it back (local only)", async () => {
    const before = store.trees.value.length;
    const imp = importForcingWorkbook(workbook!);
    await store.importSeason(imp);
    // Demo tree "3" and the real Pace 03-14 share cultivar code 3: merged by code, not duplicated.
    expect(store.trees.value.length).toBe(before + imp.trees.length - imp.trees.filter((t) => ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"].includes(t.cultivarCode!)).length);
    expect(store.samplings.value.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    const ds = datasetFromState(store.state.value);
    const bytes = exportForcingWorkbook(ds, { consolidatedName: "mix" });
    const back = importConsolidatedCp(bytes);
    expect(back.rows.length).toBeGreaterThan(1500);
  });
});

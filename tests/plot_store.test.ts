/**
 * The plot screen through the store, on an in-memory IndexedDB: maps and lists loaded
 * without duplicating trees (twice the same list adds nothing), a visit day written
 * label by label with undo, descriptors and status, and the season exported in the
 * group's layout and read back. The last case starts from an empty store, runs the
 * real maps and the real 2026 flight file through the same path and checks that the
 * export reproduces the file.
 */
import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it } from "vitest";

const store = await import("../src/app/store");
const { wipeAll } = await import("../src/app/db");
const { demoFlowering, demoPlotMap, demoTrees } = await import("../src/app/demo");
const { floweringDatasetFromState, longCsv, seasonsAvailable, stageLabelOf, stagesByTreeAndDate } = await import("../src/app/floweringData");
const { writeFloweringWorkbook } = await import("@core/exporters/floweringWorkbook");
const { importFloweringList } = await import("@core/importers/mosaicFlowering");
const { importPlotMaps } = await import("@core/importers/plotMapRgs");
const { readWorkbook } = await import("@core/xlsx/reader");
const { readLocalBytes } = await import("./helpers/local");

describe("plot screen on an in-memory IndexedDB", () => {
  beforeAll(async () => {
    await store.init();
    await store.setDeviceLabel("test phone");
  });

  it("loads the demo map on top of the registry without duplicating trees, and the 2026 history only once", async () => {
    await store.importRegistry({ trees: demoTrees(), cutDates: new Map(), warnings: [] });
    const r = await store.importLayouts(demoPlotMap());
    expect(r).toEqual({ layouts: 1, trees: 13 });
    expect(store.trees.value).toHaveLength(13);
    expect(store.plots.value).toEqual(["D1"]);
    const t1 = store.trees.value.find((u) => u.cultivarCode === "1")!;
    expect(t1.name).toBe("D1-F01-A001");
    expect(t1.accession).toBe("Demo Blanca");
    expect(t1.attributes).toMatchObject({ layoutKind: "tree", replicates: 3, mapStatus: "alive" });
    expect(store.trees.value.find((u) => u.cultivarCode === "10")?.attributes?.["mapStatus"]).toBe("missing");

    const f1 = await store.importFlowering(demoFlowering(store.trees.value));
    expect(f1.observations).toBe(24);
    expect(f1.visits).toBe(3);
    const f2 = await store.importFlowering(demoFlowering(store.trees.value));
    expect(f2).toMatchObject({ observations: 0, skipped: 24, visits: 0 });
    expect(seasonsAvailable(store.state.value)).toEqual([2026]);
    // a second load of the map keeps ids and bumps the version
    const before = store.trees.value.find((u) => u.cultivarCode === "1")!.id;
    await store.importLayouts(demoPlotMap());
    expect(store.trees.value).toHaveLength(13);
    expect(store.trees.value.find((u) => u.cultivarCode === "1")!.id).toBe(before);
    expect([...store.state.value.layouts.values()][0]!.version).toBe(2);
  });

  it("writes a visit day label by label, undoes, and keeps descriptors, status, events and suggestions", async () => {
    const t2 = store.trees.value.find((u) => u.cultivarCode === "2")!;
    const visit = await store.ensureVisit("2027-03-03", "visit", "D1", { temperature: "15,0-3,2" });
    const o1 = await store.saveStage(t2, visit, { pre: "DE", open: 1, fall: 0 });
    expect(stageLabelOf(o1)).toBe("DE-F1");
    expect(o1.observationTimeStamp.startsWith("2027-03-03T")).toBe(true);
    expect(o1.collector).toBe("test phone");
    const o2 = await store.saveStage(t2, visit, { pre: "", open: 95, fall: 10 });
    expect(stageLabelOf(o2)).toBe("F95-C10");
    expect(stageLabelOf(stagesByTreeAndDate(store.state.value).get(t2.id)!.get("2027-03-03")!)).toBe("F95-C10");
    await store.retract(o2);
    expect(stageLabelOf(stagesByTreeAndDate(store.state.value).get(t2.id)!.get("2027-03-03")!)).toBe("DE-F1");
    // the same day again does not open a second visit
    expect((await store.ensureVisit("2027-03-03", "visit", "D1")).id).toBe(visit.id);

    const flight = await store.ensureVisit("2027-03-10", "flight", "D1");
    const o3 = await store.saveStage(t2, flight, { pre: "", open: 50, fall: 0 }, { estimated: true });
    expect(o3.dataFlag).toBe(3);
    expect(o3.note).toContain("flight:DRON 10 Mar");

    // two descriptors in a row from the same (stale) copy of the tree: both must survive
    await store.saveDescriptor(t2, "flowerBudDensity", 7, "2027-03-03");
    await store.saveDescriptor(t2, "flowerType", "Rosette", "2027-03-03");
    expect(store.treeById(t2.id)!.attributes).toMatchObject({ flowerBudDensity: 7, flowerType: "Rosette" });
    const t12 = store.trees.value.find((u) => u.cultivarCode === "12")!;
    await store.setTreeStatus(t12, "dead", "2027-03-03");
    expect(store.treeById(t12.id)!.attributes?.["status"]).toBe("dead");
    await store.ensureVisit("2027-02-20", "pruning", "D1");
    await store.saveSuggestion("Botones más grandes");
    expect(store.suggestions.value.map((s) => s.value)).toEqual(["Botones más grandes"]);
  });

  it("exports the 2027 season in the group's layout and reads it back; 2026 stays its own season", async () => {
    const ds = floweringDatasetFromState(store.state.value, 2027);
    // the guard has no MOSAIC code and no label this season, so it stays off the sheet
    expect(ds.trees.map((t) => t.name)).not.toContain("D1-F02-A007");
    expect(ds.trees).toHaveLength(12);
    expect(ds.visits.map((v) => v.date)).toEqual(["2027-03-03", "2027-03-10"]);
    expect(ds.visits[0]!.temperature).toBe("15,0-3,2");
    expect(ds.visits[1]!.flight).toBe("DRON 10 Mar");
    expect(ds.events!.map((e) => e.label)).toEqual(["PODA 20 Feb"]);
    expect(ds.reported).toBeUndefined();
    expect(ds.trees.find((t) => t.cultivarCode === "12")!.attributes?.["listStatus"]).toBe("dead");

    const bytes = writeFloweringWorkbook(ds, { flightSheet: true, visitSheetsByPlot: true });
    expect(readWorkbook(bytes).sheets.map((s) => s.name)).toEqual(["MOSAIC_Ppersica_25 26", "D1"]);
    const back = importFloweringList(bytes);
    const flightSheet = back.trees.filter((t) => t.attributes?.["sheet"] === "MOSAIC_Ppersica_25 26");
    expect(flightSheet).toHaveLength(12);
    const t2 = flightSheet.find((t) => t.cultivarCode === "2")!;
    expect(t2.attributes).toMatchObject({ flowerBudDensity: 7, flowerType: "Rosette" });
    const t2Obs = back.observations.filter((o) => o.unitId === t2.id).map((o) => [o.observationTimeStamp.slice(0, 10), stageLabelOf(o), o.dataFlag ?? 0]);
    expect(t2Obs).toEqual([["2027-03-10", "F50", 3]]);
    const t2Visit = back.trees.find((t) => t.attributes?.["sheet"] === "D1" && t.cultivarCode === "2")!;
    const visitObs = back.observations.filter((o) => o.unitId === t2Visit.id).map((o) => [o.observationTimeStamp.slice(0, 10), stageLabelOf(o), o.dataFlag ?? 0]);
    expect(visitObs).toEqual([["2027-03-03", "DE-F1", 0], ["2027-03-10", "F50", 3]]);
    expect(back.events.some((e) => e.label === "PODA 20 Feb" && e.date === "2027-02-20")).toBe(true);
    // dates derived from the labels: F10 and F50 both on the flight day
    const rep = back.reported.find((r) => r.treeId === t2.id)!;
    expect(rep).toMatchObject({ F10: "2027-03-10", F50: "2027-03-10", F80: null });
    expect(back.trees.find((t) => t.attributes?.["sheet"] === "MOSAIC_Ppersica_25 26" && t.cultivarCode === "12")?.attributes?.["listStatus"]).toBe("dead");

    const ds26 = floweringDatasetFromState(store.state.value, 2026);
    expect(ds26.visits.map((v) => v.date)).toEqual(["2026-03-02", "2026-03-09"]);
    expect(ds26.observations).toHaveLength(24);
    expect(ds26.events!.map((e) => e.label)).toEqual(["PODA 24 Feb"]);

    const csv = longCsv(store.state.value, 2027);
    const lines = csv.trim().split("\n");
    expect(lines[0]!.startsWith("plot,row,position,tree,cultivar_code")).toBe(true);
    expect(lines.some((l) => l.includes("D1-F01-A002") && l.includes("flowerStageLabel,DE-F1,DE-F1,0"))).toBe(true);
    expect(lines.some((l) => l.includes("flowerBudDensity,7"))).toBe(true);
    expect(lines.some((l) => l.includes("D1-F01-A002") && l.includes(",7,Rosette,,2027-03-03,"))).toBe(true);
    expect(lines.some((l) => l.includes("F95-C10"))).toBe(false);
  });

  const maps = readLocalBytes("drones", "plot_maps");
  const flights = readLocalBytes("drones", "flowering_flights");
  it.skipIf(!maps || !flights)("from an empty store, the real maps and the real 2026 flight file export back as the file (local only)", async () => {
    await wipeAll();
    await store.init();
    expect(store.trees.value).toHaveLength(0);
    const lay = await store.importLayouts(importPlotMaps(maps!));
    expect(lay.layouts).toBe(5);
    const before = store.trees.value.length;
    const imp = importFloweringList(flights!);
    const r = await store.importFlowering(imp);
    expect(r.trees).toBe(474);
    // new units: the four rows without a position and the two L7 trees, which have no map;
    // every other row lands on a drawn position
    expect(store.trees.value.length - before).toBe(6);
    expect(r.visits).toBe(7);
    const again = await store.importFlowering(importFloweringList(flights!));
    expect(again.observations).toBe(0);

    const ds = floweringDatasetFromState(store.state.value, 2026);
    // every listed tree, the two on positions the J4 map leaves undrawn included; the two
    // coded positions of L8 that the list does not carry stay off the sheet
    expect(ds.trees).toHaveLength(474);
    expect(ds.trees.filter((t) => t.name.startsWith("J4-F10-A02")).length).toBe(2);
    expect(ds.visits.map((v) => v.flight)).toEqual(imp.visits.map((v) => v.flight));
    expect(ds.visits.map((v) => v.temperature)).toEqual(imp.visits.map((v) => v.temperature));
    expect(ds.reported!.size).toBe(406);
    const bytes = writeFloweringWorkbook(ds, { flightSheet: true });
    const back = importFloweringList(bytes);
    expect(back.trees).toHaveLength(ds.trees.length);
    expect(back.observations).toHaveLength(2808);
    expect(back.observations.filter((o) => o.dataFlag === 3)).toHaveLength(488);
    expect(back.visits.map((v) => v.temperature)).toEqual(imp.visits.map((v) => v.temperature));
    expect(back.trees.filter((t) => t.attributes?.["listStatus"] === "dead")).toHaveLength(6);
    expect(back.trees.filter((t) => t.attributes?.["notPhenotyped"] === true)).toHaveLength(68);
    expect(back.reported).toHaveLength(406);
  });
});

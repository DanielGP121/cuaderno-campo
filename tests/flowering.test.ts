import { describe, expect, it } from "vitest";
import { deriveDatesFromLabels, formatStageLabel, parseStageLabel } from "@core/phenology";
import { importFloweringList } from "@core/importers/mosaicFlowering";
import { importTreeRegistry } from "@core/importers/mosaicRegistry";
import { readLocalBytes } from "./helpers/local";

describe("visit labels of the EEAD lists", () => {
  it("parses the compact codes people write in the field", () => {
    expect(parseStageLabel("F0")).toMatchObject({ pre: "", open: 0, fall: 0 });
    expect(parseStageLabel("DE-F1")).toMatchObject({ pre: "DE", open: 1, fall: 0 });
    expect(parseStageLabel("CD-F0")).toMatchObject({ pre: "CD", open: 0 });
    expect(parseStageLabel("E")).toMatchObject({ pre: "E", open: 0, fall: 0 });
    expect(parseStageLabel("F5-10")).toMatchObject({ open: 7.5 });
    expect(parseStageLabel("F95-C5")).toMatchObject({ open: 95, fall: 5 });
    expect(parseStageLabel("F100-C10-20")).toMatchObject({ open: 100, fall: 15 });
    expect(parseStageLabel("F90-C")).toMatchObject({ open: 90, fall: 1 });
    expect(parseStageLabel("F100-C")).toMatchObject({ open: 100, fall: 1 });
    expect(parseStageLabel("C30")).toMatchObject({ open: 100, fall: 30 });
    expect(parseStageLabel("C70-80")).toMatchObject({ open: 100, fall: 75 });
    expect(parseStageLabel(" F80 ")).toMatchObject({ open: 80 });
    expect(parseStageLabel("B-F0")).toMatchObject({ pre: "B", open: 0 });
    expect(parseStageLabel("AB-F0")).toMatchObject({ pre: "AB", open: 0 });
    expect(parseStageLabel("BC")).toMatchObject({ pre: "BC", open: 0, fall: 0 });
    expect(parseStageLabel("F-90")).toMatchObject({ open: 90 });
    expect(parseStageLabel("F40-F50")).toMatchObject({ open: 45, fall: 0 });
    expect(parseStageLabel("C5-C10")).toMatchObject({ open: 100, fall: 7.5 });
    expect(parseStageLabel("F90-C5-C10")).toMatchObject({ open: 90, fall: 7.5 });
    expect(parseStageLabel("C100-C20")).toBeNull();
    expect(parseStageLabel("Tratam")).toBeNull();
    expect(parseStageLabel("?")).toBeNull();
    expect(parseStageLabel("2026-05-03")).toBeNull();
    expect(parseStageLabel("Rosette")).toBeNull();
    expect(parseStageLabel("")).toBeNull();
  });

  it("derives the reported dates from labels and formats labels back", () => {
    const { dates, unparsed } = deriveDatesFromLabels([
      { date: "2026-02-19", label: "F0" },
      { date: "2026-02-24", label: "Tratam" },
      { date: "2026-03-05", label: "E-F0" },
      { date: "2026-03-07", label: "F10" },
      { date: "2026-03-09", label: "F50" },
      { date: "2026-03-12", label: "F70" },
      { date: "2026-03-13", label: "F80-C" },
      { date: "2026-03-19", label: "F95-C10" },
      { date: "2026-04-04", label: "C90" },
    ]);
    expect(dates).toEqual({ F10: "2026-03-07", F50: "2026-03-09", F80: "2026-03-13", C10: "2026-03-19", C90: "2026-04-04" });
    expect(unparsed.map((u) => u.label)).toEqual(["Tratam"]);
    expect(formatStageLabel({ open: 95, fall: 5 })).toBe("F95-C5");
    expect(formatStageLabel({ pre: "DE", open: 1, fall: 0 })).toBe("DE-F1");
    expect(formatStageLabel({ open: 0, fall: 0 })).toBe("F0");
  });
});

describe("real MOSAIC registry and flowering list (local only)", () => {
  const registry = readLocalBytes("mosaic", "sampling_registry");
  it.skipIf(!registry)("reads the tree registry with reference flags, replicates, early group and cut dates", () => {
    const imp = importTreeRegistry(registry!);
    expect(imp.trees.length).toBeGreaterThan(150);
    const t3 = imp.trees.find((t) => t.cultivarCode === "3")!;
    expect(t3).toMatchObject({ accession: "Pace 03-14", accessionNumber: "3827 AD", plot: "J4", isReference: true });
    expect(t3.attributes?.["replicates"]).toBe(3);
    const t2 = imp.trees.find((t) => t.cultivarCode === "2")!;
    expect(t2.earlyGroup).toBe(true);
    expect(t2.isReference).toBe(false);
    expect(imp.cutDates.get("3")?.get(1)).toBe("2025-11-13");
    expect(imp.cutDates.get("2")?.get(2)).toBe("2025-11-18");
    expect(imp.trees.filter((t) => t.isReference).length).toBeGreaterThanOrEqual(50);
  });

  const flowering = readLocalBytes("mosaic", "flowering_list");
  it.skipIf(!flowering)("reads the flowering lists: trees on the grid, one observation per visit, drone flights as events", () => {
    const imp = importFloweringList(flowering!);
    expect(imp.trees.length).toBeGreaterThan(600);
    const summergrand = imp.trees.find((t) => t.cultivarCode === "1" && t.rep === 1)!;
    expect(summergrand).toMatchObject({ plot: "J4", row: 8, position: 1, name: "J4-F08-A001" });
    expect(imp.events.some((e) => /DRON/i.test(e.label) && e.date === "2026-02-17")).toBe(true);
    const labels = imp.observations.length;
    const failed = imp.unparsed.length;
    // The vocabulary is free text; well over nine in ten labels must parse.
    expect(failed / labels, imp.unparsed.slice(0, 15).map((u) => `${u.sheet} ${u.tree} ${u.date}: ${u.label}`).join("\n")).toBeLessThan(0.08);
  });

  it.skipIf(!flowering)("derived F50 agrees with the typed Fecha_F50 for most trees", () => {
    const imp = importFloweringList(flowering!);
    const byTree = new Map<string, { date: string; label: string }[]>();
    for (const o of imp.observations) {
      const list = byTree.get(o.unitId) ?? [];
      const raw = /raw:(.*)$/.exec(o.note ?? "")?.[1] ?? "";
      list.push({ date: o.observationTimeStamp.slice(0, 10), label: raw });
      byTree.set(o.unitId, list);
    }
    let compared = 0;
    let exact = 0;
    let within3 = 0;
    const diffs: string[] = [];
    for (const r of imp.reported) {
      if (!r.F50) continue;
      const visits = byTree.get(r.treeId);
      if (!visits) continue;
      const d = deriveDatesFromLabels(visits).dates["F50"];
      if (!d) continue;
      compared++;
      const gap = Math.abs((Date.parse(d) - Date.parse(r.F50)) / 86_400_000);
      if (gap === 0) exact++;
      if (gap <= 3) within3++;
      else diffs.push(`${imp.trees.find((t) => t.id === r.treeId)?.name}: derived ${d} typed ${r.F50}`);
    }
    expect(compared).toBeGreaterThan(50);
    // Report the agreement; the typed dates were interpolated by hand between visits.
    console.log(`F50 agreement: ${exact}/${compared} exact, ${within3}/${compared} within 3 days`);
    expect(within3 / compared, diffs.slice(0, 20).join("\n")).toBeGreaterThan(0.7);
  });
});

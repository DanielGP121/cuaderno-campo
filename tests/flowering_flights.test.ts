import { describe, expect, it } from "vitest";
import { eventDate, importFloweringList, plotName } from "@core/importers/mosaicFlowering";
import { deriveDatesFromLabels } from "@core/phenology";
import { rankOf, resolveCategory, VARIABLES } from "@core/scales";
import { readLocalBytes } from "./helpers/local";

describe("flight columns, plot names and UPOV descriptors", () => {
  it("reads the flight date out of the column label", () => {
    expect(eventDate("DRON 17 Feb", 2026)).toBe("2026-02-17");
    expect(eventDate(" DRON4- 4 Mar", 2026)).toBe("2026-03-04");
    expect(eventDate("DRON5- 9 mar", 2026)).toBe("2026-03-09");
    expect(eventDate("DRON 24 mar", 2026)).toBe("2026-03-24");
    expect(eventDate("DRON 17 Feb", 0)).toBeNull();
    expect(eventDate("PODA", 2026)).toBeNull();
  });

  it("undoes the date Excel made of the CITA plot name", () => {
    expect(plotName("2026-04-01", "x")).toBe("1.4");
    expect(plotName("J4", "x")).toBe("J4");
    expect(plotName(null, "CITA_1-4")).toBe("CITA_1-4");
  });

  it("knows the UPOV scales the 2026 sheets use", () => {
    expect(rankOf(VARIABLES["flowerBudDensity"]!.categories!, "7")).toBe(7);
    expect(rankOf(VARIABLES["flowerBudDensity"]!.categories!, 9)).toBe(9);
    expect(resolveCategory(VARIABLES["flowerType"]!.categories!, "Roseta")?.value).toBe("rosette");
    expect(resolveCategory(VARIABLES["flowerType"]!.categories!, "Campanulate")?.value).toBe("campanulate");
    expect(resolveCategory(VARIABLES["petalsPerFlower"]!.categories!, ">5")?.value).toBe(">5");
  });
});

describe("real flowering list by drone flight (local only)", () => {
  const bytes = readLocalBytes("drones", "flowering_flights");

  it.skipIf(!bytes)("reads the 474 trees, seven flights, the estimates in red and the greyed rows", () => {
    const imp = importFloweringList(bytes!);
    expect(imp.trees.length).toBe(474);
    const flights = imp.events.filter((e) => e.flight);
    expect(flights.map((e) => e.date)).toEqual(["2026-02-17", "2026-03-02", "2026-03-04", "2026-03-09", "2026-03-12", "2026-03-17", "2026-03-24"]);
    expect(imp.observations.length).toBe(2808);
    const estimated = imp.observations.filter((o) => o.dataFlag === 3).length;
    expect(estimated).toBe(488);
    expect(imp.observations.every((o) => /flight:DRON/.test(o.note ?? ""))).toBe(true);
    expect(imp.trees.filter((t) => t.attributes?.["notPhenotyped"] === true).length).toBe(68);
    // dark grey rows: the three Montañana trees (dead in the registry) and the three Rojo Pollero
    // positions that the J4 map draws as missing
    const dead = imp.trees.filter((t) => t.attributes?.["listStatus"] === "dead");
    expect(dead.length).toBe(6);
    expect([...new Set(dead.map((t) => t.accession))].sort()).toEqual(["Montañana", "Rojo Pollero"]);
    expect(imp.warnings.some((w) => /8,\/3\/2026/.test(w))).toBe(true);
    expect(imp.visits.map((v) => v.temperature)).toEqual(["16,1-6,1", "17,3-2,4", "14,2-4,2", "16,7-7,1", "20,9-5,2", "21,1-1,8", "19,4-1,7"]);
    expect(imp.trees.filter((t) => t.attributes?.["accessionFill"] === "FFFFCCFF").length).toBe(78);
    expect(imp.trees.filter((t) => t.attributes?.["accessionFill"] === "FFFFFF00").length).toBe(50);
    const summergrand = imp.trees.find((t) => t.cultivarCode === "1" && t.position === 1)!;
    expect(summergrand).toMatchObject({ name: "J4-F08-A001", plot: "J4", row: 8, rowLabel: "8", position: 1, accessionNumber: "3801 AD" });
    expect(summergrand.attributes).toMatchObject({ flowerBudDensity: 1, flowerType: "Rosette", petalsPerFlower: ">5" });
    const cita = imp.trees.find((t) => t.cultivarCode === "160" && t.position === 1)!;
    expect(cita).toMatchObject({ name: "1.4-FJ-A001", plot: "1.4", rowLabel: "J", accession: "Mid Gold" });
    expect(cita.row).toBeUndefined();
    expect(imp.trees.filter((t) => t.plot === "P II").length).toBe(24);
    expect(imp.warnings.filter((w) => /no position/.test(w)).length).toBe(4);
    // the typed F10 .. C90 come with the list; the flights alone cannot derive them
    expect(imp.reported.length).toBe(406);
    const densities = new Set(imp.trees.map((t) => String(t.attributes?.["flowerBudDensity"] ?? "")));
    expect(["1", "3", "5", "7"].every((d) => densities.has(d))).toBe(true);
    console.log(`flights: ${flights.length}; observations: ${imp.observations.length}; estimated (red): ${estimated}; unparsed: ${imp.unparsed.length} ${imp.unparsed.map((u) => u.label).join(",")}`);
    expect(imp.unparsed.length, imp.unparsed.map((u) => `${u.tree} ${u.date} "${u.label}"`).join("\n")).toBeLessThanOrEqual(4);
  });

  const list = readLocalBytes("mosaic", "flowering_list");
  it.skipIf(!list)("the list by visit now yields the flight days as visits too, and CITA trees on their grid", () => {
    const imp = importFloweringList(list!);
    const flightObs = imp.observations.filter((o) => /flight:/.test(o.note ?? ""));
    expect(flightObs.length).toBeGreaterThan(500);
    // the list by visit has 26 Feb and stops at 17 Mar; the list by flight has 24 Mar instead of 26 Feb
    expect(imp.events.filter((e) => e.flight && e.sheet === "EEAD_J4-7_Melocotonero").map((e) => e.date)).toEqual(["2026-02-17", "2026-02-26", "2026-03-02", "2026-03-04", "2026-03-09", "2026-03-12", "2026-03-17"]);
    expect(imp.treeEvents.filter((e) => /tratam/i.test(e.label)).length).toBeGreaterThan(100);
    const cita = imp.trees.find((t) => t.attributes?.["sheet"] === "CITA_1-4_Melocotonero" && t.position === 1 && t.rowLabel === "F")!;
    expect(cita).toMatchObject({ plot: "1.4", name: "1.4-FF-A001" });
    // derived F50 still agrees with the typed one once the flight days join the visits
    const byTree = new Map<string, { date: string; label: string }[]>();
    for (const o of imp.observations) {
      const list2 = byTree.get(o.unitId) ?? [];
      list2.push({ date: o.observationTimeStamp.slice(0, 10), label: /raw:([^;]*)/.exec(o.note ?? "")?.[1] ?? "" });
      byTree.set(o.unitId, list2);
    }
    let compared = 0;
    let within3 = 0;
    for (const r of imp.reported) {
      const visits = r.F50 ? byTree.get(r.treeId) : undefined;
      const d = visits ? deriveDatesFromLabels(visits).dates["F50"] : null;
      if (!d || !r.F50) continue;
      compared++;
      if (Math.abs((Date.parse(d) - Date.parse(r.F50)) / 86_400_000) <= 3) within3++;
    }
    expect(compared).toBeGreaterThan(50);
    expect(within3 / compared).toBeGreaterThan(0.7);
  });
});

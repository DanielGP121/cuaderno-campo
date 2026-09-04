import { describe, expect, it } from "vitest";
import { applyEvent, emptyState, fromJsonl, makeEvent, mergeLogs, observationsOf, replay, toJsonl, unitsOfLevel, type LogEvent } from "@core/events";
import { planSampling, replicatesFor, treesForSampling, tubesAsUnits, walkingOrder } from "@core/sampling";
import type { ObservationUnit } from "@core/types";

const tree = (id: string, cultivarCode: string, extra: Partial<ObservationUnit> = {}): ObservationUnit => ({
  id,
  name: cultivarCode,
  level: "tree",
  cultivarCode,
  isReference: true,
  ...extra,
});

describe("event log", () => {
  it("folds events idempotently and merges two devices by union", () => {
    const a = tree("t1", "3");
    const e1 = makeEvent("phone-A", { type: "unit.upsert", unit: a }, "2026-11-10T09:00:00Z");
    const e2 = makeEvent("phone-A", { type: "observation.add", observation: { id: "o1", unitId: "t1", variableId: "note", value: "ok", observationTimeStamp: "2026-11-10T09:05:00Z", deviceId: "phone-A" } }, "2026-11-10T09:05:00Z");
    const e3 = makeEvent("phone-B", { type: "observation.add", observation: { id: "o2", unitId: "t1", variableId: "note", value: "later", observationTimeStamp: "2026-11-10T09:06:00Z", deviceId: "phone-B" } }, "2026-11-10T09:06:00Z");
    const logA: LogEvent[] = [e1, e2];
    const logB: LogEvent[] = [e1, e3];
    const merged = mergeLogs(logB, logA);
    expect(merged.map((e) => e.id)).toEqual([e1.id, e2.id, e3.id]);
    const s = replay(logA, logB);
    expect(s.units.size).toBe(1);
    expect(s.observations.size).toBe(2);
    expect(observationsOf(s, "t1", "note").map((o) => o.value)).toEqual(["later", "ok"]);
    // applying again changes nothing
    const before = s.applied.size;
    applyEvent(s, e2);
    expect(s.applied.size).toBe(before);
  });

  it("latest wins for mutable documents, and supersede hides corrected observations", () => {
    const s = emptyState();
    applyEvent(s, makeEvent("d", { type: "unit.upsert", unit: tree("t1", "3", { accession: "Pace 03-14" }) }, "2026-01-01T00:00:00Z"));
    applyEvent(s, makeEvent("d", { type: "unit.upsert", unit: tree("t1", "3", { accession: "Pace 03-14", earlyGroup: true }) }, "2026-01-02T00:00:00Z"));
    expect(s.units.get("t1")?.earlyGroup).toBe(true);
    applyEvent(s, makeEvent("d", { type: "observation.add", observation: { id: "o1", unitId: "t1", variableId: "treeStatus", value: "dead", observationTimeStamp: "2026-09-02T10:00:00Z", deviceId: "d" } }));
    applyEvent(s, makeEvent("d", { type: "observation.add", observation: { id: "o2", unitId: "t1", variableId: "treeStatus", value: "alive", observationTimeStamp: "2026-09-02T10:01:00Z", deviceId: "d", supersedes: "o1", dataFlag: 2 } }));
    expect(observationsOf(s, "t1", "treeStatus").map((o) => o.id)).toEqual(["o2"]);
    applyEvent(s, makeEvent("d", { type: "unit.retire", unitId: "t1" }));
    expect(unitsOfLevel(s, "tree")).toHaveLength(0);
  });

  it("round-trips JSON Lines", () => {
    const e = makeEvent("d", { type: "device.register", deviceId: "d", label: "Daniel móvil" });
    const text = toJsonl([e]);
    expect(text.endsWith("\n")).toBe(true);
    expect(fromJsonl(text + "\n\ngarbage\n")).toHaveLength(1);
  });
});

describe("sampling plan", () => {
  const trees = [
    tree("a", "3", { plot: "J4", row: 8, position: 1 }),
    tree("b", "13", { plot: "J4", row: 8, position: 5, earlyGroup: true }),
    tree("c", "22", { plot: "J4", row: 9, position: 2, attributes: { replicates: 1 } }),
    tree("d", "40", { plot: "J4", row: 9, position: 7, isReference: false }),
  ];

  it("takes reference trees on full samplings and only the early group on early ones", () => {
    expect(treesForSampling(trees, "full").map((t) => t.name)).toEqual(["3", "13", "22"]);
    expect(treesForSampling(trees, "early").map((t) => t.name)).toEqual(["13"]);
    expect(replicatesFor(trees[2]!, 3)).toBe(1);
    expect(replicatesFor(trees[0]!, 3)).toBe(3);
  });

  it("generates the group's tube codes and units", () => {
    const plan = planSampling(trees, { number: 7, cutDate: "2026-12-23", kind: "full", chillPortions: 38.5 });
    expect(plan.tubes.map((t) => t.code)).toEqual(["3_7_A", "3_7_B", "3_7_C", "13_7_A", "13_7_B", "13_7_C", "22_7"]);
    const units = tubesAsUnits(plan);
    expect(units[0]).toMatchObject({ name: "3_7_A", level: "tube", parentId: "a", rep: 1, cutDate: "2026-12-23", chillPortions: 38.5 });
    expect(units[6]!.rep).toBeUndefined();
    expect(plan.sampling.treeIds).toEqual(["a", "b", "c"]);
  });

  it("walks rows in serpentine order", () => {
    const order = walkingOrder(trees).map((t) => t.name);
    expect(order).toEqual(["3", "13", "40", "22"]);
    expect(walkingOrder(trees, false).map((t) => t.name)).toEqual(["3", "13", "22", "40"]);
  });
});

import { describe, expect, it } from "vitest";
import { ULID_RE, parseTubeCode, replicateLetters, treeName, tubeCode, ulid } from "@core/ids";
import { BAGGIOLINI, FLOWER_STAGES_EEAD, rankOf, resolveCategory, TREE_STATUS } from "@core/scales";
import { cp50Linear, detectDrops, emptyCounts, fractionReleased, meanReleased, totalBuds, type BudCounts, type CurvePoint } from "@core/forcing";
import { checkDateOrder, dayOfYear, daysBetween, deriveThresholdDates } from "@core/phenology";

describe("ids", () => {
  it("makes sortable ULIDs", () => {
    const a = ulid(1_000_000);
    const b = ulid(2_000_000);
    expect(a).toMatch(ULID_RE);
    expect(b).toMatch(ULID_RE);
    expect(a < b).toBe(true);
    expect(new Set(Array.from({ length: 200 }, () => ulid())).size).toBe(200);
  });

  it("writes and parses the group's tube codes", () => {
    expect(tubeCode(3, 7, "A")).toBe("3_7_A");
    expect(tubeCode("13", 1)).toBe("13_1");
    expect(parseTubeCode("3_7_A")).toEqual({ cultivarCode: "3", samplingNumber: 7, rep: "A" });
    expect(parseTubeCode("13_1")).toEqual({ cultivarCode: "13", samplingNumber: 1 });
    expect(parseTubeCode("4_1_")).toEqual({ cultivarCode: "4", samplingNumber: 1 });
    expect(parseTubeCode("Summergrand")).toBeNull();
    expect(replicateLetters(3)).toEqual(["A", "B", "C"]);
    expect(treeName("J4", 8, 1)).toBe("J4-F08-A001");
  });
});

describe("scales", () => {
  it("resolves aliases and ranks", () => {
    expect(resolveCategory(FLOWER_STAGES_EEAD, "F90-C")?.value).toBe("F90");
    expect(resolveCategory(FLOWER_STAGES_EEAD, " f50 ")?.value).toBe("F50");
    expect(resolveCategory(FLOWER_STAGES_EEAD, "?")).toBeNull();
    expect(rankOf(BAGGIOLINI, "F")).toBe(5);
    expect(resolveCategory(TREE_STATUS, "o")?.value).toBe("dead");
    expect(resolveCategory(TREE_STATUS, "x")?.value).toBe("alive");
  });
});

describe("forcing", () => {
  const tube = (AorB: number, BC: number, C = 0, D = 0, E = 0, F = 0): BudCounts => ({ AorB, BC, C, D, E, F });

  it("computes the released fraction like the workbook", () => {
    expect(totalBuds(emptyCounts())).toBe(0);
    expect(fractionReleased(emptyCounts())).toBeNull();
    expect(fractionReleased(tube(10, 0))).toBe(0);
    expect(fractionReleased(tube(5, 3, 2))).toBeCloseTo(0.5);
    expect(meanReleased([tube(5, 5), tube(10, 0), emptyCounts()])).toBeCloseTo(0.25);
  });

  it("flags drops between consecutive samplings", () => {
    const curve: CurvePoint[] = [
      { samplingNumber: 9, cp: 49.02, fraction: 0.527 },
      { samplingNumber: 10, cp: 52.94, fraction: 0 },
      { samplingNumber: 11, cp: 58.46, fraction: 0.6 },
      { samplingNumber: 12, cp: 63.12, fraction: 0.52 },
    ];
    const drops = detectDrops(curve);
    expect(drops).toHaveLength(2);
    expect(drops[0]!.severity).toBe("severo");
    expect(drops[0]!.delta).toBeCloseTo(-0.527);
    expect(drops[1]!.severity).toBe("moderado");
    expect(detectDrops([{ samplingNumber: 1, cp: 10, fraction: 0.5 }, { samplingNumber: 2, cp: 12, fraction: 0.48 }])[0]!.severity).toBe("leve");
    expect(detectDrops([{ samplingNumber: 1, cp: 10, fraction: 0.5 }, { samplingNumber: 2, cp: 12, fraction: 0.4 }])[0]!.severity).toBe("moderado");
    expect(detectDrops([{ samplingNumber: 1, cp: 10, fraction: 0.5 }, { samplingNumber: 2, cp: 12, fraction: 0.5 }])).toHaveLength(0);
  });

  it("interpolates CP50 on the straight line, with the documented edge cases", () => {
    const curve: CurvePoint[] = [
      { samplingNumber: 6, cp: 33.46, fraction: 0.1 },
      { samplingNumber: 7, cp: 40, fraction: 0.3 },
      { samplingNumber: 8, cp: 45, fraction: 0.7 },
    ];
    const r = cp50Linear(curve);
    expect(r.method).toBe("linear_2pts");
    // m = 0.4/5 = 0.08; cp50 = 40 + (0.5-0.3)/0.08 = 42.5
    expect(r.cp50).toBeCloseTo(42.5);
    expect(cp50Linear([{ samplingNumber: 6, cp: 33.46, fraction: 0.8 }]).method).toBe("first_sampling");
    expect(cp50Linear([{ samplingNumber: 6, cp: 33.46, fraction: 0.2 }]).method).toBe("never_50pct");
    expect(cp50Linear([]).method).toBe("no_data");
  });
});

describe("phenology", () => {
  it("derives the reported dates from per-visit stages", () => {
    const dates = deriveThresholdDates([
      { date: "2026-02-19", stage: "F0" },
      { date: "2026-02-23", stage: "?" },
      { date: "2026-03-07", stage: "F10" },
      { date: "2026-03-09", stage: "F50" },
      { date: "2026-03-13", stage: "F80" },
      { date: "2026-03-19", stage: "F90-C" },
      { date: "2026-03-24", stage: "C10" },
      { date: "2026-04-04", stage: "C90" },
    ]);
    expect(dates).toEqual({ F10: "2026-03-07", F50: "2026-03-09", F80: "2026-03-13", C10: "2026-03-24", C90: "2026-04-04" });
  });

  it("skips thresholds that were jumped over and never observed", () => {
    const dates = deriveThresholdDates([
      { date: "2026-03-01", stage: "F0" },
      { date: "2026-03-08", stage: "F80" },
    ]);
    // F10 and F50 were reached by the 8th even if not seen as such: first date at or beyond the rank
    expect(dates.F10).toBe("2026-03-08");
    expect(dates.F50).toBe("2026-03-08");
    expect(dates.C90).toBeNull();
  });

  it("catches the typos of the 2026 season", () => {
    const issues = checkDateOrder({ F10: "2026-02-26", F50: "2026-03-26", F80: "2026-03-01", C10: null, C90: null });
    expect(issues.map((i) => `${i.later}<${i.earlier}`)).toEqual(["F80<F50"]);
    expect(checkDateOrder({ F10: "2026-02-26", F50: "2026-02-03" })).toHaveLength(1);
    expect(checkDateOrder({ F10: "2026-03-07", F50: "2026-03-09" })).toHaveLength(0);
  });

  it("does Julian days and differences", () => {
    expect(dayOfYear("2026-03-09")).toBe(68);
    expect(dayOfYear("2026-01-01")).toBe(1);
    expect(daysBetween("2026-03-07", "2026-04-04")).toBe(28);
  });
});

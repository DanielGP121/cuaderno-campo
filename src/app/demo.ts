/**
 * A small made-up collection to try the app without any real workbook: twelve trees
 * on two rows, seven of them reference trees and three in the early group. Names and
 * numbers are invented; nothing here comes from a real collection.
 */
import { ulid } from "@core/ids";
import type { ObservationUnit } from "@core/types";

const DEMO: [code: string, accession: string, row: number, position: number, reference: boolean, early: boolean, reps: number][] = [
  ["1", "Demo Blanca", 1, 1, true, false, 3],
  ["2", "Demo Roja Temprana", 1, 2, true, true, 3],
  ["3", "Demo Amarilla", 1, 3, false, false, 1],
  ["4", "Demo Paraguayo", 1, 4, true, false, 3],
  ["5", "Demo Nectarina", 1, 5, false, false, 1],
  ["6", "Demo Tardía", 1, 6, true, false, 3],
  ["7", "Demo Precoz", 2, 1, true, true, 3],
  ["8", "Demo Plano", 2, 2, false, false, 1],
  ["9", "Demo Calanda", 2, 3, true, false, 1],
  ["10", "Demo Maluenda", 2, 4, false, false, 1],
  ["11", "Demo Miraflores", 2, 5, true, true, 3],
  ["12", "Demo Sudanell", 2, 6, false, false, 1],
];

export function demoTrees(): ObservationUnit[] {
  return DEMO.map(([code, accession, row, position, reference, early, reps]) => {
    const u: ObservationUnit = {
      id: ulid(),
      name: code,
      level: "tree",
      cultivarCode: code,
      accession,
      accessionNumber: `${1000 + Number(code)} DM`,
      origin: "Demo",
      plot: "D1",
      row,
      position,
      isReference: reference,
      attributes: { replicates: reps, demo: true },
    };
    if (early) u.earlyGroup = true;
    return u;
  });
}

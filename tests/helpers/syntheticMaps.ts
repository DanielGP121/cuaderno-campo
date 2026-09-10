/**
 * Made-up plot maps, one per dialect the importer knows, written the way the group
 * draws them in Excel. Shared by the plot-map tests and by the fixture generator that
 * writes them to real .xlsx files.
 */
import type { Sheet } from "@core/xlsx/reader";

export function sheet(name: string, rows: (string | number | null)[][], merges: string[] = [], pictures: { row: number; col: number }[] = []): Sheet {
  return { name, rows, merges, pictures };
}

// The EEAD collection dialect: a FILA label in column D, varieties merged over their
// trees, one symbol per column, identity below (code first, register last).
export const collectionSheet = sheet(
  "coleccion TEST",
  [
    [],
    [],
    ["", "", "", "FILA  2", "ALFA", null, "BETA", null, "GAMMA", null, null, "RIEGO"],
    ["", "", "", null, "·", "·?", "×", "·", "·", null, "·    ·"],
    ["", "", "", null, null, 1234, 7, 2345, "MID_9", null, 3456],
    ["Parcela : J9-10 y 11", "Plantado: 1-1-2000", "Marco: 5 x 4"],
    ["", "", "", "FILA  1", "DELTA", null, null],
    ["", "", "", null, "·", "·", "·"],
    ["", "", "", null, "MID_12", null, 4567],
    ["", "", "", "FILA  3", "OMEGA", null, null],
    ["", "", "", null, "·", "×", "·"],
    ["", "", "", null, "MID_20", null, 5678],
    ["Parcela : K1"],
  ],
  ["E3:F3", "G3:H3", "I3:K3", "L3:L9", "A6:A9", "E7:G7", "E10:G10", "A13:A13"],
);

// The EUFRIN dialect: guard at each end, blocks of three, rootstock fillers with metres.
export const eufrinSheet = sheet(
  "EUFRIN TEST",
  [
    [null, null, null, null, null, "Arbol guarda", null, null, null, null, null, "Muestreo de 3 tubos"],
    [],
    ["CASA", "Plantado: 25-4-2018", null, "FILA  1", null, "BIG TOP", null, null, null, null, "ALFA (1)", null, null, "GF677", "13m", "GF677", "BETA (2)", null, null, null, "GLADYS"],
    [null, null, null, null, null, "·", null, null, null, null, "·", "·", "·", "·", "·", "·", "·", "·", "·", null, "·"],
    [null, null, null, null, null, null, null, null, null, null, "MOSAIC_ID_80", null, null, null, null, null, "MOSAIC_ID_81"],
    ["Parcela : L9", null, "Patrón: GF677"],
  ],
  ["F3:H3", "K3:M3", "Q3:S3", "A3:A3", "B3:B6"],
);

// The CITA collection dialect: letters name the rows, a header numbers positions in
// pairs from 6 down to 1, and a tree icon sits on every living tree.
export const citaSheet = sheet(
  "coleccion CITA TEST",
  [
    [],
    [],
    [null, null, null, null, null, null, null, null, null, "COLECCIÓN  CITA  MELOCOTONERO  ( PARCELA 1-4)"],
    [],
    [null, null, null, null, "6  5", null, null, "4  3", null, null, "2  1"],
    [],
    [null, "J", null, null, null, null, null, null, null, null, null, null, null, null, "PASILLO"],
    [null, null, null, null, "5001", null, null, "5002", null, null, "A4/79"],
    [null, null, null, null, "Uno", null, "MID_101", "Dos", "bis", "MID_102", "A4/79"],
    [],
    [],
    [null, "I"],
    [null, null, null, null, "5003", null, null, "5004", null, null, "5005"],
    [null, null, null, null, "Tres", null, null, "Cuatro", null, "MID_103", "Cinco"],
  ],
  ["E8:G8", "H8:J8", "K8:M8"],
  [
    { row: 0, col: 15 },
    { row: 6, col: 4 },
    { row: 6, col: 5 },
    { row: 6, col: 7 },
    { row: 6, col: 10 },
    { row: 11, col: 4 },
    { row: 11, col: 5 },
    { row: 11, col: 7 },
    { row: 11, col: 8 },
    { row: 11, col: 10 },
    { row: 11, col: 11 },
  ],
);

// The prospection dialect: pairs of positions per cell, marks 0/x/X, identity below.
export const prospectionSheet = sheet("Prospe TEST", [
  [],
  [null, null, "PARCELA PROSPECCION CITA   II", null, " II  (CITA)", null, "Plantación", "2006-01-18"],
  [null, null, "nº parcela: 7-1     Marco de plantación: 5 x 3", null, null, null, null, "2007-01-18", null, "N"],
  [],
  [],
  ["FILA 2", "   1        2", "   3        4", "   5        6"],
  [],
  [null, "   X        X", "   0        x", "   0        0"],
  [null, null, "VS-045", "VS.046"],
  [null, null, "Melocoton", "Nectarina"],
  [null, null, "Alquezar", "Sta Eulalia"],
  [null, null, 139, 140],
  [null, null, "MID_184", "MID_185"],
  [],
  [],
  [" FILA  1", "   0        0", "   0     pat"],
  [],
  [null, null, null, null, "CAMINO   ", "CENTRAL"],
]);

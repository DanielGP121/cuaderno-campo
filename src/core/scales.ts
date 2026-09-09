/**
 * The scales the groups actually use, with the equivalences needed to move between
 * them. Everything here is data: a project can override or extend it.
 *
 * Sources: EEAD/CITA flowering lists 2026 (F0..C90 per visit), CEBAS forcing protocol
 * (bud stages A/B, BC, C, D, E, F; dormancy released at 50 % >= BC), IMIDA phenology
 * sheets (Baggiolini A..I), UPOV peach descriptors (flower bud density 1/3/5, flower
 * type campanulate/rosette).
 */
import type { ObservationVariable, ScaleCategory } from "./types";

/** Flowering stages as the EEAD lists write them, in field order. */
export const FLOWER_STAGES_EEAD: ScaleCategory[] = [
  { value: "F0", rank: 0, label: "sin flor abierta" },
  { value: "F10", rank: 10, label: "10 % de flores abiertas" },
  { value: "F50", rank: 50, label: "50 % de flores abiertas" },
  { value: "F80", rank: 80, label: "80 % de flores abiertas" },
  { value: "F90", rank: 90, aliases: ["F90-C", "F90C"], label: "90 %, empieza la caída" },
  { value: "C10", rank: 110, label: "10 % de pétalos caídos" },
  { value: "C50", rank: 150, label: "50 % de pétalos caídos" },
  { value: "C90", rank: 190, aliases: ["C"], label: "90 % de pétalos caídos" },
];

/**
 * Baggiolini stages for stone fruit (IMIDA and CEBAS sheets) with the BBCH code each
 * one corresponds to. The F = BBCH 65 = F50 equivalence is the one documented for peach
 * in Mounzer et al. 2008 (HortScience 43:1813); the other codes follow the usual
 * Baggiolini/BBCH correspondence and should be checked against that paper's Fig. 1
 * before being used for anything beyond display.
 */
export const BAGGIOLINI: ScaleCategory[] = [
  { value: "A", rank: 0, label: "yema de invierno" },
  { value: "B", rank: 1, label: "yema hinchada" },
  { value: "C", rank: 2, label: "cáliz visible" },
  { value: "D", rank: 3, label: "corola visible" },
  { value: "E", rank: 4, label: "estambres visibles" },
  { value: "F", rank: 5, label: "flor abierta (plena floración)" },
  { value: "G", rank: 6, label: "caída de pétalos" },
  { value: "H", rank: 7, label: "cuajado" },
  { value: "I", rank: 8, label: "fruto joven" },
];

export const BAGGIOLINI_TO_BBCH: Record<string, number> = {
  A: 0, B: 51, C: 53, D: 57, E: 59, F: 65, G: 67, H: 69, I: 71,
};

/** Bud stages counted in the forcing chamber, as the workbook columns name them. */
export const BUD_STAGE_KEYS = ["AorB", "BC", "C", "D", "E", "F"] as const;
export type BudStageKey = (typeof BUD_STAGE_KEYS)[number];

/** Keys that count as "released from dormancy" (stage BC or later). */
export const BUD_STAGES_RELEASED: readonly BudStageKey[] = ["BC", "C", "D", "E", "F"];

export const TREE_STATUS: ScaleCategory[] = [
  { value: "alive", label: "viva", aliases: ["viva", "v", "x"] },
  { value: "doubtful", label: "dudosa", aliases: ["dudosa", "d", "?"] },
  { value: "dead", label: "baja", aliases: ["baja", "b", "o", "marra"] },
  { value: "missing", label: "ausente", aliases: ["ausente", "m"] },
  { value: "unchecked", label: "sin revisar", aliases: ["sin revisar", "."] },
  { value: "prior", label: "previa", aliases: ["previa"] },
];

export const VARIABLES: Record<string, ObservationVariable> = {
  flowerStageEEAD: {
    id: "flowerStageEEAD",
    name: "Estado de floración (F0 a C90)",
    trait: "flowering stage",
    method: "visual estimate of open flowers and fallen petals on the whole tree",
    scale: "ordinal",
    categories: FLOWER_STAGES_EEAD,
    levels: ["tree"],
  },
  flowerStageBaggiolini: {
    id: "flowerStageBaggiolini",
    name: "Estado Baggiolini (A a I)",
    trait: "flowering stage",
    method: "modal Baggiolini stage of the tree",
    scale: "ordinal",
    categories: BAGGIOLINI,
    levels: ["tree"],
  },
  budStageCounts: {
    id: "budStageCounts",
    name: "Yemas por estado en cámara",
    trait: "bud break in forcing chamber",
    method: "count of flower buds per stage on the tube after 10 days at 24 °C",
    scale: "counts",
    countKeys: [...BUD_STAGE_KEYS],
    levels: ["tube"],
  },
  budReleasedFraction: {
    id: "budReleasedFraction",
    name: "Fracción de yemas más allá de B-C",
    trait: "bud break in forcing chamber",
    method: "fraction of buds at stage BC or later, recorded without the per-stage counts",
    scale: "numeric",
    min: 0,
    max: 1,
    levels: ["tube"],
  },
  flowerBudDensity: {
    id: "flowerBudDensity",
    name: "Densidad de botones florales (UPOV 1 a 9)",
    trait: "flower bud density",
    // UPOV TG/53/7 characteristic 8, scored along the current year's shoots.
    method: "UPOV descriptor, 1 very sparse to 9 very dense",
    scale: "ordinal",
    categories: [
      { value: "1", rank: 1, label: "muy laxa" },
      { value: "3", rank: 3, label: "laxa" },
      { value: "5", rank: 5, label: "media" },
      { value: "7", rank: 7, label: "densa" },
      { value: "9", rank: 9, label: "muy densa" },
    ],
    levels: ["tree"],
  },
  flowerType: {
    id: "flowerType",
    name: "Tipo de flor",
    trait: "flower type",
    // UPOV TG/53/7 characteristic 9: campanulate (small petals, stamens beyond them) or rosette (showy).
    method: "UPOV descriptor",
    scale: "nominal",
    categories: [
      { value: "campanulate", aliases: ["C", "campanulada", "acampanada", "no vistosa"], label: "campanulada" },
      { value: "rosette", aliases: ["R", "rosácea", "rosacea", "roseta", "vistosa", "showy"], label: "rosácea" },
    ],
    levels: ["tree"],
  },
  petalsPerFlower: {
    id: "petalsPerFlower",
    name: "Pétalos por flor",
    trait: "petal number",
    method: "five petals (single flower) or more than five (double flower)",
    scale: "nominal",
    categories: [
      { value: "5", aliases: ["cinco", "single"], label: "5" },
      { value: ">5", aliases: ["más de 5", "mas de 5", "double", "doble"], label: "más de 5" },
    ],
    levels: ["tree"],
  },
  treeStatus: {
    id: "treeStatus",
    name: "Estado del árbol",
    trait: "survival status",
    method: "visual check per census",
    scale: "nominal",
    categories: TREE_STATUS,
    levels: ["tree"],
  },
  note: {
    id: "note",
    name: "Nota",
    trait: "free text",
    method: "typed or dictated",
    scale: "text",
    levels: ["collection", "plot", "row", "tree", "tube"],
  },
};

/** Resolve a raw label (with aliases, case and spacing tolerance) to a category value. */
export function resolveCategory(categories: ScaleCategory[], raw: string | number): ScaleCategory | null {
  const key = String(raw).trim().toLowerCase();
  if (key === "") return null;
  for (const c of categories) {
    if (c.value.toLowerCase() === key) return c;
    if (c.aliases?.some((a) => a.toLowerCase() === key)) return c;
  }
  return null;
}

/** Rank of an ordinal value, or null if unknown. */
export function rankOf(categories: ScaleCategory[], raw: string | number): number | null {
  const c = resolveCategory(categories, raw);
  return c?.rank ?? null;
}

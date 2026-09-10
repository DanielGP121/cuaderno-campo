/**
 * Core domain types.
 *
 * Vocabulary follows BrAPI 2.1 / MIAPPE 1.2 where a term exists (observationUnit,
 * observationLevel, observationVariable, observationTimeStamp) so that exports to
 * Field Book, Germinate or BrAPI need no renaming later. Names shown to people are
 * translated in the UI layer, never here.
 */

/** Levels of the unit hierarchy, from the whole collection down to a forcing tube. */
export type UnitLevel = "collection" | "plot" | "row" | "tree" | "tube";

/**
 * A thing that gets observed: a plot, a row, a tree, or a tube cut from a tree.
 * `id` is a ULID that is never recycled; `name` is the human identifier the group
 * already uses (Cultivar_code for trees, `3_7_A` for tubes, `BP-H3-P027` in Cieza).
 */
export interface ObservationUnit {
  id: string;
  name: string;
  level: UnitLevel;
  parentId?: string;
  /** Variety name ("Summergrand"). */
  accession?: string;
  /** Germplasm bank register ("3801 AD"). */
  accessionNumber?: string;
  /** Tree number inside the collection, the group's primary key for a tree. */
  cultivarCode?: string;
  /** Collection or institution the tree belongs to ("EEAD-CSIC", "CITA"). */
  origin?: string;
  site?: string;
  species?: string;
  plot?: string;
  row?: number;
  /** Row name as written when it is not a number (the CITA collection names rows by letters). */
  rowLabel?: string;
  position?: number;
  /** Replicate tree number (1..3) for the same accession. */
  rep?: number;
  /** Reference tree (cluster head) that gets sampled for the forcing assay. */
  isReference?: boolean;
  /** Belongs to the early-flowering group that is sampled on the early dates. */
  earlyGroup?: boolean;
  /**
   * Tube-level dates and chill: a sampling can be cut over two days with different
   * chill portions (sampling 8 of 2025-2026 was cut on the 29th and the 30th), so the
   * tube keeps its own values and the sampling's are only the default.
   */
  cutDate?: string;
  readDate?: string;
  chillPortions?: number;
  /** Anything else the group tracks per unit (cluster, GWAS id, notes). */
  attributes?: Record<string, string | number | boolean | null>;
  /** Replanting lineage: a new unit in the same hole points back to the old one. */
  replaces?: string;
  replacedBy?: string;
}

/** One weekly cut of branches for the forcing assay. */
export interface Sampling {
  id: string;
  /** Sequential number inside the season (1..14). */
  number: number;
  /** ISO date of the cut in the field. */
  cutDate: string;
  /** ISO date of the reading in the chamber (cut + 10 days by protocol). */
  readDate?: string;
  site?: string;
  /** Chill portions accumulated at the cut date, if the station value is known. */
  chillPortions?: number;
  /** Replicate letters used for the tubes of this sampling. */
  replicates: string[];
  /** Trees that were (or are to be) sampled. */
  treeIds: string[];
  note?: string;
}

export type ScaleKind = "nominal" | "ordinal" | "numeric" | "date" | "text" | "counts";

export interface ScaleCategory {
  /** Stored value. */
  value: string;
  /** Rank for ordinal scales (higher is later). */
  rank?: number;
  /** Alternative spellings accepted on import ("F90-C" for "F90"). */
  aliases?: string[];
  /** Short human label; the UI translates it. */
  label?: string;
}

/** Trait + method + scale, the Crop Ontology model used by Field Book and BrAPI. */
export interface ObservationVariable {
  id: string;
  name: string;
  trait: string;
  method: string;
  scale: ScaleKind;
  categories?: ScaleCategory[];
  /** For "counts": the category keys that make up the count vector. */
  countKeys?: string[];
  min?: number;
  max?: number;
  unit?: string;
  /** Unit levels this variable applies to. */
  levels: UnitLevel[];
}

export type ObservationValue = string | number | boolean | null | Record<string, number>;

/** One append-only observation. Nothing is ever overwritten; corrections point back. */
export interface Observation {
  id: string;
  unitId: string;
  variableId: string;
  value: ObservationValue;
  /** ISO 8601 with offset, when the observation was made. */
  observationTimeStamp: string;
  collector?: string;
  deviceId: string;
  samplingId?: string;
  censusId?: string;
  /** Id of the observation this one corrects. */
  supersedes?: string;
  /** 0 as recorded, 2 corrected, 3 interpolated (RAINFOR flag 4). */
  dataFlag?: 0 | 2 | 3;
  note?: string;
}

/** Kinds of field visit: a phenotyping pass, a drone flight, or an event the sheet writes as a column. */
export type VisitKind = "visit" | "flight" | "pruning" | "treatment" | "irrigation" | "frost" | "other";

/**
 * A dated pass over one or more plots. Visits and flights hold the stage labels of
 * that day (one column of the flowering sheet each); the other kinds are events
 * written between the visit columns (PODA, TRATAM, HELADA) with no label per tree.
 */
export interface FieldVisit {
  id: string;
  /** ISO date. */
  date: string;
  kind: VisitKind;
  /** Column label as the group writes it ("DRON 17 Feb", "PODA 24 feb"); the date alone when absent. */
  label?: string;
  /** Plots the visit covered; absent or empty means every plot. */
  plots?: string[];
  /** "Tªmax-Tª min" of the day as written above the column ("16,1-6,1"). */
  temperature?: string;
  note?: string;
}

/** A census: one pass over all units of a study, with a date range. */
export interface Census {
  id: string;
  name: string;
  startDate: string;
  endDate?: string;
  note?: string;
}

export interface Study {
  id: string;
  title: string;
  species?: string[];
  sites?: string[];
  description?: string;
  createdAt: string;
}

/**
 * Importer for the tree registry (`Peach_Sampling_EEAD_MOSAIC_2025.xlsx`, sheet
 * `Sampling`): one row per accession in the collection with its identity, whether it
 * is a reference tree for the forcing assay, how many tubes it gets, the early group,
 * genetic clusters, plot, health flags, and the date it was cut in each sampling.
 */
import { ulid } from "../ids";
import type { ObservationUnit } from "../types";
import { cellText, findHeader, readWorkbook, sheetByName, type CellValue } from "../xlsx/reader";

export interface RegistryImport {
  trees: ObservationUnit[];
  /** cultivarCode -> samplingNumber -> ISO cut date, from the `Muestreo_n` columns. */
  cutDates: Map<string, Map<number, string>>;
  warnings: string[];
}

function at(row: CellValue[], i: number | undefined): CellValue {
  return i === undefined ? null : (row[i] ?? null);
}

function num(v: CellValue): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.trim().replace(",", "."));
    return Number.isFinite(n) && v.trim() !== "" ? n : null;
  }
  return null;
}

export function importTreeRegistry(bytes: Uint8Array, sheetName = "Sampling"): RegistryImport {
  const wb = readWorkbook(bytes);
  const sheet = sheetByName(wb, sheetName) ?? wb.sheets[0];
  const out: RegistryImport = { trees: [], cutDates: new Map(), warnings: [] };
  if (!sheet) {
    out.warnings.push("empty workbook");
    return out;
  }
  const h = findHeader(sheet, { require: ["ID MOSAIC"] });
  if (!h) {
    out.warnings.push(`${sheet.name}: header with 'ID MOSAIC' not found`);
    return out;
  }
  const c = h.columns;
  const header = sheet.rows[h.rowIndex] ?? [];
  const iId = c.get("ID MOSAIC")!;
  const iOrigin = c.get("Origin");
  const iRef = c.get("Referencia");
  const iReps = c.get("réplicas/muestreo") ?? c.get("replicas/muestreo");
  const iClusterFs = c.get("Cluster Faststructure");
  const iClusterDapc = c.get("DAPC Cluster");
  const iGwasFlag = c.get("GWAS");
  const iFlowering = c.get("Floración") ?? c.get("Floracion");
  const iRipening = c.get("Maduración") ?? c.get("Maduracion");
  const iVariety = c.get("Variedad") ?? c.get("Accession");
  const iAccNo = c.get("Accession number");
  const iGwasId = c.get("ID GWAS Mas-Gomez");
  const iPlot = c.get("Parcela");
  const iTrees = c.get("Trees 2025");
  const iRootstock = c.get("Rootstock");
  const iClass = c.get("Accession classification");
  const iFruitType = c.get("Fruit type");
  const iFlowerType = c.get("Flower type");
  const iBloomType = c.get("Bloom type");
  const iHealth = [...c.keys()].find((k) => /mal estado/i.test(k));
  const iHealthIdx = iHealth ? c.get(iHealth) : undefined;
  const samplingCols: { index: number; number: number }[] = [];
  header.forEach((v, i) => {
    const m = /^muestreo_(\d+)/i.exec(cellText(v));
    if (m) samplingCols.push({ index: i, number: Number(m[1]) });
  });

  for (let r = h.rowIndex + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    const id = cellText(at(row, iId));
    if (id === "" || !/^\d+$/.test(id)) continue;
    const tree: ObservationUnit = { id: ulid(), name: id, level: "tree", cultivarCode: id, attributes: {} };
    const a = tree.attributes!;
    const origin = cellText(at(row, iOrigin));
    if (origin) tree.origin = origin;
    const variety = cellText(at(row, iVariety));
    if (variety) tree.accession = variety;
    const accNo = cellText(at(row, iAccNo));
    if (accNo) tree.accessionNumber = accNo;
    const plot = cellText(at(row, iPlot));
    if (plot) tree.plot = plot;
    tree.isReference = /referencia/i.test(cellText(at(row, iRef)));
    const reps = num(at(row, iReps));
    if (reps !== null) a["replicates"] = reps;
    if (/temprana/i.test(cellText(at(row, iFlowering)))) tree.earlyGroup = true;
    const setAttr = (key: string, i: number | undefined) => {
      const v = at(row, i);
      if (v !== null && v !== "") a[key] = typeof v === "boolean" ? v : typeof v === "number" ? v : String(v).trim();
    };
    setAttr("clusterFaststructure", iClusterFs);
    setAttr("clusterDapc", iClusterDapc);
    setAttr("inGwas", iGwasFlag);
    setAttr("floweringClass", iFlowering);
    setAttr("ripeningClass", iRipening);
    setAttr("gwasId", iGwasId);
    setAttr("treesInField", iTrees);
    setAttr("rootstock", iRootstock);
    setAttr("accessionClassification", iClass);
    setAttr("fruitType", iFruitType);
    setAttr("flowerType", iFlowerType);
    setAttr("bloomType", iBloomType);
    setAttr("healthFlag", iHealthIdx);
    out.trees.push(tree);

    const dates = new Map<number, string>();
    for (const sc of samplingCols) {
      const v = at(row, sc.index);
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) dates.set(sc.number, v.slice(0, 10));
    }
    if (dates.size) out.cutDates.set(id, dates);
  }
  return out;
}

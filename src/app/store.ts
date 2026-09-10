/**
 * Reactive project state for the UI: the folded event log plus the actions the
 * screens need. Every action creates events, writes them to IndexedDB first, then
 * applies them to the in-memory state. No screen mutates state directly.
 */
import { computed, shallowRef, triggerRef } from "vue";
import { applyEvent, emptyState, makeEvent, mergeLogs, replay, type EventPayload, type LogEvent, type ProjectState } from "@core/events";
import { ulid } from "@core/ids";
import type { PlotLayout, TreeStatusValue } from "@core/layout";
import type { FloweringImport } from "@core/importers/mosaicFlowering";
import type { ForcingImport } from "@core/importers/mosaicForcing";
import type { PlotMapImport } from "@core/importers/plotMapRgs";
import type { RegistryImport } from "@core/importers/mosaicRegistry";
import { formatStageLabel } from "@core/phenology";
import { planSampling, tubesAsUnits, type SamplingPlanOptions } from "@core/sampling";
import type { FieldVisit, Observation, ObservationUnit, Sampling, VisitKind } from "@core/types";
import type { BudCounts } from "@core/forcing";
import { appendEvents, getMeta, loadEvents, requestPersistence, setMeta } from "./db";
import { dateOf, liveObservations, NOTE_VARIABLE, STAGE_VARIABLE, stageLabelOf, TYPED_DATE_KEYS, typedDateVariable, visitLabel, type DescriptorKey } from "./floweringData";

export const state = shallowRef<ProjectState>(emptyState());
export const events = shallowRef<LogEvent[]>([]);
export const deviceId = shallowRef<string>("");
export const deviceLabel = shallowRef<string>("");
export const ready = shallowRef(false);

/** Device id the xlsx importers stamp on what they read. */
const IMPORT_DEVICE = "import:xlsx";

function bump(): void {
  triggerRef(state);
  triggerRef(events);
}

export async function init(): Promise<void> {
  let id = await getMeta("deviceId");
  if (!id) {
    id = ulid();
    await setMeta("deviceId", id);
  }
  deviceId.value = id;
  deviceLabel.value = (await getMeta("deviceLabel")) ?? "";
  const log = await loadEvents();
  events.value = log;
  state.value = replay(log);
  ready.value = true;
  void requestPersistence();
}

export async function setDeviceLabel(label: string): Promise<void> {
  deviceLabel.value = label;
  await setMeta("deviceLabel", label);
  await commit([{ type: "device.register", deviceId: deviceId.value, label }]);
}

/**
 * Write events to disk, then fold them. The order matters: disk first. Payloads are
 * cloned through JSON so that Vue proxies (a reactive counter, a unit taken from a
 * computed list) never reach IndexedDB, which cannot clone them.
 */
export async function commit(payloads: EventPayload[], at: string = new Date().toISOString()): Promise<LogEvent[]> {
  const evs = payloads.map((p) => makeEvent(deviceId.value, JSON.parse(JSON.stringify(p)) as EventPayload, at));
  await appendEvents(evs);
  for (const e of evs) applyEvent(state.value, e);
  events.value = events.value.concat(evs);
  bump();
  return evs;
}

/** Merge a log from another device (or a backup of this one). Idempotent. */
export async function mergeExternal(log: LogEvent[]): Promise<number> {
  const known = state.value.applied;
  const fresh = log.filter((e) => !known.has(e.id));
  if (fresh.length === 0) return 0;
  await appendEvents(fresh);
  const all = mergeLogs(events.value, fresh);
  events.value = all;
  state.value = replay(all);
  bump();
  return fresh.length;
}

/**
 * Timestamp of something done in the field on a chosen day: that date with the
 * clock time and offset of this device, so the day never shifts when the log is read
 * in another time zone and the order of two taps on the same day is still known.
 */
export function localTimestamp(date: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const off = -now.getTimezoneOffset();
  const abs = Math.abs(off);
  return `${date}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${off >= 0 ? "+" : "-"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// ---------------------------------------------------------------- derived views

export const trees = computed(() => {
  void state.value;
  return [...state.value.units.values()].filter((u) => u.level === "tree" && !state.value.retiredUnits.has(u.id));
});

export const tubes = computed(() => {
  void state.value;
  return [...state.value.units.values()].filter((u) => u.level === "tube" && !state.value.retiredUnits.has(u.id));
});

export const samplings = computed(() => {
  void state.value;
  return [...state.value.samplings.values()].sort((a, b) => a.number - b.number);
});

export const observations = computed(() => {
  void state.value;
  return [...state.value.observations.values()];
});

export const layouts = computed<PlotLayout[]>(() => {
  void state.value;
  return [...state.value.layouts.values()].map((l) => l.layout as PlotLayout);
});

export const visits = computed<FieldVisit[]>(() => {
  void state.value;
  return [...state.value.visits.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.label ?? "").localeCompare(b.label ?? ""));
});

/** Plots known to the project: those with a map first, in map order, then the rest by name. */
export const plots = computed<string[]>(() => {
  const out = layouts.value.map((l) => l.plot);
  const seen = new Set(out);
  const others = [...new Set(trees.value.map((t) => t.plot ?? "").filter((p) => p !== "" && !seen.has(p)))].sort();
  return out.concat(others);
});

export const suggestions = computed<Observation[]>(() => {
  void state.value;
  return liveObservations(state.value)
    .filter((o) => o.variableId === "suggestion")
    .sort((a, b) => a.observationTimeStamp.localeCompare(b.observationTimeStamp));
});

export function treeById(id: string): ObservationUnit | undefined {
  return state.value.units.get(id);
}

export function tubesOfSampling(sampling: Sampling): ObservationUnit[] {
  return tubes.value.filter((t) => t.attributes?.["samplingId"] === sampling.id || t.attributes?.["samplingNumber"] === sampling.number);
}

// ---------------------------------------------------------------- actions: registry and forcing

export async function importRegistry(imp: RegistryImport): Promise<number> {
  // Trees already known by cultivar code are updated in place (same id), the rest created.
  const byCode = new Map(trees.value.filter((t) => t.cultivarCode).map((t) => [t.cultivarCode!, t]));
  const payloads: EventPayload[] = imp.trees.map((t) => {
    const existing = byCode.get(t.cultivarCode!);
    return { type: "unit.upsert", unit: existing ? { ...existing, ...t, id: existing.id } : t };
  });
  await commit(payloads);
  return payloads.length;
}

export async function importSeason(imp: ForcingImport): Promise<number> {
  const byCode = new Map(trees.value.filter((t) => t.cultivarCode).map((t) => [t.cultivarCode!, t]));
  const idMap = new Map<string, string>();
  const payloads: EventPayload[] = [];
  for (const t of imp.trees) {
    const existing = byCode.get(t.cultivarCode!);
    if (existing) {
      idMap.set(t.id, existing.id);
      payloads.push({ type: "unit.upsert", unit: { ...existing, accession: existing.accession ?? t.accession, earlyGroup: existing.earlyGroup || t.earlyGroup, isReference: true } as ObservationUnit });
    } else {
      idMap.set(t.id, t.id);
      payloads.push({ type: "unit.upsert", unit: t });
    }
  }
  const existingSamplings = new Map(samplings.value.map((s) => [s.number, s]));
  const samplingIdMap = new Map<string, string>();
  for (const s of imp.samplings) {
    const ex = existingSamplings.get(s.number);
    const merged: Sampling = ex ? { ...ex, ...s, id: ex.id, treeIds: [...new Set([...ex.treeIds, ...s.treeIds.map((id) => idMap.get(id) ?? id)])] } : { ...s, treeIds: s.treeIds.map((id) => idMap.get(id) ?? id) };
    samplingIdMap.set(s.id, merged.id);
    payloads.push({ type: "sampling.upsert", sampling: merged });
  }
  const existingTubes = new Map(tubes.value.map((t) => [t.name, t]));
  const tubeIdMap = new Map<string, string>();
  for (const tube of imp.tubes) {
    const ex = existingTubes.get(tube.name);
    const parentId = tube.parentId ? (idMap.get(tube.parentId) ?? tube.parentId) : undefined;
    const attrs = { ...(tube.attributes ?? {}) };
    const sn = attrs["samplingNumber"];
    const sampling = typeof sn === "number" ? imp.samplings.find((s) => s.number === sn) : undefined;
    if (sampling) attrs["samplingId"] = samplingIdMap.get(sampling.id) ?? sampling.id;
    const unit: ObservationUnit = { ...tube, id: ex?.id ?? tube.id, attributes: attrs };
    if (parentId) unit.parentId = parentId;
    tubeIdMap.set(tube.id, unit.id);
    payloads.push({ type: "unit.upsert", unit });
  }
  for (const o of imp.observations) {
    const obs: Observation = { ...o, unitId: tubeIdMap.get(o.unitId) ?? o.unitId };
    if (o.samplingId) obs.samplingId = samplingIdMap.get(o.samplingId) ?? o.samplingId;
    payloads.push({ type: "observation.add", observation: obs });
  }
  await commit(payloads);
  return payloads.length;
}

export async function createSampling(opts: SamplingPlanOptions): Promise<Sampling> {
  const plan = planSampling(trees.value, opts);
  const units = tubesAsUnits(plan);
  await commit([{ type: "sampling.upsert", sampling: plan.sampling }, ...units.map((u) => ({ type: "unit.upsert" as const, unit: u }))]);
  return plan.sampling;
}

/** Mark the branches of a tree as cut in a sampling (or undo it with cut=false). */
export async function markCut(sampling: Sampling, tree: ObservationUnit, cut: boolean): Promise<void> {
  const obs: Observation = {
    id: ulid(),
    unitId: tree.id,
    variableId: "branchesCut",
    value: cut,
    observationTimeStamp: new Date().toISOString(),
    deviceId: deviceId.value,
    samplingId: sampling.id,
  };
  if (deviceLabel.value) obs.collector = deviceLabel.value;
  await commit([{ type: "observation.add", observation: obs }]);
}

export function isCut(sampling: Sampling, tree: ObservationUnit): boolean {
  let latest: Observation | null = null;
  for (const o of state.value.observations.values()) {
    if (o.unitId === tree.id && o.variableId === "branchesCut" && o.samplingId === sampling.id) {
      if (!latest || o.observationTimeStamp > latest.observationTimeStamp || (o.observationTimeStamp === latest.observationTimeStamp && o.id > latest.id)) latest = o;
    }
  }
  return latest?.value === true;
}

/** Save a chamber reading for a tube: per-stage counts, or an explicit "none released" with the total. */
export async function saveReading(tube: ObservationUnit, sampling: Sampling, counts: BudCounts, note: string, readDate: string): Promise<Observation> {
  const obs: Observation = {
    id: ulid(),
    unitId: tube.id,
    variableId: "budStageCounts",
    value: counts,
    observationTimeStamp: `${readDate}T${new Date().toISOString().slice(11, 19)}Z`,
    deviceId: deviceId.value,
    samplingId: sampling.id,
  };
  if (deviceLabel.value) obs.collector = deviceLabel.value;
  if (note.trim()) obs.note = note.trim();
  const updated: ObservationUnit = { ...tube, readDate };
  await commit([{ type: "unit.upsert", unit: updated }, { type: "observation.add", observation: obs }]);
  return obs;
}

// ---------------------------------------------------------------- actions: plots and flowering

/**
 * Load the plot maps: one layout per plot (a re-import bumps the version and keeps
 * the id) and one unit per drawn position, matched by name (`J5-F15-A004`) to the
 * trees already known so that a list imported earlier is not duplicated. Identity
 * already known wins over what the map says; the map wins on how the position is
 * drawn (kind, symbol, status).
 */
export async function importLayouts(imp: PlotMapImport): Promise<{ layouts: number; trees: number }> {
  const byName = new Map(trees.value.map((t) => [t.name, t]));
  const payloads: EventPayload[] = [];
  let nTrees = 0;
  for (const layout of imp.layouts) {
    const existing = layouts.value.find((l) => l.plot === layout.plot);
    const id = existing?.id ?? layout.id;
    const version = (state.value.layouts.get(id)?.version ?? 0) + 1;
    payloads.push({ type: "layout.set", layoutId: id, layout: { ...layout, id }, version });
    for (const unit of imp.trees) {
      if (unit.attributes?.["layoutId"] !== layout.id) continue;
      const attributes = { ...(unit.attributes ?? {}), layoutId: id };
      const ex = byName.get(unit.name);
      const merged: ObservationUnit = ex ? { ...unit, ...ex, id: ex.id, attributes: { ...(ex.attributes ?? {}), ...attributes } } : { ...unit, attributes };
      byName.set(merged.name, merged);
      payloads.push({ type: "unit.upsert", unit: merged });
      nTrees++;
    }
  }
  await commit(payloads);
  return { layouts: imp.layouts.length, trees: nTrees };
}

function kindOfEventLabel(label: string): VisitKind {
  if (/^PODA/i.test(label)) return "pruning";
  if (/^TRAT/i.test(label)) return "treatment";
  if (/^RIEGO/i.test(label)) return "irrigation";
  if (/^HELADA/i.test(label)) return "frost";
  if (/^DRON/i.test(label)) return "flight";
  return "other";
}

/** Key that makes a re-import of the same sheet a no-op for what is already here. */
function observationKey(o: Observation): string {
  const v = o.variableId === STAGE_VARIABLE ? stageLabelOf(o) : JSON.stringify(o.value);
  return `${o.unitId}|${o.variableId}|${dateOf(o)}|${v}|${o.dataFlag ?? 0}`;
}

function visitKey(v: FieldVisit): string {
  return `${v.date}|${v.kind}|${[...(v.plots ?? [])].sort().join(",")}`;
}

export interface FloweringImportSummary {
  trees: number;
  observations: number;
  visits: number;
  /** Observations already present, skipped. */
  skipped: number;
}

/**
 * Load a flowering list (by visit or by drone flight): trees matched by position name
 * to the ones on the maps, one visit per column and sheet, the stage labels as
 * observations (deduplicated, so loading the same file twice adds nothing), the
 * event words per tree, and the dates typed by hand as their own observations.
 */
export async function importFlowering(imp: FloweringImport): Promise<FloweringImportSummary> {
  const byName = new Map(trees.value.map((t) => [t.name, t]));
  const idMap = new Map<string, string>();
  const payloads: EventPayload[] = [];
  const season = imp.visits[0] ? Number(imp.visits[0].date.slice(0, 4)) : undefined;
  for (const t of imp.trees) {
    const ex = byName.get(t.name);
    const attributes = { ...(ex?.attributes ?? {}), ...(t.attributes ?? {}) };
    if (attributes["notPhenotyped"] === true && season !== undefined) attributes["notPhenotypedSeason"] = season;
    const merged: ObservationUnit = ex ? { ...ex, ...t, id: ex.id, attributes } : { ...t, attributes };
    idMap.set(t.id, merged.id);
    byName.set(merged.name, merged);
    payloads.push({ type: "unit.upsert", unit: merged });
  }

  // Visits: the plots a sheet covers are those of its trees.
  const plotsBySheet = new Map<string, Set<string>>();
  for (const t of imp.trees) {
    const sheet = String(t.attributes?.["sheet"] ?? "");
    if (!t.plot) continue;
    let set = plotsBySheet.get(sheet);
    if (!set) {
      set = new Set();
      plotsBySheet.set(sheet, set);
    }
    set.add(t.plot);
  }
  const known = new Map(visits.value.map((v) => [visitKey(v), v]));
  let nVisits = 0;
  const addVisit = (date: string, kind: VisitKind, label: string | undefined, sheet: string, temperature?: string) => {
    const draft: FieldVisit = { id: ulid(), date, kind, plots: [...(plotsBySheet.get(sheet) ?? [])].sort() };
    if (label) draft.label = label.trim();
    if (temperature) draft.temperature = temperature;
    const ex = known.get(visitKey(draft));
    if (ex) {
      const updated: FieldVisit = { ...ex };
      if (draft.label && !ex.label) updated.label = draft.label;
      if (draft.temperature && !ex.temperature) updated.temperature = draft.temperature;
      if (JSON.stringify(updated) !== JSON.stringify(ex)) payloads.push({ type: "visit.upsert", visit: updated });
      return;
    }
    known.set(visitKey(draft), draft);
    payloads.push({ type: "visit.upsert", visit: draft });
    nVisits++;
  };
  for (const v of imp.visits) addVisit(v.date, v.flight ? "flight" : "visit", v.flight, v.sheet, v.temperature);
  for (const e of imp.events) if (!e.flight && e.date) addVisit(e.date, kindOfEventLabel(e.label), e.label, e.sheet);

  const seen = new Set(liveObservations(state.value).map(observationKey));
  let nObs = 0;
  let skipped = 0;
  const add = (o: Observation) => {
    const k = observationKey(o);
    if (seen.has(k)) {
      skipped++;
      return;
    }
    seen.add(k);
    payloads.push({ type: "observation.add", observation: o });
    nObs++;
  };
  for (const o of imp.observations) add({ ...o, unitId: idMap.get(o.unitId) ?? o.unitId });
  const idByName = new Map([...byName.values()].map((t) => [t.name, t.id]));
  for (const e of imp.treeEvents) {
    const unitId = idByName.get(e.tree);
    if (!unitId) continue;
    add({ id: ulid(), unitId, variableId: NOTE_VARIABLE, value: e.label, observationTimeStamp: `${e.date}T12:00:00Z`, deviceId: IMPORT_DEVICE });
  }
  for (const r of imp.reported) {
    const unitId = idMap.get(r.treeId) ?? r.treeId;
    for (const key of TYPED_DATE_KEYS) {
      const d = r[key];
      if (d) add({ id: ulid(), unitId, variableId: typedDateVariable(key), value: d, observationTimeStamp: `${d}T00:00:00Z`, deviceId: IMPORT_DEVICE });
    }
  }
  await commit(payloads);
  return { trees: imp.trees.length, observations: nObs, visits: nVisits, skipped };
}

export async function upsertVisit(visit: FieldVisit): Promise<FieldVisit> {
  await commit([{ type: "visit.upsert", visit }]);
  return visit;
}

/** The visit of a day and kind that covers a plot, if there is one. */
export function findVisit(date: string, kind: VisitKind, plot?: string): FieldVisit | undefined {
  return visits.value.find((v) => v.date === date && v.kind === kind && (!plot || !v.plots?.length || v.plots.includes(plot)));
}

/** The visit of a day and kind for a plot, created when it does not exist yet. */
export async function ensureVisit(date: string, kind: VisitKind, plot?: string, extra: Partial<Pick<FieldVisit, "label" | "temperature" | "note">> = {}): Promise<FieldVisit> {
  const ex = findVisit(date, kind, plot);
  if (ex) {
    const updated: FieldVisit = { ...ex };
    if (extra.label !== undefined && extra.label !== "") updated.label = extra.label;
    if (extra.temperature !== undefined && extra.temperature !== "") updated.temperature = extra.temperature;
    if (extra.note !== undefined && extra.note !== "") updated.note = extra.note;
    if (JSON.stringify(updated) !== JSON.stringify(ex)) await upsertVisit(updated);
    return updated;
  }
  const v: FieldVisit = { id: ulid(), date, kind, plots: plot ? [plot] : [] };
  if (extra.label) v.label = extra.label;
  if (extra.temperature) v.temperature = extra.temperature;
  if (extra.note) v.note = extra.note;
  return upsertVisit(v);
}

export interface StageInput {
  /** Pre-bloom letters ("DE"), empty when none. */
  pre: string;
  /** Percentage of open flowers. */
  open: number;
  /** Percentage of fallen petals; 1 means "started" (a bare C). */
  fall: number;
}

/**
 * Record the stage of a tree at a visit, as the group would write it ("DE-F1",
 * "F95-C10"). The value keeps the percentages, the note keeps the letters and the
 * label; `estimated` marks a value not observed that day (red in the sheet).
 */
export async function saveStage(tree: ObservationUnit, visit: FieldVisit, stage: StageInput, opts: { estimated?: boolean; note?: string } = {}): Promise<Observation> {
  const label = formatStageLabel(stage);
  const noteParts = [stage.pre ? `pre:${stage.pre.toUpperCase()}` : "", `raw:${label}`, visit.kind === "flight" ? `flight:${visitLabel(visit)}` : "", opts.note?.trim() ? `note:${opts.note.trim()}` : ""].filter(Boolean);
  const obs: Observation = {
    id: ulid(),
    unitId: tree.id,
    variableId: STAGE_VARIABLE,
    value: { open: stage.open, fall: stage.fall },
    observationTimeStamp: localTimestamp(visit.date),
    deviceId: deviceId.value,
    note: noteParts.join(";"),
  };
  if (deviceLabel.value) obs.collector = deviceLabel.value;
  if (opts.estimated) obs.dataFlag = 3;
  await commit([{ type: "observation.add", observation: obs }]);
  return obs;
}

/** Undo an observation: a null value that supersedes it. Nothing is deleted. */
export async function retract(o: Observation): Promise<void> {
  const undo: Observation = {
    id: ulid(),
    unitId: o.unitId,
    variableId: o.variableId,
    value: null,
    observationTimeStamp: new Date().toISOString(),
    deviceId: deviceId.value,
    supersedes: o.id,
    note: "undo",
  };
  await commit([{ type: "observation.add", observation: undo }]);
}

/** A UPOV descriptor of the tree, scored on a visit day: kept on the unit for the export, logged as an observation for the history. */
export async function saveDescriptor(tree: ObservationUnit, key: DescriptorKey, value: string | number, date?: string): Promise<void> {
  const obs: Observation = { id: ulid(), unitId: tree.id, variableId: key, value, observationTimeStamp: date ? localTimestamp(date) : new Date().toISOString(), deviceId: deviceId.value };
  if (deviceLabel.value) obs.collector = deviceLabel.value;
  // the screen may hold a copy from before the last save: merge into the unit as it is now
  const now = state.value.units.get(tree.id) ?? tree;
  const updated: ObservationUnit = { ...now, attributes: { ...(now.attributes ?? {}), [key]: value } };
  await commit([{ type: "unit.upsert", unit: updated }, { type: "observation.add", observation: obs }]);
}

/** Survival status seen on a day (dead, doubtful, alive again). */
export async function setTreeStatus(tree: ObservationUnit, status: TreeStatusValue, date: string): Promise<void> {
  const obs: Observation = { id: ulid(), unitId: tree.id, variableId: "treeStatus", value: status, observationTimeStamp: localTimestamp(date), deviceId: deviceId.value };
  if (deviceLabel.value) obs.collector = deviceLabel.value;
  const now = state.value.units.get(tree.id) ?? tree;
  const updated: ObservationUnit = { ...now, attributes: { ...(now.attributes ?? {}), status } };
  await commit([{ type: "unit.upsert", unit: updated }, { type: "observation.add", observation: obs }]);
}

/** A suggestion typed in the app, kept in the log so it travels with the backup. */
export async function saveSuggestion(text: string): Promise<void> {
  const obs: Observation = { id: ulid(), unitId: "app", variableId: "suggestion", value: text.trim(), observationTimeStamp: new Date().toISOString(), deviceId: deviceId.value };
  if (deviceLabel.value) obs.collector = deviceLabel.value;
  await commit([{ type: "observation.add", observation: obs }]);
}

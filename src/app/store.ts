/**
 * Reactive project state for the UI: the folded event log plus the actions the
 * screens need. Every action creates events, writes them to IndexedDB first, then
 * applies them to the in-memory state. No screen mutates state directly.
 */
import { computed, shallowRef, triggerRef } from "vue";
import { applyEvent, emptyState, makeEvent, mergeLogs, replay, type EventPayload, type LogEvent, type ProjectState } from "@core/events";
import { ulid } from "@core/ids";
import type { ForcingImport } from "@core/importers/mosaicForcing";
import type { RegistryImport } from "@core/importers/mosaicRegistry";
import { planSampling, tubesAsUnits, type SamplingPlanOptions } from "@core/sampling";
import type { Observation, ObservationUnit, Sampling } from "@core/types";
import type { BudCounts } from "@core/forcing";
import { appendEvents, getMeta, loadEvents, requestPersistence, setMeta } from "./db";

export const state = shallowRef<ProjectState>(emptyState());
export const events = shallowRef<LogEvent[]>([]);
export const deviceId = shallowRef<string>("");
export const deviceLabel = shallowRef<string>("");
export const ready = shallowRef(false);

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

export function treeById(id: string): ObservationUnit | undefined {
  return state.value.units.get(id);
}

export function tubesOfSampling(sampling: Sampling): ObservationUnit[] {
  return tubes.value.filter((t) => t.attributes?.["samplingId"] === sampling.id || t.attributes?.["samplingNumber"] === sampling.number);
}

// ---------------------------------------------------------------- actions

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

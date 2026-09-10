/**
 * Append-only event log and the project state derived from it.
 *
 * Every change (a unit created, an observation added, a sampling opened, a geometry
 * set) is an event with a ULID, a timestamp and the device that produced it. The
 * state is a pure fold over the events, so two phones merge by taking the union of
 * their logs: observations never collide (each is its own event), and for the few
 * mutable documents (units, samplings, layout) the latest event wins.
 */
import { ulid } from "./ids";
import type { Census, FieldVisit, Observation, ObservationUnit, Sampling, Study } from "./types";

export type EventPayload =
  | { type: "study.set"; study: Study }
  | { type: "unit.upsert"; unit: ObservationUnit }
  | { type: "unit.retire"; unitId: string; reason?: string }
  | { type: "sampling.upsert"; sampling: Sampling }
  | { type: "census.upsert"; census: Census }
  | { type: "visit.upsert"; visit: FieldVisit }
  | { type: "observation.add"; observation: Observation }
  | { type: "layout.set"; layoutId: string; layout: unknown; version: number }
  | { type: "device.register"; deviceId: string; label: string };

export interface LogEvent {
  id: string;
  /** ISO 8601 with offset. */
  at: string;
  deviceId: string;
  payload: EventPayload;
}

export interface ProjectState {
  study: Study | null;
  units: Map<string, ObservationUnit>;
  retiredUnits: Set<string>;
  samplings: Map<string, Sampling>;
  censuses: Map<string, Census>;
  visits: Map<string, FieldVisit>;
  observations: Map<string, Observation>;
  layouts: Map<string, { layout: unknown; version: number }>;
  devices: Map<string, string>;
  /** Ids of every event folded in, so a merge can skip duplicates cheaply. */
  applied: Set<string>;
}

export function emptyState(): ProjectState {
  return {
    study: null,
    units: new Map(),
    retiredUnits: new Set(),
    samplings: new Map(),
    censuses: new Map(),
    visits: new Map(),
    observations: new Map(),
    layouts: new Map(),
    devices: new Map(),
    applied: new Set(),
  };
}

export function makeEvent(deviceId: string, payload: EventPayload, at: string = new Date().toISOString()): LogEvent {
  return { id: ulid(), at, deviceId, payload };
}

/** Fold one event into the state. Idempotent: an event already applied is ignored. */
export function applyEvent(state: ProjectState, e: LogEvent): ProjectState {
  if (state.applied.has(e.id)) return state;
  state.applied.add(e.id);
  const p = e.payload;
  switch (p.type) {
    case "study.set":
      state.study = p.study;
      break;
    case "unit.upsert":
      state.units.set(p.unit.id, p.unit);
      break;
    case "unit.retire":
      state.retiredUnits.add(p.unitId);
      break;
    case "sampling.upsert":
      state.samplings.set(p.sampling.id, p.sampling);
      break;
    case "census.upsert":
      state.censuses.set(p.census.id, p.census);
      break;
    case "visit.upsert":
      state.visits.set(p.visit.id, p.visit);
      break;
    case "observation.add":
      state.observations.set(p.observation.id, p.observation);
      break;
    case "layout.set": {
      const cur = state.layouts.get(p.layoutId);
      if (!cur || p.version >= cur.version) state.layouts.set(p.layoutId, { layout: p.layout, version: p.version });
      break;
    }
    case "device.register":
      state.devices.set(p.deviceId, p.label);
      break;
  }
  return state;
}

/**
 * Rebuild the state from any number of logs. Events are applied in (at, id) order so
 * that "latest wins" means the same thing on every device regardless of the order the
 * logs arrived in.
 */
export function replay(...logs: LogEvent[][]): ProjectState {
  const all = mergeLogs(...logs);
  const state = emptyState();
  for (const e of all) applyEvent(state, e);
  return state;
}

/** Union of logs by event id, sorted by (at, id). This is the whole sync protocol. */
export function mergeLogs(...logs: LogEvent[][]): LogEvent[] {
  const byId = new Map<string, LogEvent>();
  for (const log of logs) for (const e of log) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.at < b.at ? -1 : 1));
}

/** Serialise a log as JSON Lines (one event per line), the on-disk and share format. */
export function toJsonl(log: LogEvent[]): string {
  return log.map((e) => JSON.stringify(e)).join("\n") + (log.length ? "\n" : "");
}

export function fromJsonl(text: string): LogEvent[] {
  const out: LogEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let e: LogEvent;
    try {
      e = JSON.parse(t) as LogEvent;
    } catch {
      continue; // a torn last line after a crash must not poison the whole log
    }
    if (e && typeof e.id === "string" && typeof e.at === "string" && e.payload && typeof e.payload.type === "string") out.push(e);
  }
  return out;
}

/** Live (not retired) units of a level. */
export function unitsOfLevel(state: ProjectState, level: ObservationUnit["level"]): ObservationUnit[] {
  return [...state.units.values()].filter((u) => u.level === level && !state.retiredUnits.has(u.id));
}

/** Observations of a unit, newest first, superseded ones removed. */
export function observationsOf(state: ProjectState, unitId: string, variableId?: string): Observation[] {
  const superseded = new Set<string>();
  for (const o of state.observations.values()) if (o.supersedes) superseded.add(o.supersedes);
  return [...state.observations.values()]
    .filter((o) => o.unitId === unitId && (!variableId || o.variableId === variableId) && !superseded.has(o.id))
    .sort((a, b) => (a.observationTimeStamp === b.observationTimeStamp ? (a.id < b.id ? 1 : -1) : a.observationTimeStamp < b.observationTimeStamp ? 1 : -1));
}

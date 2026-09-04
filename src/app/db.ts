/**
 * Persistence: the event log lives in IndexedDB (Dexie). Every event is written
 * before the screen updates, so a phone that dies mid-reading keeps everything up to
 * the last tap. The state is rebuilt from the log at start-up.
 */
import Dexie, { type EntityTable } from "dexie";
import type { LogEvent } from "@core/events";

interface MetaRow {
  key: string;
  value: string;
}

class CuadernoDb extends Dexie {
  events!: EntityTable<LogEvent, "id">;
  meta!: EntityTable<MetaRow, "key">;

  constructor() {
    super("cuaderno-campo");
    this.version(1).stores({
      events: "id, at, deviceId",
      meta: "key",
    });
  }
}

export const db = new CuadernoDb();

export async function loadEvents(): Promise<LogEvent[]> {
  return db.events.orderBy("at").toArray();
}

export async function appendEvents(events: LogEvent[]): Promise<void> {
  if (events.length === 0) return;
  await db.events.bulkPut(events);
}

export async function getMeta(key: string): Promise<string | null> {
  const row = await db.meta.get(key);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}

export async function wipeAll(): Promise<void> {
  await db.transaction("rw", db.events, db.meta, async () => {
    await db.events.clear();
    await db.meta.clear();
  });
}

/** Ask the browser not to evict our storage when space runs low (installed PWAs get it by default on Chromium). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* not available */
  }
  return false;
}

/**
 * Access to the real workbooks on this machine. `local.config.json` is gitignored;
 * when it or a path is missing the calling test skips itself, so the suite is green
 * on any clone while the reproduction tests only run where the data lives.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type Config = { mosaic?: Record<string, string>; cieza?: Record<string, string> };

let cached: Config | null | undefined;

export function localConfig(): Config | null {
  if (cached !== undefined) return cached;
  const p = resolve(process.cwd(), "local.config.json");
  cached = existsSync(p) ? (JSON.parse(readFileSync(p, "utf-8")) as Config) : null;
  return cached;
}

/** Path of a configured real file if it exists on disk, else null. */
export function localPath(group: "mosaic" | "cieza", key: string): string | null {
  const cfg = localConfig();
  const p = cfg?.[group]?.[key];
  return p && existsSync(p) ? p : null;
}

export function readLocalBytes(group: "mosaic" | "cieza", key: string): Uint8Array | null {
  const p = localPath(group, key);
  return p ? new Uint8Array(readFileSync(p)) : null;
}

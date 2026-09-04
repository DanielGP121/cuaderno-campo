/**
 * Identifiers: ULIDs for internal ids, and the tube-code conventions the groups
 * already use so that exports match their spreadsheets byte for byte.
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID: 48-bit millisecond timestamp + 80 random bits, Crockford base32, sortable. */
export function ulid(now: number = Date.now()): string {
  let time = now;
  const timeChars = new Array<string>(10);
  for (let i = 9; i >= 0; i--) {
    timeChars[i] = CROCKFORD[time % 32]!;
    time = Math.floor(time / 32);
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i]! % 32];
  return timeChars.join("") + rand;
}

export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Tube code as written in the EEAD forcing workbooks: `<cultivarCode>_<sampling>_<rep>`,
 * for example `3_7_A`. When a tree has a single tube the replicate is omitted (`1_7`).
 */
export function tubeCode(cultivarCode: string | number, samplingNumber: number, rep?: string): string {
  const base = `${cultivarCode}_${samplingNumber}`;
  return rep ? `${base}_${rep}` : base;
}

export interface ParsedTubeCode {
  cultivarCode: string;
  samplingNumber: number;
  rep?: string;
}

/**
 * Parse `3_7_A`, `1_7` or the legacy `4_1_` (trailing underscore, seen in the 2025
 * biochemical list). Returns null for anything else.
 */
export function parseTubeCode(code: string): ParsedTubeCode | null {
  const m = /^([A-Za-z0-9-]+)_(\d+)(?:_([A-Za-z0-9]*))?$/.exec(code.trim());
  if (!m) return null;
  const rep = m[3] && m[3].length > 0 ? m[3] : undefined;
  return rep === undefined
    ? { cultivarCode: m[1]!, samplingNumber: Number(m[2]) }
    : { cultivarCode: m[1]!, samplingNumber: Number(m[2]), rep };
}

/** Replicate letters in the order the group uses them. */
export function replicateLetters(n: number): string[] {
  return Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
}

/**
 * Human name of a tree from its position, croquis-campo style: `J4-F8-A1`
 * (plot, row, tree). Zero-padded so that names sort in field order.
 */
export function treeName(plot: string, row: number, position: number): string {
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${plot}-F${pad(row, 2)}-A${pad(position, 3)}`;
}

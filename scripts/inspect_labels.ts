import { readFileSync } from "node:fs";
import { importFloweringList } from "../src/core/importers/mosaicFlowering";
const cfg = JSON.parse(readFileSync("local.config.json", "utf-8"));
const imp = importFloweringList(new Uint8Array(readFileSync(cfg.mosaic.flowering_list)));
const counts = new Map<string, number>();
for (const u of imp.unparsed) counts.set(u.label, (counts.get(u.label) ?? 0) + 1);
console.log("observations:", imp.observations.length, "unparsed:", imp.unparsed.length, "trees:", imp.trees.length, "reported rows:", imp.reported.length, "events:", imp.events.length);
console.log([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => `${k}×${n}`).join("  "));

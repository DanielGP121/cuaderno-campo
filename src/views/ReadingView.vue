<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { t } from "../app/i18n";
import { todayIso } from "../app/files";
import { samplings, saveReading, state, treeById, tubesOfSampling } from "../app/store";
import { dropAt, previousPoint, readTubeIds, treeCurve } from "../app/forcingData";
import { emptyCounts, fractionReleased, totalBuds, type BudCounts } from "@core/forcing";
import { BUD_STAGE_KEYS, type BudStageKey } from "@core/scales";
import { daysBetween } from "@core/phenology";
import type { ObservationUnit, Sampling } from "@core/types";

const selectedId = ref<string>(samplings.value.at(-1)?.id ?? "");
watch(samplings, (list) => {
  if (!selectedId.value && list.length) selectedId.value = list.at(-1)!.id;
});
const selected = computed<Sampling | undefined>(() => samplings.value.find((s) => s.id === selectedId.value));

const currentTubeId = ref<string>("");
const counts = ref<BudCounts>(emptyCounts());
const note = ref("");
const readDate = ref(todayIso());
const codeInput = ref("");
const savedFlash = ref("");
const scanning = ref(false);
const scanError = ref("");
const video = ref<HTMLVideoElement | null>(null);
let stream: MediaStream | null = null;
let scanTimer: number | null = null;

const tubeRows = computed(() => {
  void state.value;
  const s = selected.value;
  if (!s) return [];
  const read = readTubeIds(state.value);
  const list = tubesOfSampling(s).map((tube) => ({ tube, tree: tube.parentId ? treeById(tube.parentId) : undefined, read: read.has(tube.id) }));
  return list.sort((a, b) => (Number(a.tree?.cultivarCode) || 0) - (Number(b.tree?.cultivarCode) || 0) || (a.tube.rep ?? 0) - (b.tube.rep ?? 0) || a.tube.name.localeCompare(b.tube.name));
});
const nRead = computed(() => tubeRows.value.filter((r) => r.read).length);

const currentTube = computed<ObservationUnit | undefined>(() => tubeRows.value.find((r) => r.tube.id === currentTubeId.value)?.tube);
const currentTree = computed(() => (currentTube.value?.parentId ? treeById(currentTube.value.parentId) : undefined));

const total = computed(() => totalBuds(counts.value));
const fraction = computed(() => fractionReleased(counts.value));

const curve = computed(() => {
  const tree = currentTree.value;
  const tube = currentTube.value;
  if (!tree || !tube) return [];
  return treeCurve(state.value, tree, total.value > 0 ? { tubeId: tube.id, counts: counts.value } : undefined);
});
const meanNow = computed(() => curve.value.find((p) => p.samplingNumber === selected.value?.number)?.fraction ?? null);
const prev = computed(() => (selected.value ? previousPoint(curve.value, selected.value.number) : undefined));
const drop = computed(() => (selected.value ? dropAt(curve.value, selected.value.number) : undefined));

const stageLabels: Record<BudStageKey, () => string> = {
  AorB: () => t("stage_AorB"),
  BC: () => t("stage_BC"),
  C: () => t("stage_C"),
  D: () => t("stage_D"),
  E: () => t("stage_E"),
  F: () => t("stage_F"),
};

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "–" : `${Math.round(v * 100)} %`;
}

function openTube(id: string): void {
  currentTubeId.value = id;
  counts.value = emptyCounts();
  note.value = "";
  savedFlash.value = "";
  const tube = currentTube.value;
  if (tube?.readDate) readDate.value = tube.readDate;
  else if (selected.value?.readDate) readDate.value = selected.value.readDate;
  else readDate.value = todayIso();
}

function bump(k: BudStageKey, d: number): void {
  const v = Math.max(0, (counts.value[k] ?? 0) + d);
  counts.value = { ...counts.value, [k]: v };
}

function noneReleased(): void {
  const t0 = total.value;
  counts.value = { ...emptyCounts(), AorB: t0 > 0 ? t0 : counts.value.AorB };
}

async function save(): Promise<void> {
  const tube = currentTube.value;
  const s = selected.value;
  if (!tube || !s || total.value === 0) return;
  await saveReading(tube, s, counts.value, note.value, readDate.value);
  savedFlash.value = `${t("saved")}: ${tube.name} · ${pct(fraction.value)}`;
  // Move on to the next unread tube, same tree first.
  const rows = tubeRows.value;
  const idx = rows.findIndex((r) => r.tube.id === tube.id);
  const next = rows.slice(idx + 1).find((r) => !r.read) ?? rows.find((r) => !r.read && r.tube.id !== tube.id);
  if (next) openTube(next.tube.id);
  else currentTubeId.value = "";
}

function findByCode(code: string): boolean {
  const c = code.trim();
  const row = tubeRows.value.find((r) => r.tube.name.toLowerCase() === c.toLowerCase());
  if (row) {
    openTube(row.tube.id);
    codeInput.value = "";
    return true;
  }
  return false;
}

const canScan = typeof (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector === "function" && Boolean(navigator.mediaDevices?.getUserMedia);

async function startScan(): Promise<void> {
  scanError.value = "";
  scanning.value = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    await new Promise((r) => setTimeout(r, 50));
    if (video.value) {
      video.value.srcObject = stream;
      await video.value.play();
    }
    const Detector = (globalThis as unknown as { BarcodeDetector: new (o: { formats: string[] }) => { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    const detector = new Detector({ formats: ["qr_code", "code_128"] });
    const tick = async () => {
      if (!scanning.value || !video.value) return;
      try {
        const found = await detector.detect(video.value);
        const hit = found.find((f) => findByCode(f.rawValue));
        if (hit) {
          stopScan();
          return;
        }
      } catch {
        /* frame not ready */
      }
      scanTimer = window.setTimeout(tick, 250);
    };
    scanTimer = window.setTimeout(tick, 250);
  } catch (e) {
    scanError.value = (e as Error).message;
    stopScan();
  }
}

function stopScan(): void {
  scanning.value = false;
  if (scanTimer) window.clearTimeout(scanTimer);
  scanTimer = null;
  stream?.getTracks().forEach((tr) => tr.stop());
  stream = null;
}
onBeforeUnmount(stopScan);
</script>

<template>
  <h2>{{ t("nav_reading") }}</h2>

  <div class="card">
    <p class="hint">{{ t("reading_pick_sampling") }}</p>
    <select v-model="selectedId">
      <option v-for="s in samplings" :key="s.id" :value="s.id">#{{ s.number }} · {{ s.cutDate }} · {{ s.treeIds.length }} {{ t("trees") }}</option>
    </select>
    <p v-if="samplings.length === 0" class="hint">{{ t("no_samplings") }}</p>
    <div v-if="selected" class="row" style="margin-top: 8px">
      <span class="pill ok">{{ nRead }} {{ t("read_tubes") }}</span>
      <span class="pill">{{ tubeRows.length - nRead }} {{ t("pending_tubes") }}</span>
    </div>
  </div>

  <div v-if="selected && !currentTube" class="card">
    <p class="hint">{{ t("reading_pick_tube") }}</p>
    <div class="row">
      <input class="grow" v-model="codeInput" :placeholder="t('tube_code')" @keyup.enter="findByCode(codeInput)" autocapitalize="characters" autocomplete="off" />
      <button type="button" class="ghost" @click="findByCode(codeInput)">OK</button>
      <button v-if="canScan" type="button" class="primary" @click="scanning ? stopScan() : startScan()">{{ scanning ? t("close") : t("scan") }}</button>
    </div>
    <p v-if="!canScan" class="hint">{{ t("scan_unavailable") }}</p>
    <video v-if="scanning" ref="video" class="scanner" muted playsinline></video>
    <div v-if="scanError" class="banner bad">{{ scanError }}</div>
    <div v-if="savedFlash" class="banner ok">{{ savedFlash }}</div>
    <ul class="list">
      <li v-for="r in tubeRows" :key="r.tube.id" @click="openTube(r.tube.id)" style="cursor: pointer">
        <div class="main">
          <b>{{ r.tube.name }}</b> <span class="muted">{{ r.tree?.accession }}</span>
          <small>{{ r.tree?.cultivarCode }}<template v-if="r.tree?.earlyGroup"> · early</template></small>
        </div>
        <span class="pill" :class="r.read ? 'ok' : ''">{{ r.read ? "✓" : "·" }}</span>
      </li>
    </ul>
  </div>

  <div v-if="selected && currentTube" class="card">
    <div class="row">
      <div class="grow">
        <span class="big-number">{{ currentTube.name }}</span>
        <div class="muted">{{ currentTree?.accession }} · {{ currentTree?.cultivarCode }}</div>
      </div>
      <button type="button" class="ghost" @click="currentTubeId = ''">{{ t("close") }}</button>
    </div>

    <div class="row" style="margin: 8px 0">
      <label class="field grow" style="margin: 0"><span>{{ t("read_date") }}</span><input type="date" v-model="readDate" /></label>
      <span class="muted" v-if="currentTube.cutDate || selected.cutDate">{{ daysBetween(currentTube.cutDate || selected.cutDate, readDate) }} {{ t("days_since_cut") }}</span>
    </div>

    <div v-for="k in BUD_STAGE_KEYS" :key="k" class="counter">
      <button type="button" @click="bump(k, -1)" :disabled="!counts[k]">−</button>
      <div><div class="name">{{ stageLabels[k]() }}</div><div class="value">{{ counts[k] }}</div></div>
      <button type="button" class="plus" @click="bump(k, 1)">+</button>
    </div>

    <div class="row" style="margin: 10px 0">
      <div class="stat grow"><b>{{ total }}</b><span>{{ t("total_buds") }}</span></div>
      <div class="stat grow"><b>{{ pct(fraction) }}</b><span>{{ t("released") }}</span></div>
      <div class="stat grow"><b>{{ pct(meanNow) }}</b><span>{{ t("tree_mean") }}</span></div>
    </div>
    <p class="hint" v-if="prev">{{ t("previous") }} #{{ prev.samplingNumber }}: {{ pct(prev.fraction) }}</p>

    <div v-if="drop" class="banner" :class="drop.severity === 'severo' ? 'bad' : 'warn'">
      {{ t("drop_warning") }} ({{ t(("drop_" + drop.severity) as "drop_leve") }}: {{ pct(drop.from.fraction) }} → {{ pct(drop.to.fraction) }})
    </div>

    <button type="button" class="ghost big" @click="noneReleased" style="margin-bottom: 8px">{{ t("none_released") }}</button>
    <p class="hint">{{ t("none_released_hint") }}</p>
    <label class="field"><span>{{ t("note") }}</span><input v-model="note" autocomplete="off" /></label>
    <button type="button" class="primary big" :disabled="total === 0" @click="save">{{ t("save") }}</button>
  </div>
</template>

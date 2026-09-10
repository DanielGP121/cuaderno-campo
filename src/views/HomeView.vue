<script setup lang="ts">
import { computed, ref } from "vue";
import { t } from "../app/i18n";
import { pickFile, readBytes, saveFile } from "../app/files";
import { deviceLabel, events, importFlowering, importLayouts, importRegistry, importSeason, layouts, observations, samplings, saveSuggestion, setDeviceLabel, suggestions, trees } from "../app/store";
import { importTreeRegistry } from "@core/importers/mosaicRegistry";
import { importForcingWorkbook } from "@core/importers/mosaicForcing";
import { importPlotMaps } from "@core/importers/plotMapRgs";
import { importFloweringList } from "@core/importers/mosaicFlowering";
import { demoFlowering, demoPlotMap, demoTrees } from "../app/demo";
import { STAGE_VARIABLE } from "../app/floweringData";

const label = ref(deviceLabel.value);
const busy = ref("");
const message = ref("");
const suggestion = ref("");

const nReference = computed(() => trees.value.filter((x) => x.isReference).length);
const nEarly = computed(() => trees.value.filter((x) => x.earlyGroup).length);
const nReadings = computed(() => observations.value.filter((o) => o.variableId === "budStageCounts" || o.variableId === "budReleasedFraction").length);
const nStages = computed(() => observations.value.filter((o) => o.variableId === STAGE_VARIABLE && o.value !== null).length);
const nPositions = computed(() => trees.value.filter((x) => x.position !== undefined).length);

async function saveLabel(): Promise<void> {
  if (label.value.trim() !== deviceLabel.value) await setDeviceLabel(label.value.trim());
}

async function withFile(kind: string, run: (bytes: Uint8Array, name: string) => Promise<string>): Promise<void> {
  const file = await pickFile(".xlsx");
  if (!file) return;
  busy.value = kind;
  message.value = "";
  try {
    message.value = await run(await readBytes(file), file.name);
  } catch (e) {
    message.value = `${t("import_failed")}: ${(e as Error).message}`;
  } finally {
    busy.value = "";
  }
}

function loadRegistry(): Promise<void> {
  return withFile("registry", async (bytes) => {
    const imp = importTreeRegistry(bytes);
    const n = await importRegistry(imp);
    return `${t("import_done")}: ${n} ${t("trees")}${imp.warnings.length ? ` (${imp.warnings.length} avisos)` : ""}`;
  });
}

function loadSeason(): Promise<void> {
  return withFile("season", async (bytes) => {
    const imp = importForcingWorkbook(bytes);
    const n = await importSeason(imp);
    return `${t("import_done")}: ${imp.samplings.length} ${t("samplings")}, ${imp.tubes.length} ${t("tubes")}, ${imp.observations.length} ${t("readings")} (${n} eventos)`;
  });
}

function loadPlotMaps(): Promise<void> {
  return withFile("maps", async (bytes, name) => {
    const imp = importPlotMaps(bytes, { fileName: name });
    const r = await importLayouts(imp);
    return `${t("import_done")}: ${r.layouts} ${t("plots")} (${imp.layouts.map((l) => l.plot).join(", ")}), ${r.trees} ${t("positions")}${imp.warnings.length ? ` · ${imp.warnings.length} avisos` : ""}`;
  });
}

function loadFlowering(): Promise<void> {
  return withFile("flowering", async (bytes) => {
    const imp = importFloweringList(bytes);
    const r = await importFlowering(imp);
    return `${t("import_done")}: ${r.trees} ${t("trees")}, ${r.visits} visitas, ${r.observations} ${t("stage_records")}${r.skipped ? ` (${r.skipped} ya estaban)` : ""}${imp.warnings.length ? ` · ${imp.warnings.length} avisos` : ""}`;
  });
}

async function loadDemo(): Promise<void> {
  busy.value = "demo";
  try {
    const n = await importRegistry({ trees: demoTrees(), cutDates: new Map(), warnings: [] });
    await importLayouts(demoPlotMap());
    const r = await importFlowering(demoFlowering(trees.value));
    message.value = `${t("import_done")}: ${n} ${t("trees")}, 1 ${t("plots")}, ${r.observations} ${t("stage_records")} (demo)`;
  } finally {
    busy.value = "";
  }
}

async function addSuggestion(): Promise<void> {
  if (!suggestion.value.trim()) return;
  await saveSuggestion(suggestion.value);
  suggestion.value = "";
  message.value = `${t("saved")}: ${t("suggestions").toLowerCase()}`;
}

async function shareSuggestions(): Promise<void> {
  const text = suggestions.value.map((s) => `${s.observationTimeStamp.slice(0, 16).replace("T", " ")} ${s.collector ?? ""}: ${String(s.value)}`).join("\n");
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: t("suggestions"), text });
      return;
    } catch {
      /* fall through */
    }
  }
  await saveFile(`sugerencias_${(deviceLabel.value || "dispositivo").replace(/[^\w-]+/g, "_")}.txt`, text, "text/plain", false);
}
</script>

<template>
  <h2>{{ t("nav_home") }}</h2>
  <p class="lead">{{ t("home_lead") }}</p>

  <div class="stats">
    <div class="stat"><b>{{ layouts.length }}</b><span>{{ t("plots") }}</span></div>
    <div class="stat"><b>{{ nPositions }}</b><span>{{ t("positions") }}</span></div>
    <div class="stat"><b>{{ nStages }}</b><span>{{ t("stage_records") }}</span></div>
    <div class="stat"><b>{{ trees.length }}</b><span>{{ t("trees") }}</span></div>
    <div class="stat"><b>{{ nReference }}</b><span>{{ t("reference_trees") }}</span></div>
    <div class="stat"><b>{{ nEarly }}</b><span>{{ t("early_trees") }}</span></div>
    <div class="stat"><b>{{ samplings.length }}</b><span>{{ t("samplings") }}</span></div>
    <div class="stat"><b>{{ nReadings }}</b><span>{{ t("readings") }}</span></div>
    <div class="stat"><b>{{ events.length }}</b><span>{{ t("events_count") }}</span></div>
  </div>

  <div class="card">
    <label class="field">
      <span>{{ t("device_label") }}</span>
      <input v-model="label" @change="saveLabel" @blur="saveLabel" autocomplete="off" />
    </label>
    <p class="hint">{{ t("device_hint") }}</p>
  </div>

  <div class="card">
    <button type="button" class="primary big" :disabled="busy !== ''" @click="loadPlotMaps">{{ t("import_plot_maps") }}</button>
    <p class="hint">{{ t("import_plot_maps_hint") }}</p>
    <button type="button" class="ghost big" :disabled="busy !== ''" @click="loadFlowering">{{ t("import_flowering") }}</button>
    <p class="hint">{{ t("import_flowering_hint") }}</p>
    <button type="button" class="ghost big" :disabled="busy !== ''" @click="loadRegistry">{{ t("import_registry") }}</button>
    <p class="hint">{{ t("import_registry_hint") }}</p>
    <button type="button" class="ghost big" :disabled="busy !== ''" @click="loadSeason">{{ t("import_season") }}</button>
    <p class="hint">{{ t("import_season_hint") }}</p>
    <button v-if="trees.length === 0" type="button" class="ghost big" :disabled="busy !== ''" @click="loadDemo">{{ t("load_demo") }}</button>
    <div v-if="message" class="banner ok">{{ message }}</div>
  </div>

  <div class="card">
    <h3 style="margin-top: 0">{{ t("suggestions") }}</h3>
    <p class="hint">{{ t("suggestion_hint") }}</p>
    <textarea v-model="suggestion" rows="3"></textarea>
    <div class="row" style="margin-top: 8px">
      <button type="button" class="primary" :disabled="!suggestion.trim()" @click="addSuggestion">{{ t("save_suggestion") }}</button>
      <button v-if="suggestions.length" type="button" class="ghost" @click="shareSuggestions">{{ t("share_suggestions") }}</button>
      <span class="muted">{{ suggestions.length }} {{ t("saved_suggestions") }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { t } from "../app/i18n";
import { pickFile, readBytes } from "../app/files";
import { deviceLabel, events, importRegistry, importSeason, observations, samplings, setDeviceLabel, trees } from "../app/store";
import { importTreeRegistry } from "@core/importers/mosaicRegistry";
import { importForcingWorkbook } from "@core/importers/mosaicForcing";
import { demoTrees } from "../app/demo";

async function loadDemo(): Promise<void> {
  busy.value = "demo";
  try {
    const n = await importRegistry({ trees: demoTrees(), cutDates: new Map(), warnings: [] });
    message.value = `${t("import_done")}: ${n} ${t("trees")} (demo)`;
  } finally {
    busy.value = "";
  }
}

const label = ref(deviceLabel.value);
const busy = ref("");
const message = ref("");

const nReference = computed(() => trees.value.filter((x) => x.isReference).length);
const nEarly = computed(() => trees.value.filter((x) => x.earlyGroup).length);
const nReadings = computed(() => observations.value.filter((o) => o.variableId === "budStageCounts" || o.variableId === "budReleasedFraction").length);

async function saveLabel(): Promise<void> {
  if (label.value.trim() !== deviceLabel.value) await setDeviceLabel(label.value.trim());
}

async function loadRegistry(): Promise<void> {
  const file = await pickFile(".xlsx");
  if (!file) return;
  busy.value = "registry";
  message.value = "";
  try {
    const imp = importTreeRegistry(await readBytes(file));
    const n = await importRegistry(imp);
    message.value = `${t("import_done")}: ${n} ${t("trees")}${imp.warnings.length ? ` (${imp.warnings.length} avisos)` : ""}`;
  } catch (e) {
    message.value = `${t("import_failed")}: ${(e as Error).message}`;
  } finally {
    busy.value = "";
  }
}

async function loadSeason(): Promise<void> {
  const file = await pickFile(".xlsx");
  if (!file) return;
  busy.value = "season";
  message.value = "";
  try {
    const imp = importForcingWorkbook(await readBytes(file));
    const n = await importSeason(imp);
    message.value = `${t("import_done")}: ${imp.samplings.length} ${t("samplings")}, ${imp.tubes.length} ${t("tubes")}, ${imp.observations.length} ${t("readings")} (${n} eventos)`;
  } catch (e) {
    message.value = `${t("import_failed")}: ${(e as Error).message}`;
  } finally {
    busy.value = "";
  }
}
</script>

<template>
  <h2>{{ t("nav_home") }}</h2>
  <p class="lead">{{ t("home_lead") }}</p>

  <div class="stats">
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
    <button type="button" class="primary big" :disabled="busy !== ''" @click="loadRegistry">{{ t("import_registry") }}</button>
    <p class="hint">{{ t("import_registry_hint") }}</p>
    <button type="button" class="ghost big" :disabled="busy !== ''" @click="loadSeason">{{ t("import_season") }}</button>
    <p class="hint">{{ t("import_season_hint") }}</p>
    <button v-if="trees.length === 0" type="button" class="ghost big" :disabled="busy !== ''" @click="loadDemo">{{ t("load_demo") }}</button>
    <div v-if="message" class="banner ok">{{ message }}</div>
  </div>
</template>

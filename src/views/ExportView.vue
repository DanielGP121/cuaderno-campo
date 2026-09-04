<script setup lang="ts">
import { ref } from "vue";
import { t } from "../app/i18n";
import { pickFile, readText, saveFile, todayIso, XLSX_MIME } from "../app/files";
import { deviceLabel, events, mergeExternal, samplings, state } from "../app/store";
import { datasetFromState } from "../app/forcingData";
import { exportForcingWorkbook } from "@core/exporters/forcingWorkbook";
import { fromJsonl, toJsonl } from "@core/events";
import { wipeAll } from "../app/db";

const message = ref("");

function seasonLabel(): string {
  const dates = samplings.value.map((s) => s.cutDate).filter(Boolean).sort();
  if (dates.length === 0) return todayIso().slice(0, 4);
  const y0 = dates[0]!.slice(0, 4);
  const y1 = dates.at(-1)!.slice(0, 4);
  return y0 === y1 ? y0 : `${y0}-${y1}`;
}

async function exportWorkbook(): Promise<void> {
  const ds = datasetFromState(state.value);
  const bytes = exportForcingWorkbook(ds, { consolidatedName: seasonLabel() });
  const outcome = await saveFile(`Forzado_${seasonLabel()}_${todayIso()}.xlsx`, bytes, XLSX_MIME);
  message.value = `${t("export_workbook")}: ${outcome === "shared" ? t("share") : t("download")} ✓`;
}

async function backup(): Promise<void> {
  const name = `cuaderno_${(deviceLabel.value || "dispositivo").replace(/[^\w-]+/g, "_")}_${todayIso()}.jsonl`;
  const outcome = await saveFile(name, toJsonl(events.value), "application/x-ndjson");
  message.value = `${t("export_backup")}: ${outcome === "shared" ? t("share") : t("download")} ✓ (${events.value.length} ${t("events_count")})`;
}

async function restore(): Promise<void> {
  const file = await pickFile(".jsonl,.txt,.json");
  if (!file) return;
  const log = fromJsonl(await readText(file));
  const n = await mergeExternal(log);
  message.value = `${t("restore_backup")}: +${n} ${t("events_count")}`;
}

async function deleteAll(): Promise<void> {
  if (!window.confirm(t("delete_all_confirm"))) return;
  await wipeAll();
  window.location.reload();
}
</script>

<template>
  <h2>{{ t("nav_export") }}</h2>

  <div class="card">
    <button type="button" class="primary big" @click="exportWorkbook" :disabled="samplings.length === 0">{{ t("export_workbook") }}</button>
    <p class="hint">{{ t("export_workbook_hint") }}</p>
  </div>

  <div class="card">
    <button type="button" class="ghost big" @click="backup">{{ t("export_backup") }}</button>
    <p class="hint">{{ t("export_backup_hint") }}</p>
    <button type="button" class="ghost big" @click="restore">{{ t("restore_backup") }}</button>
    <p class="hint">{{ t("restore_hint") }}</p>
  </div>

  <div v-if="message" class="banner ok">{{ message }}</div>

  <div class="card">
    <button type="button" class="ghost big" @click="deleteAll">{{ t("delete_all") }}</button>
  </div>
</template>

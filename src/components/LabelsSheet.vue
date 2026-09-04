<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import QRCode from "qrcode";
import { t } from "../app/i18n";
import { treeById, tubesOfSampling } from "../app/store";
import type { Sampling } from "@core/types";

const props = defineProps<{ sampling: Sampling }>();
defineEmits<{ close: [] }>();

interface Label {
  code: string;
  tree: string;
  accession: string;
  qr: string;
}
const labels = ref<Label[]>([]);

async function build(): Promise<void> {
  const tubes = tubesOfSampling(props.sampling).sort((a, b) => (Number(treeById(a.parentId ?? "")?.cultivarCode) || 0) - (Number(treeById(b.parentId ?? "")?.cultivarCode) || 0) || a.name.localeCompare(b.name));
  const out: Label[] = [];
  for (const tube of tubes) {
    const tree = tube.parentId ? treeById(tube.parentId) : undefined;
    // The QR carries just the tube code: short, readable at 30 cm, and the app accepts it as is.
    const qr = await QRCode.toDataURL(tube.name, { errorCorrectionLevel: "H", margin: 1, width: 220 });
    out.push({ code: tube.name, tree: tree?.cultivarCode ?? tree?.name ?? "", accession: tree?.accession ?? "", qr });
  }
  labels.value = out;
}
onMounted(build);
watch(() => props.sampling.id, build);
function print(): void {
  window.print();
}
</script>

<template>
  <div class="card noprint">
    <p class="hint">{{ t("labels_hint") }}</p>
    <div class="row">
      <button type="button" class="primary" @click="print">{{ t("print") }}</button>
      <button type="button" class="ghost" @click="$emit('close')">{{ t("close") }}</button>
      <span class="muted">{{ labels.length }} {{ t("tubes") }}</span>
    </div>
  </div>
  <div class="labels">
    <div v-for="l in labels" :key="l.code" class="label">
      <img :src="l.qr" :alt="l.code" />
      <b>{{ l.code }}</b>
      <small>{{ l.accession }} · #{{ sampling.number }} · {{ sampling.cutDate }}</small>
    </div>
  </div>
</template>

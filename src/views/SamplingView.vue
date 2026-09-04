<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { t } from "../app/i18n";
import { todayIso } from "../app/files";
import { createSampling, isCut, markCut, samplings, state, treeById, trees, tubesOfSampling } from "../app/store";
import { treesForSampling, walkingOrder } from "@core/sampling";
import type { Sampling } from "@core/types";
import LabelsSheet from "../components/LabelsSheet.vue";

const selectedId = ref<string>(samplings.value.at(-1)?.id ?? "");
const showForm = ref(false);
const showLabels = ref(false);
const form = ref({ number: (samplings.value.at(-1)?.number ?? 0) + 1, kind: "full" as "full" | "early", cutDate: todayIso(), cp: "" });

watch(samplings, (list) => {
  if (!selectedId.value && list.length) selectedId.value = list.at(-1)!.id;
  form.value.number = (list.at(-1)?.number ?? 0) + 1;
});

const selected = computed<Sampling | undefined>(() => samplings.value.find((s) => s.id === selectedId.value));

const treeRows = computed(() => {
  void state.value;
  const s = selected.value;
  if (!s) return [];
  const list = s.treeIds.map((id) => treeById(id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const tubes = tubesOfSampling(s);
  return walkingOrder(list).map((tree) => ({
    tree,
    cut: isCut(s, tree),
    tubes: tubes.filter((tb) => tb.parentId === tree.id).map((tb) => tb.name),
  }));
});
const nCut = computed(() => treeRows.value.filter((r) => r.cut).length);
const previewCount = computed(() => treesForSampling(trees.value, form.value.kind).length);

async function create(): Promise<void> {
  const cp = Number(form.value.cp.replace(",", "."));
  const s = await createSampling({
    number: Number(form.value.number),
    kind: form.value.kind,
    cutDate: form.value.cutDate,
    ...(Number.isFinite(cp) && form.value.cp.trim() !== "" ? { chillPortions: cp } : {}),
  });
  selectedId.value = s.id;
  showForm.value = false;
}

async function toggleCut(treeId: string, cut: boolean): Promise<void> {
  const s = selected.value;
  const tree = treeById(treeId);
  if (s && tree) await markCut(s, tree, cut);
}

function kindOf(s: Sampling): string {
  const all = trees.value.filter((x) => x.isReference).length;
  return s.treeIds.length < all ? t("kind_early") : t("kind_full");
}
</script>

<template>
  <h2>{{ t("nav_sampling") }}</h2>

  <div v-if="trees.length === 0" class="banner warn">{{ t("no_trees") }}</div>

  <div class="card noprint">
    <div class="row">
      <select class="grow" v-model="selectedId">
        <option v-for="s in samplings" :key="s.id" :value="s.id">#{{ s.number }} · {{ s.cutDate }} · {{ s.treeIds.length }} {{ t("trees") }}</option>
      </select>
      <button type="button" class="primary" @click="showForm = !showForm" :disabled="trees.length === 0">{{ t("new_sampling") }}</button>
    </div>
    <p v-if="samplings.length === 0" class="hint">{{ t("no_samplings") }}</p>

    <div v-if="showForm" class="card">
      <label class="field"><span>{{ t("sampling_number") }}</span><input type="number" v-model="form.number" min="1" /></label>
      <label class="field">
        <span>{{ t("sampling_kind") }}</span>
        <select v-model="form.kind">
          <option value="full">{{ t("kind_full") }}</option>
          <option value="early">{{ t("kind_early") }}</option>
        </select>
      </label>
      <label class="field"><span>{{ t("cut_date") }}</span><input type="date" v-model="form.cutDate" /></label>
      <label class="field"><span>{{ t("chill_portions") }}</span><input inputmode="decimal" v-model="form.cp" placeholder="43.3" /></label>
      <p class="hint">{{ previewCount }} {{ t("trees") }}</p>
      <div class="row">
        <button type="button" class="primary grow" @click="create" :disabled="previewCount === 0">{{ t("create") }}</button>
        <button type="button" class="ghost" @click="showForm = false">{{ t("cancel") }}</button>
      </div>
    </div>
  </div>

  <template v-if="selected">
    <div class="row noprint" style="margin-bottom: 10px">
      <span class="pill ok">{{ nCut }} / {{ treeRows.length }} {{ t("trees_cut") }}</span>
      <span class="pill">{{ kindOf(selected) }}</span>
      <span class="grow"></span>
      <button type="button" class="ghost" @click="showLabels = !showLabels">{{ t("labels") }}</button>
    </div>

    <LabelsSheet v-if="showLabels" :sampling="selected" @close="showLabels = false" />

    <ul v-else class="list">
      <li v-for="r in treeRows" :key="r.tree.id">
        <div class="main">
          <b>{{ r.tree.cultivarCode ?? r.tree.name }}</b> <span class="muted">{{ r.tree.accession }}</span>
          <small>
            <template v-if="r.tree.plot">{{ r.tree.plot }}<template v-if="r.tree.row"> · F{{ r.tree.row }}</template><template v-if="r.tree.position"> · A{{ r.tree.position }}</template> · </template>
            {{ r.tubes.join("  ") }}
            <template v-if="r.tree.earlyGroup"> · early</template>
          </small>
        </div>
        <button type="button" class="ghost toggle" :class="{ on: r.cut }" @click="toggleCut(r.tree.id, !r.cut)">{{ r.cut ? "✓ " + t("mark_cut") : t("mark_cut") }}</button>
      </li>
    </ul>
  </template>
</template>

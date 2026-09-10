<script setup lang="ts">
/**
 * The plot screen: the plot as the group draws it, row by row, and the stage of each
 * tree on the day of the visit. The person picks a row, walks it with the list (big
 * buttons, automatic advance, undo) and taps a tree to write its label the way the
 * sheets do ("DE-F1", "F50", "F95-C10"). The app records only what is seen; what the
 * group estimates keeps its red on import and export.
 */
import { computed, ref, watch } from "vue";
import { t } from "../app/i18n";
import { todayIso } from "../app/files";
import { ensureVisit, retract, saveDescriptor, saveStage, setTreeStatus, state, trees, plots, visits } from "../app/store";
import { fieldOrder, isPhenotypable, layoutOfPlot, stageLabelOf, stageOf, stagesByTreeAndDate, visitLabel, type DescriptorKey } from "../app/floweringData";
import { formatStageLabel } from "@core/phenology";
import type { LayoutRow, TreeStatusValue } from "@core/layout";
import type { FieldVisit, Observation, ObservationUnit, VisitKind } from "@core/types";

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

const plot = ref<string>(localStorage.getItem("cuaderno.plot") ?? "");
const date = ref<string>(todayIso());
const flight = ref(false);
const temperature = ref("");
const rowName = ref<string>("");
const reversed = ref(false);
const showMap = ref(true);
const current = ref<ObservationUnit | null>(null);
const form = ref({ pre: "", open: 0, fall: 0, estimated: false });
const lastSaved = ref<{ obs: Observation; tree: ObservationUnit } | null>(null);
const flash = ref("");

watch(plots, (list) => {
  if ((!plot.value || !list.includes(plot.value)) && list.length) plot.value = list[0]!;
}, { immediate: true });
watch(plot, (p) => {
  remember("cuaderno.plot", p);
  rowName.value = "";
  current.value = null;
});

const layout = computed(() => layoutOfPlot(state.value, plot.value));
const stages = computed(() => stagesByTreeAndDate(state.value));

const plotTrees = computed(() => {
  void state.value;
  return fieldOrder(state.value, trees.value.filter((u) => u.plot === plot.value));
});

function rowOf(u: ObservationUnit): string {
  return u.rowLabel ?? (u.row !== undefined ? String(u.row) : "");
}

function stageToday(u: ObservationUnit): Observation | undefined {
  return stages.value.get(u.id)?.get(date.value);
}

function statusOf(u: ObservationUnit): TreeStatusValue | "" {
  const a = u.attributes ?? {};
  const s = a["status"] ?? (a["listStatus"] === "dead" ? "dead" : a["mapStatus"]);
  return typeof s === "string" ? (s as TreeStatusValue) : "";
}

function isDeadOrMissing(u: ObservationUnit): boolean {
  const s = statusOf(u);
  return s === "dead" || s === "missing";
}

function kindOf(u: ObservationUnit): string {
  const k = u.attributes?.["layoutKind"];
  return typeof k === "string" ? k : "tree";
}

/** Rows of the plot in map order, with the trees of each and how many are still to do today. */
interface RowView {
  name: string;
  trees: ObservationUnit[];
  total: number;
  remaining: number;
}
const rowViews = computed<RowView[]>(() => {
  const byRow = new Map<string, ObservationUnit[]>();
  const positioned = plotTrees.value.filter((u) => u.position !== undefined);
  for (const u of positioned) {
    const r = rowOf(u);
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r)!.push(u);
  }
  const order = layout.value ? layout.value.rows.map((r) => r.name) : [...byRow.keys()];
  for (const r of byRow.keys()) if (!order.includes(r)) order.push(r);
  const out: RowView[] = [];
  for (const name of order) {
    const list = (byRow.get(name) ?? []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    if (list.length === 0) continue;
    const todo = list.filter((u) => isPhenotypable(u) && !isDeadOrMissing(u));
    out.push({ name, trees: list, total: todo.length, remaining: todo.filter((u) => !stageToday(u)).length });
  }
  // trees of the plot without a position, unless a positioned tree already carries their code
  const codes = new Set(positioned.map((u) => u.cultivarCode).filter(Boolean));
  const loose = plotTrees.value.filter((u) => u.position === undefined && !(u.cultivarCode && codes.has(u.cultivarCode)));
  if (loose.length) out.push({ name: "?", trees: loose, total: loose.length, remaining: loose.filter((u) => !stageToday(u)).length });
  return out;
});

const selectedRow = computed(() => rowViews.value.find((r) => r.name === rowName.value));
watch(rowViews, (list) => {
  if (!selectedRow.value && list.length) rowName.value = list[0]!.name;
}, { immediate: true });

/** Direction to walk the selected row: as drawn, alternating by row, unless reversed by hand. */
const rowTrees = computed(() => {
  const r = selectedRow.value;
  if (!r) return [];
  const i = rowViews.value.indexOf(r);
  const layoutRow = layout.value?.rows.find((lr) => lr.name === r.name);
  const leftToRight = layoutRow ? layoutRow.numberingLeftToRight : true;
  let list = [...r.trees].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  if (!leftToRight) list.reverse();
  if (i % 2 === 1) list.reverse();
  if (reversed.value) list.reverse();
  return list;
});

const totalRemaining = computed(() => rowViews.value.reduce((a, r) => a + r.remaining, 0));
const totalToDo = computed(() => rowViews.value.reduce((a, r) => a + r.total, 0));

/** Cells of the map, one per drawn position, in drawing order. */
const mapRows = computed(() => {
  const byKey = new Map<string, ObservationUnit>();
  for (const u of plotTrees.value) if (u.position !== undefined) byKey.set(`${rowOf(u)}|${u.position}`, u);
  const rows: { name: string; cells: { tree: ObservationUnit | undefined; position: number; kind: string }[] }[] = [];
  const source: LayoutRow[] = layout.value
    ? [...layout.value.rows].sort((a, b) => a.order - b.order)
    : rowViews.value.filter((r) => r.name !== "?").map((r) => ({ name: r.name, order: 0, numberingLeftToRight: true, positions: r.trees.map((u) => ({ position: u.position!, kind: "tree" as const })) }));
  for (const lr of source) {
    const cells = [...lr.positions].sort((a, b) => (lr.numberingLeftToRight ? a.position - b.position : b.position - a.position)).map((p) => ({ tree: byKey.get(`${lr.name}|${p.position}`), position: p.position, kind: p.kind }));
    rows.push({ name: lr.name, cells });
  }
  return rows;
});

function cellClass(u: ObservationUnit | undefined, kind: string): string {
  if (!u) return `c-${kind}`;
  const classes = [`c-${kindOf(u)}`];
  if (isDeadOrMissing(u)) classes.push("c-dead");
  else if (statusOf(u) === "doubtful") classes.push("c-doubt");
  const s = stageToday(u);
  if (s) {
    const p = stageOf(s);
    if (p) {
      if (p.fall >= 90) classes.push("s-c90");
      else if (p.fall >= 10) classes.push("s-c10");
      else if (p.open >= 80) classes.push("s-f80");
      else if (p.open >= 50) classes.push("s-f50");
      else if (p.open >= 10) classes.push("s-f10");
      else classes.push("s-f0");
    } else classes.push("s-f0");
    if (s.dataFlag === 3) classes.push("s-est");
  }
  if (u.id === current.value?.id) classes.push("c-current");
  return classes.join(" ");
}

function shortName(u: ObservationUnit): string {
  return u.accession ?? u.name;
}

function history(u: ObservationUnit): { date: string; label: string; estimated: boolean; today: boolean }[] {
  const byDate = stages.value.get(u.id);
  if (!byDate) return [];
  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([d, o]) => ({ date: d, label: stageLabelOf(o), estimated: o.dataFlag === 3, today: d === date.value }));
}

function descriptor(u: ObservationUnit, key: DescriptorKey): string {
  const v = u.attributes?.[key];
  return v === undefined || v === null ? "" : String(v);
}

function previousLabel(u: ObservationUnit): string {
  const h = history(u).filter((x) => !x.today);
  return h[0] ? `${h[0].label} · ${h[0].date.slice(5)}` : "";
}

function open(u: ObservationUnit): void {
  current.value = u;
  flash.value = "";
  const s = stageToday(u);
  const p = s ? stageOf(s) : null;
  form.value = p ? { pre: p.pre, open: p.open, fall: p.fall, estimated: s?.dataFlag === 3 } : { pre: "", open: 0, fall: 0, estimated: false };
}

function close(): void {
  current.value = null;
}

function tapCell(row: string, tree: ObservationUnit | undefined): void {
  rowName.value = row;
  if (tree && isPhenotypable(tree)) open(tree);
}

const preview = computed(() => formatStageLabel({ pre: form.value.pre, open: form.value.open, fall: form.value.fall }));

const PRE = ["", "B", "C", "CD", "D", "DE", "E"];
const OPEN = [0, 1, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100];
const FALL = [0, 1, 5, 10, 20, 30, 50, 70, 80, 90, 100];

async function currentVisit(): Promise<FieldVisit> {
  const kind: VisitKind = flight.value ? "flight" : "visit";
  const extra: { temperature?: string } = {};
  if (temperature.value.trim()) extra.temperature = temperature.value.trim();
  return ensureVisit(date.value, kind, plot.value, extra);
}

function nextPending(after: ObservationUnit | null): ObservationUnit | undefined {
  const list = rowTrees.value.filter((u) => isPhenotypable(u) && !isDeadOrMissing(u));
  const idx = after ? list.findIndex((u) => u.id === after.id) : -1;
  return list.slice(idx + 1).find((u) => !stageToday(u)) ?? list.find((u) => !stageToday(u) && u.id !== after?.id);
}

async function save(): Promise<void> {
  const tree = current.value;
  if (!tree) return;
  const visit = await currentVisit();
  const obs = await saveStage(tree, visit, { pre: form.value.pre, open: form.value.open, fall: form.value.fall }, { estimated: form.value.estimated });
  lastSaved.value = { obs, tree };
  flash.value = `${t("saved")}: ${shortName(tree)} · ${stageLabelOf(obs)}`;
  const next = nextPending(tree);
  if (next) open(next);
  else current.value = null;
}

async function undo(): Promise<void> {
  const last = lastSaved.value;
  if (!last) return;
  await retract(last.obs);
  lastSaved.value = null;
  flash.value = `${t("undo")}: ${shortName(last.tree)}`;
  open(last.tree);
}

function skip(): void {
  const next = nextPending(current.value);
  if (next) open(next);
  else current.value = null;
}

async function setDescriptor(key: DescriptorKey, value: string | number): Promise<void> {
  if (!current.value) return;
  await saveDescriptor(current.value, key, value, date.value);
  current.value = trees.value.find((u) => u.id === current.value!.id) ?? current.value;
}

async function setStatus(status: TreeStatusValue): Promise<void> {
  if (!current.value) return;
  await setTreeStatus(current.value, status, date.value);
  current.value = trees.value.find((u) => u.id === current.value!.id) ?? current.value;
}

async function addEvent(kind: VisitKind): Promise<void> {
  const v = await ensureVisit(date.value, kind, plot.value);
  flash.value = `${t("event_saved")}: ${visitLabel(v)}`;
}

const seasonEvents = computed(() => visits.value.filter((v) => v.date.slice(0, 4) === date.value.slice(0, 4) && v.kind !== "visit" && (!v.plots?.length || v.plots.includes(plot.value))));

const statusLabel: Record<string, () => string> = {
  alive: () => t("status_alive"),
  dead: () => t("status_dead"),
  doubtful: () => t("status_doubtful"),
  missing: () => t("status_missing"),
};
</script>

<template>
  <h2>{{ t("nav_plot") }}</h2>

  <div v-if="plots.length === 0" class="banner warn">{{ t("no_plots") }}</div>

  <div class="card noprint">
    <div class="row">
      <label class="field grow" style="margin: 0"><span>{{ t("plot") }}</span>
        <select v-model="plot"><option v-for="p in plots" :key="p" :value="p">{{ p }}</option></select>
      </label>
      <label class="field grow" style="margin: 0"><span>{{ t("visit_date") }}</span><input type="date" v-model="date" /></label>
    </div>
    <div class="row" style="margin-top: 8px">
      <button type="button" class="ghost toggle" :class="{ on: flight }" @click="flight = !flight">{{ flight ? "✓ " : "" }}{{ t("visit_flight") }}</button>
      <input class="grow" v-model="temperature" :placeholder="t('temperature')" inputmode="decimal" autocomplete="off" style="max-width: 160px" />
      <span class="pill" :class="totalRemaining === 0 ? 'ok' : 'warn'">{{ t("remaining") }} {{ totalRemaining }} / {{ totalToDo }}</span>
    </div>
    <p v-if="flight" class="hint">{{ t("visit_flight_hint") }}</p>
    <div class="row" style="margin-top: 8px">
      <span class="muted">{{ t("add_event") }}:</span>
      <button type="button" class="ghost" @click="addEvent('pruning')">{{ t("event_pruning") }}</button>
      <button type="button" class="ghost" @click="addEvent('treatment')">{{ t("event_treatment") }}</button>
      <button type="button" class="ghost" @click="addEvent('frost')">{{ t("event_frost") }}</button>
      <button type="button" class="ghost" @click="addEvent('irrigation')">{{ t("event_irrigation") }}</button>
    </div>
    <p v-if="seasonEvents.length" class="hint">{{ t("events_of_season") }}: {{ seasonEvents.map((v) => visitLabel(v)).join(", ") }}</p>
    <div v-if="flash" class="banner ok">{{ flash }}</div>
  </div>

  <div v-if="rowViews.length" class="card noprint">
    <div class="row">
      <button type="button" class="ghost" @click="showMap = !showMap">{{ t("map") }}</button>
      <span class="grow"></span>
      <button type="button" class="ghost" @click="reversed = !reversed">{{ t("reverse") }}</button>
      <button v-if="lastSaved" type="button" class="ghost" @click="undo">{{ t("undo_last") }}</button>
    </div>
    <div v-if="showMap" class="plotmap">
      <div v-for="r in mapRows" :key="r.name" class="maprow" :class="{ selected: r.name === rowName }" @click="rowName = r.name">
        <span class="rowname">{{ r.name }}</span>
        <span v-for="c in r.cells" :key="c.position" class="cell" :class="cellClass(c.tree, c.kind)" :title="(c.tree ? shortName(c.tree) : c.kind) + ' · ' + c.position" @click.stop="tapCell(r.name, c.tree)"></span>
      </div>
    </div>
    <div class="rowtabs">
      <button v-for="r in rowViews" :key="r.name" type="button" class="ghost" :class="{ on: r.name === rowName, done: r.remaining === 0 && r.total > 0 }" @click="rowName = r.name">
        {{ r.name === "?" ? t("without_position") : t("row") + " " + r.name }}
        <small>{{ r.remaining === 0 ? t("row_done") : t("remaining") + " " + r.remaining }}</small>
      </button>
    </div>
  </div>

  <div v-if="current" class="card">
    <div class="row">
      <div class="grow">
        <span class="big-number">{{ shortName(current) }}</span>
        <div class="muted">{{ current.name }}<template v-if="current.cultivarCode"> · MID {{ current.cultivarCode }}</template><template v-if="current.accessionNumber"> · {{ current.accessionNumber }}</template><template v-if="kindOf(current) !== 'tree'"> · {{ t(kindOf(current) as 'guard') }}</template></div>
      </div>
      <button type="button" class="ghost" @click="close">{{ t("close") }}</button>
    </div>

    <div class="stagebox">
      <div class="stat"><b>{{ preview }}</b><span>{{ t("label_preview") }} · {{ date }}</span></div>
    </div>

    <h3>{{ t("pre_bloom") }}</h3>
    <div class="choices">
      <button v-for="p in PRE" :key="p || 'none'" type="button" class="ghost" :class="{ on: form.pre === p }" @click="form.pre = p">{{ p || t("none_f") }}</button>
    </div>
    <h3>{{ t("open_flowers") }}</h3>
    <div class="choices">
      <button v-for="v in OPEN" :key="v" type="button" class="ghost" :class="{ on: form.open === v }" @click="form.open = v">{{ v }}</button>
    </div>
    <h3>{{ t("petal_fall") }}</h3>
    <div class="choices">
      <button v-for="v in FALL" :key="v" type="button" class="ghost" :class="{ on: form.fall === v }" @click="form.fall = v">{{ v === 0 ? t("none_f") : v === 1 ? "C " + t("fall_started") : v }}</button>
    </div>
    <label class="row" style="margin: 10px 0"><input type="checkbox" v-model="form.estimated" style="width: 28px; min-height: 28px" /> <span>{{ t("mark_estimated") }}</span></label>

    <div class="row">
      <button type="button" class="primary grow" @click="save">{{ t("save_next") }}</button>
      <button type="button" class="ghost" @click="skip">{{ t("skip") }}</button>
    </div>

    <h3>{{ t("descriptors") }}</h3>
    <div class="row"><span class="muted grow">{{ t("bud_density") }}</span></div>
    <div class="choices">
      <button v-for="v in [1, 3, 5, 7, 9]" :key="v" type="button" class="ghost" :class="{ on: descriptor(current, 'flowerBudDensity') === String(v) }" @click="setDescriptor('flowerBudDensity', v)">{{ v }}</button>
    </div>
    <div class="row"><span class="muted grow">{{ t("flower_type") }}</span></div>
    <div class="choices">
      <button type="button" class="ghost" :class="{ on: /^c/i.test(descriptor(current, 'flowerType')) }" @click="setDescriptor('flowerType', 'Campanulate')">{{ t("campanulate") }}</button>
      <button type="button" class="ghost" :class="{ on: /^r/i.test(descriptor(current, 'flowerType')) }" @click="setDescriptor('flowerType', 'Rosette')">{{ t("rosette") }}</button>
    </div>
    <div class="row"><span class="muted grow">{{ t("petals") }}</span></div>
    <div class="choices">
      <button type="button" class="ghost" :class="{ on: descriptor(current, 'petalsPerFlower') === '5' }" @click="setDescriptor('petalsPerFlower', '5')">5</button>
      <button type="button" class="ghost" :class="{ on: descriptor(current, 'petalsPerFlower') === '>5' }" @click="setDescriptor('petalsPerFlower', '>5')">&gt;5</button>
    </div>

    <h3>{{ t("tree_status") }}</h3>
    <div class="choices">
      <button v-for="s in (['alive', 'doubtful', 'dead', 'missing'] as const)" :key="s" type="button" class="ghost" :class="{ on: statusOf(current) === s }" @click="setStatus(s)">{{ statusLabel[s]!() }}</button>
    </div>

    <h3>{{ t("history") }}</h3>
    <p v-if="history(current).length === 0" class="hint">{{ t("no_history") }}</p>
    <ul v-else class="list compact">
      <li v-for="h in history(current)" :key="h.date">
        <div class="main"><b :class="{ est: h.estimated }">{{ h.label }}</b><small>{{ h.date }}<template v-if="h.estimated"> · {{ t("estimated") }}</template><template v-if="h.today"> · {{ t("today") }}</template></small></div>
      </li>
    </ul>
  </div>

  <ul v-else-if="selectedRow" class="list">
    <li v-for="u in rowTrees" :key="u.id" @click="isPhenotypable(u) && open(u)" :style="isPhenotypable(u) ? 'cursor: pointer' : ''" :class="{ dim: !isPhenotypable(u) || isDeadOrMissing(u) }">
      <span class="pos">{{ u.position ?? "?" }}</span>
      <div class="main">
        <b>{{ shortName(u) }}</b> <span class="muted" v-if="u.cultivarCode">MID {{ u.cultivarCode }}</span>
        <small>
          <template v-if="kindOf(u) !== 'tree'">{{ t(kindOf(u) as 'guard') }} · </template>
          <template v-if="isDeadOrMissing(u)">{{ statusLabel[statusOf(u)]?.() }} · </template>
          <template v-if="statusOf(u) === 'doubtful'">{{ t("status_doubtful") }} · </template>
          {{ previousLabel(u) }}
        </small>
      </div>
      <span class="pill" :class="stageToday(u) ? (stageToday(u)!.dataFlag === 3 ? 'warn' : 'ok') : ''">{{ stageToday(u) ? stageLabelOf(stageToday(u)!) : "·" }}</span>
    </li>
  </ul>
</template>

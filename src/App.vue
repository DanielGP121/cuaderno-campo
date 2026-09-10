<script setup lang="ts">
import { onMounted, ref } from "vue";
import HomeView from "./views/HomeView.vue";
import PlotView from "./views/PlotView.vue";
import SamplingView from "./views/SamplingView.vue";
import ReadingView from "./views/ReadingView.vue";
import ExportView from "./views/ExportView.vue";
import { lang, setLang, t } from "./app/i18n";

type View = "home" | "plot" | "sampling" | "reading" | "export";
const VIEWS: View[] = ["home", "plot", "sampling", "reading", "export"];
const stored = localStorage.getItem("cuaderno.view") as View | null;
const view = ref<View>(stored && VIEWS.includes(stored) ? stored : "home");
const sun = ref(localStorage.getItem("cuaderno.sun") === "1");

function go(v: View): void {
  view.value = v;
  try {
    localStorage.setItem("cuaderno.view", v);
  } catch {
    /* ignore */
  }
}
function toggleSun(): void {
  sun.value = !sun.value;
  document.documentElement.classList.toggle("sun", sun.value);
  try {
    localStorage.setItem("cuaderno.sun", sun.value ? "1" : "0");
  } catch {
    /* ignore */
  }
}
function toggleLang(): void {
  setLang(lang.value === "es" ? "en" : "es");
}
onMounted(() => {
  document.documentElement.classList.toggle("sun", sun.value);
  document.documentElement.lang = lang.value;
});
</script>

<template>
  <header class="top">
    <h1>{{ t("app_title") }}</h1>
    <button type="button" @click="toggleSun" :aria-pressed="sun" :title="t('sun_mode')">☀</button>
    <button type="button" @click="toggleLang" :title="t('language')">{{ lang === "es" ? "EN" : "ES" }}</button>
  </header>
  <main>
    <HomeView v-if="view === 'home'" />
    <PlotView v-else-if="view === 'plot'" />
    <SamplingView v-else-if="view === 'sampling'" />
    <ReadingView v-else-if="view === 'reading'" />
    <ExportView v-else />
  </main>
  <nav class="bottom noprint">
    <button type="button" :class="{ active: view === 'home' }" @click="go('home')">{{ t("nav_home") }}</button>
    <button type="button" :class="{ active: view === 'plot' }" @click="go('plot')">{{ t("nav_plot") }}</button>
    <button type="button" :class="{ active: view === 'sampling' }" @click="go('sampling')">{{ t("nav_sampling") }}</button>
    <button type="button" :class="{ active: view === 'reading' }" @click="go('reading')">{{ t("nav_reading") }}</button>
    <button type="button" :class="{ active: view === 'export' }" @click="go('export')">{{ t("nav_export") }}</button>
  </nav>
</template>

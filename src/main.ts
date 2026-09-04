import { createApp } from "vue";
import App from "./App.vue";
import "./app/styles.css";
import { init } from "./app/store";

void init().then(() => {
  createApp(App).mount("#app");
});

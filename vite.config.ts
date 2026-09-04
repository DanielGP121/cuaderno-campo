import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

// The app is served from GitHub Pages under /cuaderno-campo/ and built into docs/,
// the same arrangement croquis-campo uses. `npm run dev` serves it at the root.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/cuaderno-campo/" : "/",
  build: { outDir: "docs", emptyOutDir: true },
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
      "@app": fileURLToPath(new URL("./src/app", import.meta.url)),
    },
  },
  plugins: [
    vue(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"],
      manifest: {
        name: "Cuaderno de campo",
        short_name: "Cuaderno",
        description: "Muestreos, lectura de cámara de forzado, fenología y censos en colecciones de frutales. Sin cobertura y con salida a Excel.",
        lang: "es",
        start_url: ".",
        scope: ".",
        display: "standalone",
        orientation: "portrait",
        background_color: "#f6f4ee",
        theme_color: "#1f5f2a",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // A season's readings never touch the network; the app shell is what gets cached.
        navigateFallback: "index.html",
      },
    }),
  ],
}));

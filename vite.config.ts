import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
const base = process.env.VITE_BASE || "./";
export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icons/*.png", "icons/*.svg"],
      manifest: {
        name: "印仔小星球",
        short_name: "印仔星球",
        lang: "zh-HK",
        start_url: base,
        scope: base,
        display: "standalone",
        background_color: "#f6f3eb",
        theme_color: "#142c50",
        icons: [192, 512].map((s) => ({
          src: `icons/icon-${s}.png`,
          sizes: `${s}x${s}`,
          type: "image/png",
          purpose: "any",
        })),
      },
      workbox: {
        navigateFallback: `${base}index.html`,
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: { target: "safari17" },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});

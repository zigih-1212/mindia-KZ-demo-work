import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// base: "/" — SPA обслуживается с корня сайта (Cloudflare Pages, nginx).
// Относительный base ломает глубокие ссылки: при перезагрузке /estimates/:id
// index.html тянет ./assets/... уже относительно /estimates/ и получает 404.
// VITE_API_BASE_URL прокидывается на этапе сборки (см. web/.env.example).
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: {
      // В dev удобно ходить на локальный API без CORS-плясок.
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/healthz": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});

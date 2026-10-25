import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Куда проксировать API: по умолчанию сервер разработки, в сквозных тестах — свой порт
const API = process.env.API_URL ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": { target: API, changeOrigin: false },
      "/posters": API,
      "/places": API,
      "/ideas": API,
      "/media": API,
      "/film-posters": API,
      "/film-thumb": API,
      "/pay": API,
      "/plus-terms": API,
      "/privacy": API,
      "/consent": API,
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 900,
  },
});

import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    // Запросы /api из веб-апа уходят на сервер бота
    proxy: { "/api": "http://localhost:3000" },
    allowedHosts: true, // чтобы работало через ngrok/cloudflared
  },
});

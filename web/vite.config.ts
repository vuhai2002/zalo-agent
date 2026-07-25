import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Root của app web là thư mục web/ này; dev proxy /api sang dashboard server
// (bot phải đang chạy: pnpm dev). Build ra web/dist để Hono serve ở production.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3900",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Version LẤY TỪ package.json gốc, không gõ tay trong JSX: trước đây sidebar
 * hiện chuỗi "v0.1.0" cứng, nâng package.json lên là web vẫn hiện số cũ mà
 * không có gì báo lệch - người dùng đọc số trên màn hình rồi tưởng đang chạy
 * bản đó.
 *
 * Đọc bằng readFileSync thay vì `import pkg from "../package.json"`: import
 * JSON kéo cả file vào bundle (mọi dependency, script...) chỉ để lấy 1 chuỗi.
 */
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

// Root của app web là thư mục web/ này; dev proxy /api sang dashboard server
// (bot phải đang chạy: pnpm dev). Build ra web/dist để Hono serve ở production.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
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

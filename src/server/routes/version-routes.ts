import { Hono } from "hono";
import { layBanMoiNhat } from "../update-check.js";

/**
 * GET /api/version - cho chân sidebar biết trên GitHub có bản phát hành mới hơn
 * bản đang chạy không. Toàn bộ cache + fail-soft nằm trong `update-check.ts`;
 * route chỉ là lớp mỏng. Client tự so `__APP_VERSION__` với `latest` để quyết
 * định có hiện nút "Cập nhật" hay không.
 */
export const versionRoutes = new Hono().get("/", async (c) => c.json(await layBanMoiNhat()));

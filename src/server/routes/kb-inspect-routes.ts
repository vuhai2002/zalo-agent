import { Hono } from "hono";
import { agentCuaNguon } from "../../knowledge/kb-agent-binding.js";
import { demDoan, layDoanCuaNguon } from "../../knowledge/kb-chunk-store.js";
import { layNguon } from "../../knowledge/kb-source-store.js";
import { chunksQuerySchema } from "./kb-route-guards.js";

/**
 * Hai route CHỈ ĐỌC phục vụ I19 (cảnh báo xóa nói rõ agent nào mất quyền) và
 * I21 (trang xem đoạn đã cắt) - tách khỏi `kb-routes.ts` để giữ file đó dưới
 * 200 dòng, cùng nếp tách `kb-route-guards.ts` đã làm ở phase 05. Mount vào
 * `kbRoutes` bằng `.route("/", kbInspectRoutes)` - `"/"` để KHÔNG cộng thêm
 * tiền tố, route vẫn nằm nguyên dưới `/api/kb/...` của router cha.
 */
export const kbInspectRoutes = new Hono()
  // I21: PHÂN TRANG bắt buộc (xem lý do ở `chunksQuerySchema`) - một nguồn
  // dài có thể cắt ra hàng nghìn đoạn. `tieuDe` luôn kèm theo (kể cả rỗng) -
  // breadcrumb duy nhất để người vận hành tự phát hiện bot đọc sai cấu trúc
  // tài liệu mà không cần bật AGENT_TRACE_ENABLED.
  .get("/sources/:id/chunks", (c) => {
    const id = c.req.param("id");
    if (!layNguon(id)) return c.json({ error: "Không tìm thấy nguồn" }, 404);
    const parsed = chunksQuerySchema.safeParse({
      offset: c.req.query("offset"),
      limit: c.req.query("limit"),
    });
    if (!parsed.success) return c.json({ error: "Tham số phân trang không hợp lệ" }, 400);
    const { offset, limit } = parsed.data;
    return c.json({ items: layDoanCuaNguon(id, offset, limit), total: demDoan(id) });
  })

  // I19: agent nào đang gán nguồn này - dashboard đọc TRƯỚC khi hiện hộp xác
  // nhận xóa, để nói thật số agent sẽ mất quyền tra cứu thay vì cảnh báo
  // chung chung không nói gì cụ thể. 404 khi nguồn không tồn tại - nhất quán
  // với `chunks` và `DELETE` ngay cạnh trong `kb-routes.ts` (cả hai đều kiểm
  // `layNguon` trước).
  .get("/sources/:id/agents", (c) => {
    const id = c.req.param("id");
    if (!layNguon(id)) return c.json({ error: "Không tìm thấy nguồn" }, 404);
    return c.json({ agentIds: agentCuaNguon(id) });
  });

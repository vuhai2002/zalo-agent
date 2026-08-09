import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { getTuning } from "../../config/runtime-tuning-settings.js";
import type { DinhDangKb } from "../../knowledge/doc-text-extract.js";

/**
 * Guard dùng chung cho các route /api/kb (`kb-routes.ts`): chặn dung lượng
 * body, kiểm chữ ký file thật, và schema Zod cho tên nguồn / mảng sourceIds.
 * Tách khỏi kb-routes.ts để giữ file route dưới 200 dòng - các guard này
 * không đụng `c.req.param`/DB nên tách được sạch, không phải bổ đôi một khối
 * logic đang liền mạch.
 */

// Chữ ký thật của file (magic bytes), KHÔNG tin đuôi tên - đuôi tên là lời
// người dùng tự khai, còn mấy byte đầu là thứ hệ điều hành/thư viện đọc thấy.
// txt/md không có chữ ký cố định nên không kiểm (chấp nhận mọi byte).
const MAGIC_BYTES: Partial<Record<DinhDangKb, (buf: Buffer) => boolean>> = {
  pdf: (buf) => buf.subarray(0, 4).toString("latin1") === "%PDF",
  docx: (buf) => buf.subarray(0, 2).toString("latin1") === "PK",
  xlsx: (buf) => buf.subarray(0, 2).toString("latin1") === "PK",
};

export function khopChuKyThat(buf: Buffer, dinhDang: DinhDangKb): boolean {
  const kiemTra = MAGIC_BYTES[dinhDang];
  return kiemTra ? kiemTra(buf) : true;
}

/**
 * Chặn body quá trần NGAY Ở TẦNG ĐỌC: `hono/body-limit` đọc luồng theo từng
 * mảnh (hoặc kiểm `Content-Length` khi có) và hủy giữa chừng nếu vượt trần,
 * KHÔNG đợi gom hết byte vào RAM rồi mới báo quá lớn. Đọc `getTuning` lại mỗi
 * request (không chốt lúc mount route) - đúng triết lý "đọc lại mỗi lần dùng"
 * của cả dự án, để đổi KB_MAX_FILE_MB trên dashboard có tác dụng ngay.
 *
 * Dùng chung cho CẢ ba route ghi body lớn (upload file, gõ tay, gán nguồn cho
 * agent) - `c.req.json()`/`c.req.parseBody()` gom trọn body vào RAM trước khi
 * kịp kiểm gì cả nếu thiếu middleware này.
 */
export const chanTranDungLuong: MiddlewareHandler = (c, next) => {
  const maxMB = getTuning("KB_MAX_FILE_MB");
  return bodyLimit({
    maxSize: maxMB * 1024 * 1024,
    onError: (c) => c.json({ error: `Nội dung vượt quá ${maxMB}MB` }, 413),
  })(c, next);
};

// Trần độ dài TÊN nguồn dùng CHUNG cho CẢ HAI route tạo nguồn (gõ tay lẫn
// upload file) - "ten" đi vào MỌI kết quả kb_search nên đây là biên hệ thống
// thật, không phải chỉ giao diện. 200 ký tự khớp `maxLength` của ô tên trên
// form thêm nguồn.
export const tenNguonSchema = z.string().min(1).max(200);

export const textSourceSchema = z.object({
  ten: tenNguonSchema,
  noiDung: z.string(),
});

// Trang xem đoạn (I21, dashboard) PHẢI phân trang - một nguồn dài có thể cắt
// ra hàng nghìn đoạn, `limit` không trần thì một tham số query tùy ý kéo cả
// bảng `kb_chunks` của một nguồn về một lần, đúng lớp OOM mà route upload đã
// chặn ở đường GHI, không thể bỏ ngỏ ở đường ĐỌC. `.coerce` vì query string
// luôn là chuỗi.
export const chunksQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const putAgentSourcesSchema = z.object({
  sourceIds: z
    .array(
      // Id thật là hex 16 ký tự (`randomBytes(8).toString("hex")` ở
      // kb-source-store.ts) - 64 đã dư. Thiếu trần này thì `.max(500)` ở dưới
      // (giới hạn SỐ LƯỢNG phần tử) không ngăn được MỘT phần tử khổng lồ một
      // mình đủ nuốt RAM trước khi kịp tới `locIdTonTai`.
      z.string().max(64),
    )
    // Trần 500: `locIdTonTai` dựng một placeholder SQL cho MỖI id
    // (`SELECT id FROM kb_sources WHERE id IN (?, ?, ...)`) - mảng dài không
    // trần vượt `SQLITE_LIMIT_VARIABLE_NUMBER` (32766 ở bản SQLite hiện đại) là
    // `db.prepare` NÉM, lỗi lọt khỏi handler thành 500 trần thay vì 400 có lý
    // do. Số nguồn thật của một kho không bao giờ gần tới 500.
    .max(500),
});

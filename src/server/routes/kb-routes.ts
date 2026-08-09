import { randomBytes } from "node:crypto";
import path from "node:path";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { getAgent } from "../../config/agent-store.js";
import { getTuning } from "../../config/runtime-tuning-settings.js";
import { DINH_DANG_HO_TRO, laDinhDangHoTro, type DinhDangKb } from "../../knowledge/doc-text-extract.js";
import { datNguonChoAgent, nguonCuaAgent } from "../../knowledge/kb-agent-binding.js";
import { luuFile, xoaFile } from "../../knowledge/kb-file-store.js";
import { danhSachNguonGon, locIdTonTai } from "../../knowledge/kb-source-queries.js";
import { layNguon, taoNguon, datTrangThai, xoaNguon } from "../../knowledge/kb-source-store.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("kb-routes");

/**
 * /api/kb - CRUD nguồn Kho tri thức, upload file, gán nguồn cho agent.
 *
 * Xử lý nội dung (đọc file, cắt đoạn) KHÔNG nằm ở đây - route chỉ ghi file +
 * tạo dòng DB ở trạng thái `cho_xu_ly` rồi trả response ngay, `kb-ingest-worker.ts`
 * xử lý ở vòng nền kế tiếp. Xem lý do ở đầu file đó.
 */

// Chữ ký thật của file (magic bytes), KHÔNG tin đuôi tên - đuôi tên là lời
// người dùng tự khai, còn mấy byte đầu là thứ hệ điều hành/thư viện đọc thấy.
// txt/md không có chữ ký cố định nên không kiểm (chấp nhận mọi byte).
const MAGIC_BYTES: Partial<Record<DinhDangKb, (buf: Buffer) => boolean>> = {
  pdf: (buf) => buf.subarray(0, 4).toString("latin1") === "%PDF",
  docx: (buf) => buf.subarray(0, 2).toString("latin1") === "PK",
  xlsx: (buf) => buf.subarray(0, 2).toString("latin1") === "PK",
};

function khopChuKyThat(buf: Buffer, dinhDang: DinhDangKb): boolean {
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
 * Dùng chung cho CẢ route upload file LẪN route gõ tay - `noi_dung_goc` của
 * nguồn gõ tay đi thẳng qua `c.req.json()` không hề bị chặn dung lượng nếu
 * thiếu middleware này, và `await c.req.json()` gom trọn body vào RAM trước
 * khi kịp kiểm gì cả.
 */
const chanTranDungLuong: MiddlewareHandler = (c, next) => {
  const maxMB = getTuning("KB_MAX_FILE_MB");
  return bodyLimit({
    maxSize: maxMB * 1024 * 1024,
    onError: (c) => c.json({ error: `Nội dung vượt quá ${maxMB}MB` }, 413),
  })(c, next);
};

const textSourceSchema = z.object({
  // 200 ký tự khớp `maxLength` của ô tên trên form thêm nguồn - ô đó chỉ là
  // giao diện, biên hệ thống thật phải nằm ở đây.
  ten: z.string().min(1).max(200),
  noiDung: z.string(),
});

const putAgentSourcesSchema = z.object({
  // Trần 500: `locIdTonTai` dựng một placeholder SQL cho MỖI id
  // (`SELECT id FROM kb_sources WHERE id IN (?, ?, ...)`) - mảng dài không
  // trần vượt `SQLITE_LIMIT_VARIABLE_NUMBER` (32766 ở bản SQLite hiện đại) là
  // `db.prepare` NÉM, lỗi lọt khỏi handler thành 500 trần thay vì 400 có lý
  // do. Số nguồn thật của một kho không bao giờ gần tới 500.
  sourceIds: z.array(z.string()).max(500),
});

export const kbRoutes = new Hono()

  // GỌN: không kèm noi_dung_goc - giao diện chỉ hiện metadata, và trang tự
  // làm mới mỗi vài giây nên kéo dư toàn văn (nguồn gõ tay có thể dài hàng
  // chục nghìn ký tự) là phí băng thông vô ích.
  .get("/sources", (c) => c.json({ items: danhSachNguonGon() }))

  // `chanTranDungLuong` là hàng phòng thủ DUY NHẤT cho dung lượng ở route này
  // (không thêm kiểm tra byte trùng lặp trong handler): `noiDung` luôn là một
  // PHẦN của toàn bộ body JSON, nên bất cứ giá trị nào làm noiDung vượt trần
  // cũng làm cả body vượt trần theo - middleware đã chặn TRƯỚC khi handler kịp
  // gọi `c.req.json()` gom body vào RAM. Thêm một kiểm tra byte sau khi đã
  // parse xong không có tác dụng gì mới, chỉ che mất phép phá thật của route.
  .post("/sources/text", chanTranDungLuong, async (c) => {
    const parsed = textSourceSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Dữ liệu không hợp lệ", issues: parsed.error.issues }, 400);
    const { ten, noiDung } = parsed.data;
    if (!noiDung.trim()) return c.json({ error: "Nội dung không được để trống" }, 400);

    const source = taoNguon({ ten, loai: "text", noiDungGoc: noiDung });
    log.info({ sourceId: source.id }, "Tạo nguồn Kho tri thức (gõ tay)");
    return c.json({ source }, 201);
  })

  .post("/sources/file", chanTranDungLuong, async (c) => {
    const body = await c.req.parseBody().catch(() => null);
    const file = body?.["file"];
    const tenRaw = body?.["ten"];
    const ten = typeof tenRaw === "string" ? tenRaw.trim() : "";
    if (!(file instanceof File) || !ten) {
      return c.json({ error: "Thiếu file hoặc tên nguồn" }, 400);
    }

    const dinhDang = path.extname(file.name).slice(1).toLowerCase();
    if (!laDinhDangHoTro(dinhDang)) {
      return c.json(
        { error: `Định dạng ".${dinhDang || "?"}" chưa hỗ trợ - dùng ${DINH_DANG_HO_TRO.join(", ")}` },
        400,
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (!khopChuKyThat(buf, dinhDang)) {
      return c.json({ error: "Nội dung file không khớp với định dạng khai báo trong tên file" }, 400);
    }

    // Id lưu file KHÔNG PHẢI id của dòng DB (taoNguon tự sinh id riêng) - chỉ
    // cần một chuỗi ngẫu nhiên làm tên file, tuyệt đối không phải tên gốc.
    const fileId = randomBytes(8).toString("hex");
    const duongDan = luuFile(fileId, dinhDang, buf);
    const source = taoNguon({ ten, loai: "file", dinhDang, duongDan, soByte: buf.length });
    log.info({ sourceId: source.id, dinhDang, soByte: buf.length }, "Tạo nguồn Kho tri thức (upload file)");
    return c.json({ source }, 202);
  })

  .post("/sources/:id/reindex", (c) => {
    const id = c.req.param("id");
    const n = layNguon(id);
    if (!n) return c.json({ error: "Không tìm thấy nguồn" }, 404);
    // I6: bấm "Xử lý lại" ĐÚNG LÚC nguồn đang dang_xu_ly (worker thật đang xử
    // lý, hoặc kẹt chờ goNguonKetLucKhoiDong() xét lại) trước đây bị NUỐT LẶNG
    // LẼ - route đặt cho_xu_ly ngay, rồi lượt worker đang chạy ghi đè trạng
    // thái cuối lên trên, xóa mất quyết định vừa bấm. Từ chối rõ ràng bằng 409
    // thay vì tranh giành ngầm.
    //
    // 409 này TẠM THỜI, không phải ngõ cụt: goNguonKetLucKhoiDong() giờ chạy
    // lại MỖI TICK (không chỉ lúc boot, xem kb-ingest-worker.ts), nên một
    // nguồn kẹt dang_xu_ly do worker quá hạn tự thoát trạng thái này trong
    // tối đa một TICK_MS - câu chữ dưới đây phải nói đúng "thử lại sau ít
    // phút", không phải "thử lại sau khi xong" (dễ hiểu lầm là phải đợi VÔ
    // HẠN cho một lượt có thể không bao giờ tự kết thúc).
    if (n.trangThai === "dang_xu_ly") {
      return c.json({ error: "Nguồn đang được xử lý, thử lại sau ít phút" }, 409);
    }
    // Cấp lại budget lượt thử: đây là hành động CHỦ ĐỘNG của người vận hành,
    // không phải retry tự động - cho nguồn một cơ hội đầy đủ, không cộng dồn
    // lượt thử đã tiêu ở lần trước.
    datTrangThai(id, "cho_xu_ly", { soLanThu: 0 });
    return c.json({ source: layNguon(id) });
  })

  .delete("/sources/:id", (c) => {
    const id = c.req.param("id");
    // Lấy duongDan TRƯỚC khi xóa dòng DB - xóa DB trước là mất luôn đường tìm
    // tới file, đĩa phình mãi vì file mồ côi không bao giờ dọn được nữa.
    const n = layNguon(id);
    if (!n) return c.json({ error: "Không tìm thấy nguồn" }, 404);
    xoaNguon(id);
    xoaFile(n.duongDan);
    log.info({ sourceId: id }, "Xóa nguồn Kho tri thức");
    return c.json({ ok: true });
  })

  .get("/agents/:agentId/sources", (c) => c.json({ sourceIds: nguonCuaAgent(c.req.param("agentId")) }))

  .put("/agents/:agentId/sources", async (c) => {
    const agentId = c.req.param("agentId");
    // Không chặn ở đây thì gán được cho một agent KHÔNG TỒN TẠI (id gõ sai,
    // hoặc agent vừa bị xóa) - bảng agent_kb_sources tích lũy dòng mồ côi mà
    // không ai đọc tới, đúng lỗ hổng đối xứng với "gán nguồn không tồn tại"
    // đã chặn ở nhánh sourceIds bên dưới.
    if (!getAgent(agentId)) return c.json({ error: "Agent không tồn tại" }, 400);

    const parsed = putAgentSourcesSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Dữ liệu không hợp lệ", issues: parsed.error.issues }, 400);

    // Tra ĐÚNG các id được gửi lên bằng một câu SELECT ... IN (...), không kéo
    // cả bảng (kèm toàn văn) về so trong JS - cùng lý do với danhSachNguonGon.
    const idTonTai = locIdTonTai(parsed.data.sourceIds);
    const idKhongTonTai = parsed.data.sourceIds.filter((id) => !idTonTai.has(id));
    if (idKhongTonTai.length > 0) {
      // Không chặn ở đây thì bảng agent_kb_sources tích lũy id rác, và trang
      // agent hiện ô tick trỏ vào một nguồn không còn tồn tại.
      return c.json({ error: `Nguồn không tồn tại: ${idKhongTonTai.join(", ")}` }, 400);
    }

    datNguonChoAgent(agentId, parsed.data.sourceIds);
    log.info({ agentId, soNguon: parsed.data.sourceIds.length }, "Đặt lại nguồn Kho tri thức cho agent");
    return c.json({ sourceIds: nguonCuaAgent(agentId) });
  });

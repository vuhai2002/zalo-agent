import { randomBytes } from "node:crypto";
import path from "node:path";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { getTuning } from "../../config/runtime-tuning-settings.js";
import { DINH_DANG_HO_TRO, laDinhDangHoTro, type DinhDangKb } from "../../knowledge/doc-text-extract.js";
import { datNguonChoAgent, nguonCuaAgent } from "../../knowledge/kb-agent-binding.js";
import { luuFile, xoaFile } from "../../knowledge/kb-file-store.js";
import { danhSachNguon, layNguon, taoNguon, datTrangThai, xoaNguon } from "../../knowledge/kb-source-store.js";
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
 * Chặn file quá trần NGAY Ở TẦNG ĐỌC: `hono/body-limit` đọc luồng theo từng
 * mảnh (hoặc kiểm `Content-Length` khi có) và hủy giữa chừng nếu vượt trần,
 * KHÔNG đợi gom hết byte vào RAM rồi mới báo quá lớn. Đọc `getTuning` lại mỗi
 * request (không chốt lúc mount route) - đúng triết lý "đọc lại mỗi lần dùng"
 * của cả dự án, để đổi KB_MAX_FILE_MB trên dashboard có tác dụng ngay.
 */
const chanTranDungLuong: MiddlewareHandler = (c, next) => {
  const maxMB = getTuning("KB_MAX_FILE_MB");
  return bodyLimit({
    maxSize: maxMB * 1024 * 1024,
    onError: (c) => c.json({ error: `File vượt quá ${maxMB}MB` }, 413),
  })(c, next);
};

const textSourceSchema = z.object({
  ten: z.string().min(1),
  noiDung: z.string(),
});

const putAgentSourcesSchema = z.object({
  sourceIds: z.array(z.string()),
});

export const kbRoutes = new Hono()

  .get("/sources", (c) => c.json({ items: danhSachNguon() }))

  .post("/sources/text", async (c) => {
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
    if (!layNguon(id)) return c.json({ error: "Không tìm thấy nguồn" }, 404);
    datTrangThai(id, "cho_xu_ly");
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
    const parsed = putAgentSourcesSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Dữ liệu không hợp lệ", issues: parsed.error.issues }, 400);

    const nguonTonTai = new Set(danhSachNguon().map((n) => n.id));
    const idKhongTonTai = parsed.data.sourceIds.filter((id) => !nguonTonTai.has(id));
    if (idKhongTonTai.length > 0) {
      // Không chặn ở đây thì bảng agent_kb_sources tích lũy id rác, và trang
      // agent hiện ô tick trỏ vào một nguồn không còn tồn tại.
      return c.json({ error: `Nguồn không tồn tại: ${idKhongTonTai.join(", ")}` }, 400);
    }

    datNguonChoAgent(agentId, parsed.data.sourceIds);
    log.info({ agentId, soNguon: parsed.data.sourceIds.length }, "Đặt lại nguồn Kho tri thức cho agent");
    return c.json({ sourceIds: nguonCuaAgent(agentId) });
  });

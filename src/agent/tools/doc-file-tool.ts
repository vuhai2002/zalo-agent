import { tool } from "ai";
import { z } from "zod";
import { layTepGanDay as layTepGanDayThat } from "../../attachments/attachment-store.js";
import { layNoiDungTep as layNoiDungTepThat, type MaLoiLayTep } from "../../attachments/lay-noi-dung-tep.js";
import { taoPhuThuocLayTep } from "../../attachments/phu-thuoc-lay-tep.js";
import { getTuning } from "../../config/runtime-tuning-settings.js";
import { MO_TA_DOC_FILE } from "./doc-file-tool-description.js";
import { dungKetQuaDocTep } from "./dung-ket-qua-doc-tep.js";
import type { ToolContext } from "./index.js";
import { ketQuaLoi } from "./tool-failure-result.js";

/**
 * Tool `doc_file`: đọc tệp người dùng gửi trong thread (pdf, docx, doc, xlsx,
 * chữ; PDF quét chép bằng OCR). Nội dung luôn bọc nonce; mọi nhánh hỏng là
 * `ketQuaLoi`. Đọc thành công thì bật `ctx.trangThaiLuot.daDocTep` - từ step kế
 * tiếp các tool ghi bền / tác động ngoài bị tạm tắt tới hết lượt
 * (`chan-tool-sau-khi-doc-tep.ts`).
 *
 * Suất (tệp mỗi giờ, trang OCR mỗi giờ) tính theo người HỎI, không phải người
 * gửi tệp: người hỏi là người khiến bot tốn công.
 */

const SO_TEP_GAN_DAY = 10;

export type PhuThuocDocFile = {
  layTepGanDay: (accountId: string, threadId: string, now: Date, gioiHan?: number) => ReturnType<typeof layTepGanDayThat>;
  layNoiDungTep: (
    tep: Parameters<typeof layNoiDungTepThat>[0],
    p: Omit<Parameters<typeof layNoiDungTepThat>[1], "deps">,
  ) => ReturnType<typeof layNoiDungTepThat>;
};

const phuThuocThat: PhuThuocDocFile = {
  layTepGanDay: layTepGanDayThat,
  layNoiDungTep: (tep, p) => layNoiDungTepThat(tep, { ...p, deps: taoPhuThuocLayTep() }),
};

function cauLoi(ma: MaLoiLayTep): string {
  switch (ma) {
    case "het-han":
      return "Tệp này đã quá hạn giữ hoặc link tải của Zalo đã hết hạn. Nhờ người dùng gửi lại tệp.";
    case "qua-lon":
      return `Tệp vượt dung lượng cho phép (tối đa ${getTuning("ATTACHMENT_MAX_MB")} MB, Word/Excel ${getTuning("ATTACHMENT_OFFICE_MAX_MB")} MB). Nhờ người dùng gửi bản nhỏ hơn hoặc chỉ phần cần.`;
    case "mat-khau":
      return "Tệp có mật khẩu nên không đọc được. Nhờ người dùng gỡ mật khẩu rồi gửi lại.";
    case "chua-ho-tro":
      return "Chưa đọc được loại tệp này (đọc được: pdf, docx, doc, xlsx, txt, csv, md). Ảnh thì nhờ người dùng gửi dạng ảnh.";
    case "hong":
      return "Tệp bị hỏng, không đọc được. Nhờ người dùng mở thử trên máy rồi gửi lại.";
    case "bi-ngat":
      return "Tệp quá nặng hoặc có cấu trúc lạ nên việc đọc bị dừng giữa chừng. Thử lại sau ít phút; vẫn lỗi thì nhờ người dùng gửi bản nhỏ hơn.";
    case "het-tran-gio":
      return "Đã đọc nhiều tệp mới trong giờ này, thử lại sau ít phút.";
    case "host-la":
      return "Link tải của tệp không phải máy chủ Zalo nên không tải. Nhờ người dùng gửi lại tệp trực tiếp trên Zalo.";
    case "mang":
      return "Chưa tải được tệp (lỗi mạng). Thử lại sau ít phút.";
  }
}

function docDai(trang: string): [number, number] {
  const [a, b = a] = trang.split("-").map(Number) as [number, number?];
  return a <= b! ? [a, b!] : [b!, a];
}

export function createDocFileTool(ctx: ToolContext, deps: PhuThuocDocFile = phuThuocThat) {
  return tool({
    description: MO_TA_DOC_FILE,
    inputSchema: z.object({
      tepSo: z.coerce.number().int().min(1).max(SO_TEP_GAN_DAY).default(1).describe("Tệp thứ mấy tính từ MỚI NHẤT (1 = tệp mới nhất)"),
      trang: z
        .string()
        .regex(/^\d{1,4}(-\d{1,4})?$/)
        .optional()
        .describe('Dải trang PDF quét cần chép chữ, vd "6-15" hoặc "7". Bỏ trống = vài trang đầu.'),
      tuKyTu: z.coerce.number().int().min(0).default(0).describe("Đọc tiếp từ ký tự thứ mấy (kết quả trước sẽ chỉ số này)"),
    }),
    execute: async ({ tepSo, trang, tuKyTu }) => {
      try {
        const now = new Date();
        const ds = deps.layTepGanDay(ctx.account.id, ctx.message.threadId, now, SO_TEP_GAN_DAY);
        if (ds.length === 0) {
          return ketQuaLoi(
            `Không có tệp nào trong cuộc trò chuyện gần đây (tệp được giữ ${getTuning("ATTACHMENT_RETENTION_DAYS")} ngày). Nhờ người dùng gửi tệp.`,
          );
        }
        const tep = ds[tepSo - 1];
        if (!tep) return ketQuaLoi(`Cuộc trò chuyện chỉ có ${ds.length} tệp gần đây - tepSo ${tepSo} vượt quá.`);

        const kq = await deps.layNoiDungTep(tep, {
          nguoiGuiKey: `${ctx.account.id}:${ctx.message.senderId}`,
          now,
          ...(trang ? { daiTrang: docDai(trang) } : {}),
        });
        if (!kq.ok) return ketQuaLoi(cauLoi(kq.ma));

        if (ctx.trangThaiLuot) ctx.trangThaiLuot.daDocTep = true;
        const daiTrang = trang ? docDai(trang) : undefined;
        return dungKetQuaDocTep({
          tepSo,
          ten: tep.ten,
          // KHÔNG lùi về `duoiKhai`: đó là chuỗi client người gửi tự khai, còn
          // phần đầu kết quả là vùng model tin - chỉ chữ do máy chủ dựng
          dinhDang: kq.tep.dinhDang ?? "không rõ",
          ...(daiTrang ? { daiTrang } : {}),
          soTrang: kq.tep.soTrang,
          noiDung: kq.noiDung,
          trangDaOcr: kq.trangDaOcr,
          trangChuaOcr: kq.trangChuaOcr,
          trangVuotTran: kq.trangVuotTran,
          boQuaOcr: kq.boQuaOcr,
          canhBao: kq.canhBao,
          tuKyTu,
          tranKyTu: getTuning("ATTACHMENT_READ_MAX_CHARS"),
        });
      } catch (err) {
        // Tool không ném ra agent loop - luật repo
        const lyDo = err instanceof Error ? err.message : String(err);
        return ketQuaLoi(`Đọc tệp lỗi (${lyDo}). Nói thật với người dùng là chưa đọc được, đừng đoán nội dung.`);
      }
    },
  });
}

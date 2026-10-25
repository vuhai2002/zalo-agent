import { tool } from "ai";
import { z } from "zod";
import { getTuning } from "../../config/runtime-tuning-settings.js";
import { getRecentMessages } from "../../conversation/history-store.js";
import {
  danhSachGhiChu,
  docGhiChu,
  luuGhiChu,
  thayNoiDungGhiChu,
  timGhiChuDeDoc,
  xoaGhiChu,
  type PhamViGhiChu,
} from "../../conversation/verbatim-note-store.js";
import type { ToolContext } from "./index.js";
import { timDoanNguyenVan } from "./khop-nguyen-van.js";
import { ketQuaLoi } from "./tool-failure-result.js";
import { MO_TA_VERBATIM_NOTE } from "./verbatim-note-tool-description.js";
import { wrapUntrustedContent } from "./wrap-untrusted-content.js";

/**
 * Charset của TÊN ghi chú. Tên do model đặt từ chữ người dùng rồi nằm trong
 * system prompt ở mọi lượt sau (khối `ghi_chu_da_luu`), nên siết ở đầu vào:
 * không có `<`, `>`, xuống dòng hay ký tự ẩn thì tên không thể đóng giả thẻ
 * hay mở một dòng "hệ thống". Siết bằng charset thay vì khử sau, vì đây là chỗ
 * duy nhất tên được sinh ra.
 */
const TEN_HOP_LE = /^[\p{L}\p{M}\p{N} ,.()/&+'-]{2,80}$/u;

/**
 * Tin gần đây để đối chiếu nguyên văn. Gấp đôi cửa sổ lịch sử model đang thấy:
 * phủ cả tin của lượt này (đã ghi vào lịch sử lúc nhận) và tin chen. Model chỉ
 * chép được thứ nó đang thấy, nên đọc xa hơn cũng không giúp gì.
 */
function tinGanDay(ctx: ToolContext): string[] {
  const soDong = getTuning("HISTORY_CONTEXT_LIMIT") * 2;
  return getRecentMessages(ctx.account.id, ctx.message.threadId, soDong).map((m) => m.content);
}

function loiLech(kq: { khopDuoc: number; tongKyTu: number; lechTu: string }) {
  const viTri =
    kq.khopDuoc === 0
      ? "Không khớp ngay từ đầu."
      : `Khớp được ${kq.khopDuoc}/${kq.tongKyTu} ký tự rồi lệch từ: "${kq.lechTu}".`;
  return ketQuaLoi(
    `Nội dung không khớp NGUYÊN VĂN với tin nhắn gần đây nên chưa lưu. ${viTri} ` +
      "Chép lại đúng từng chữ (giữ cả lỗi chính tả, emoji, ký hiệu), không tóm tắt, chỉ bỏ câu dặn của người dùng. " +
      "Nếu đoạn đó nằm ở tin đã quá cũ, nhờ người dùng gửi lại.",
  );
}

/**
 * Câu kèm theo khi bộ khớp đã bỏ rác ở đuôi. Đưa CẢ phần tin gốc còn sau chỗ
 * dừng: ca model bỏ sót dòng cuối rồi mới thêm rác cũng lọt cửa này, nên model
 * phải được thấy để tự 'thay' lại nếu thiếu.
 */
function ghiChuBoDuoi(kq: ReturnType<typeof timDoanNguyenVan>): string {
  if (!kq.ok || !kq.boDuoi) return "";
  const { phanThua, tinGocConLai } = kq.boDuoi;
  const conLai = tinGocConLai
    ? ` Sau chỗ đó tin gốc còn: "${tinGocConLai}" - nếu phần này cũng thuộc nội dung cần lưu thì gọi 'thay' với đủ nội dung.`
    : "";
  return ` Đã bỏ phần "${phanThua}" ở cuối vì tin gốc không có.${conLai}`;
}

function loiKhongCo(pham: PhamViGhiChu, ten: string) {
  const ds = danhSachGhiChu(pham).map((g) => `- ${g.title}`);
  return ketQuaLoi(
    ds.length === 0
      ? `Không có ghi chú "${ten}" - người này chưa lưu ghi chú nào.`
      : `Không có ghi chú "${ten}". Đang có:\n${ds.join("\n")}\nGọi lại với đúng tên trong danh sách trên.`,
  );
}

export function createVerbatimNoteTool(ctx: ToolContext) {
  const { account, message } = ctx;
  return tool({
    description: MO_TA_VERBATIM_NOTE,
    inputSchema: z.object({
      action: z.enum(["luu", "doc", "sua", "thay", "xoa"]),
      tieu_de: z.string().min(1).max(120).describe("Tên ghi chú, ngắn gọn, dùng để tìm lại"),
      noi_dung: z
        .string()
        .optional()
        .describe("Nội dung chép NGUYÊN VĂN từ tin nhắn. Bắt buộc với 'luu' và 'thay'."),
      thay_doan: z.string().optional().describe("'sua': đoạn chữ cũ trong ghi chú, chép đúng"),
      thay_bang: z.string().optional().describe("'sua': chữ mới thay vào"),
    }),
    execute: async ({ action, tieu_de, noi_dung, thay_doan, thay_bang }) => {
      if (!message.senderId) return ketQuaLoi("Không xác định được người nhắn để gắn ghi chú");
      const pham: PhamViGhiChu = {
        accountId: account.id,
        subjectId: message.senderId,
        chiTrongNhom: message.isGroup,
      };
      const ten = tieu_de.normalize("NFC").trim().replace(/\s+/g, " ");
      const tranKyTu = getTuning("VERBATIM_NOTE_MAX_CHARS");
      const quaDai = (n: number) =>
        ketQuaLoi(`Đoạn này dài ${n} ký tự, vượt trần ${tranKyTu} ký tự mỗi ghi chú nên không lưu được.`);

      if (action === "doc") {
        const gc = timGhiChuDeDoc(pham, ten);
        if (!gc) return loiKhongCo(pham, ten);
        const noiDung = wrapUntrustedContent(gc.content, `ghi chú "${gc.title}" người dùng đã nhờ lưu nguyên văn`);
        return gc.ganDung
          ? `Không có tên đúng như vậy; ghi chú gần nhất là "${gc.title}". Đúng ghi chú người dùng hỏi thì gửi lại nội dung dưới đây.\n${noiDung}`
          : noiDung;
      }

      if (action === "xoa") {
        return xoaGhiChu(pham, ten) ? `Đã xóa ghi chú "${ten}".` : loiKhongCo(pham, ten);
      }

      if (action === "sua") {
        const gc = docGhiChu(pham, ten);
        if (!gc) return loiKhongCo(pham, ten);
        if (!thay_doan || thay_bang === undefined) {
          return ketQuaLoi("Thiếu thay_doan (đoạn cũ) hoặc thay_bang (chữ mới)");
        }
        const kq = timDoanNguyenVan(thay_doan, [gc.content]);
        if (!kq.ok) {
          return ketQuaLoi(
            `Ghi chú "${gc.title}" không chứa đúng đoạn "${thay_doan}". Gọi 'doc' để xem nội dung rồi chép đúng đoạn cần thay.`,
          );
        }
        const lanXuatHien = gc.content.split(kq.doanGoc).length - 1;
        if (lanXuatHien > 1) {
          return ketQuaLoi(`Đoạn "${thay_doan}" xuất hiện ${lanXuatHien} lần trong ghi chú, chép dài hơn cho rõ chỗ cần thay.`);
        }
        const viTri = gc.content.indexOf(kq.doanGoc);
        const moi = gc.content.slice(0, viTri) + thay_bang + gc.content.slice(viTri + kq.doanGoc.length);
        if (moi.length > tranKyTu) return quaDai(moi.length);
        thayNoiDungGhiChu(pham, ten, moi);
        return `Đã sửa ghi chú "${gc.title}": "${kq.doanGoc}" -> "${thay_bang}". Phần còn lại giữ nguyên.`;
      }

      // 'luu' và 'thay': nội dung phải là nguyên văn một đoạn trong tin gần đây
      if (!noi_dung?.trim()) return ketQuaLoi("Thiếu noi_dung cần lưu");
      if (action === "thay" && !docGhiChu(pham, ten)) return loiKhongCo(pham, ten);
      if (action === "luu" && !TEN_HOP_LE.test(ten)) {
        return ketQuaLoi("Tên ghi chú chỉ gồm chữ, số, khoảng trắng và , . ( ) / & + ' -, dài 2-80 ký tự. Đặt lại tên ngắn gọn.");
      }
      const kq = timDoanNguyenVan(noi_dung, tinGanDay(ctx));
      if (!kq.ok) return loiLech(kq);
      if (kq.doanGoc.length > tranKyTu) return quaDai(kq.doanGoc.length);

      if (action === "thay") {
        thayNoiDungGhiChu(pham, ten, kq.doanGoc);
        return `Đã thay ghi chú "${ten}" bằng bản mới (${kq.doanGoc.length} ký tự, khớp nguyên văn).${ghiChuBoDuoi(kq)}`;
      }
      const luu = luuGhiChu(
        pham,
        { title: ten, content: kq.doanGoc, threadId: message.threadId, isGroup: message.isGroup },
        getTuning("VERBATIM_NOTE_MAX_PER_SUBJECT"),
      );
      if (!luu.ok) {
        return luu.loai === "trung_ten"
          ? ketQuaLoi(`Tên "${ten}" đã được dùng. Muốn thay bản cũ thì dùng action 'thay', còn không thì đặt tên khác.`)
          : ketQuaLoi(`Đã đủ ${luu.tran} ghi chú, không lưu thêm được. Hỏi người dùng muốn xóa ghi chú nào.`);
      }
      return `Đã lưu nguyên văn ghi chú "${ten}" (${kq.doanGoc.length} ký tự, khớp tin gốc).${ghiChuBoDuoi(kq)}`;
    },
  });
}

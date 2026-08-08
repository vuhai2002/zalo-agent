import { botTimeZone } from "../config/runtime-tuning-settings.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { dongTinNguoiDung } from "./user-message-line.js";

/** Tin chỉ có ảnh vẫn phải có chữ, không thì model đọc một dòng trống */
const CHI_CO_ANH = "(gửi ảnh, không kèm chữ)";

/**
 * Phần CHỮ của lượt hiện tại: MỖI TIN MỘT DÒNG `[08/08 00:12] Hải: nội dung`,
 * đúng hình dạng mà `historyToModelMessages` dựng cho lịch sử (chung hàm
 * `dongTinNguoiDung`).
 *
 * Tách khỏi `agent-turn-content.ts` theo đúng ranh giới việc: file đó lo ẢNH
 * (4 chế độ native/describe/hybrid/blind), file này lo CHỮ.
 *
 * Bản cũ gộp phẳng: nối hết chữ bằng `\n` rồi dán MỘT tên - tên của tin CUỐI
 * batch. Hai chỗ hỏng vì thế:
 *
 *   1. Không có nhãn giờ, nên mốc giờ mới nhất model thấy được luôn là của tin
 *      TRƯỚC ĐÓ trong lịch sử. Đêm 07 rạng 08/08/2026 model đọc nhãn 23:37 rồi
 *      tưởng câu hỏi lúc 00:12 được gửi từ hôm trước.
 *   2. Hồi đó `enqueueMessage` gom theo THREAD chứ không theo người gửi, nên
 *      trong nhóm hai người cùng @mention bot trong một nhịp là vào chung một
 *      batch và lời người thứ nhất bị gán cho người thứ hai. Nay hàng chờ khóa
 *      theo `(thread, người gửi)` nên một batch chỉ có một người - lý do này
 *      HẾT hiệu lực, nhưng cách dựng từng dòng thì giữ: nó vẫn đúng, và là thứ
 *      giữ cho hình dạng khớp với lịch sử (điểm ngay dưới).
 *
 * Dán tên cả trong chat RIÊNG chứ không chỉ trong nhóm - cũng để khớp lịch sử,
 * vốn luôn dán tên khi có. Nhờ khớp mà cùng một tin render y hệt nhau ở lượt
 * này và ở lượt sau (lúc nó đã thành lịch sử), tiền tố chung giữa hai request
 * không bị cắt ngay tại đó.
 *
 * KHÔNG gắn nhãn `[chưa xác minh]`: mọi tin tới được đây đều đã qua
 * `shouldRespond`, tức đã trong allowlist. Nhãn đó chỉ có nghĩa với tin
 * passive-listen, mà những tin ấy chỉ đi đường lịch sử.
 */
export function dongTinCuaLuot(batch: ParsedMessage[]): string {
  const timeZone = botTimeZone();
  const dong = batch
    .map((m) => {
      const chu = m.text.trim();
      if (!chu && m.images.length === 0) return "";
      return dongTinNguoiDung({
        createdAt: m.sentAt,
        timeZone,
        senderName: m.senderName,
        noiDung: chu || CHI_CO_ANH,
      });
    })
    .filter(Boolean);

  // Batch rỗng không xảy ra trong đường chạy thật (`shouldRespond` đã loại tin
  // không có nội dung xử lý được), nhưng trả chuỗi rỗng ở đây là gửi cho model
  // một part text trống - nói ra còn hơn để nó đoán.
  return dong.length > 0 ? dong.join("\n") : CHI_CO_ANH;
}

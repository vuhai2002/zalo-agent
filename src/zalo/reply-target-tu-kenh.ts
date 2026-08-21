import type { ThreadType } from "zca-js";
import type { KenhLuot } from "./kenh-luot.js";
import type { ReplyTarget } from "./send-reply-in-parts.js";

/**
 * Dựng `ReplyTarget` từ một `KenhLuot` - MỘT chỗ duy nhất biết trường nào của
 * kênh phải đi theo xuống đường gửi.
 *
 * Vì sao phải gom: có BỐN chỗ cần việc này (lượt tin nhắn kênh cá nhân, câu
 * trấn an của kênh bot, đường gửi của scheduler, thông báo chạm trần ngày), và
 * các trường mang theo đều là TÙY CHỌN (`tranKyTuMotTin`, `mangDinhDang`).
 * Tùy chọn nghĩa là quên một cái thì trình biên dịch im lặng, còn hậu quả thì
 * câm: thiếu `tranKyTuMotTin` là kênh bot mất trọn câu trả lời (server chối
 * nguyên tin), thiếu `mangDinhDang` là ngân sách byte tính cả `styles` sắp bị
 * vứt rồi chẻ thừa tin. Cùng lý lẽ mà `duongGuiZcaJs` đã ghi trong docstring
 * của nó - chỉ là ở tầng cao hơn một bậc.
 *
 * KHÔNG đặt `quote` ở đây: chỉ lượt tin nhắn trong nhóm mới có tin để trích,
 * và caller đó tự thêm.
 */
export function replyTargetTuKenh(p: {
  kenh: KenhLuot;
  threadId: string;
  threadType: ThreadType;
  /** Khóa hàng đợi gửi: `${accountId}:${threadId}` */
  threadKey: string;
}): ReplyTarget {
  return {
    guiMotDoan: p.kenh.duongGui(p.threadId, p.threadType),
    tranKyTuMotTin: p.kenh.tranKyTuMotTin,
    mangDinhDang: p.kenh.mangDinhDang,
    threadKey: p.threadKey,
    threadId: p.threadId,
    threadType: p.threadType,
  };
}

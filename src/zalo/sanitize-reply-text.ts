import { DAU_HIEU_RO_PROMPT } from "../agent/prompt-leak-markers.js";
import { isSilentResponse } from "../scheduler/silent-sentinel.js";

/**
 * Lớp làm sạch CUỐI CÙNG trước khi chữ của model xuống Zalo - mảnh còn thiếu
 * trong mô hình phân lớp của OpenAI (lọc đầu vào, chống injection, rủi ro tool
 * đều đã có; guardrail ĐẦU RA thì chưa).
 *
 * Trước module này, `result.text` đi thẳng vào `sendReplyInParts`. Persona có
 * DẶN "không markdown", nhưng dặn không phải bảo đảm - và Zalo không render
 * markdown nên `**đậm**` với `## Tiêu đề` hiện ra nguyên ký tự trước mắt người
 * dùng mỗi ngày.
 *
 * Cố ý KHÔNG làm bộ kiểm duyệt nội dung. Đây là bot cá nhân; chỉ chữa ba thứ
 * ĐO ĐƯỢC, không đoán ý.
 *
 * CỐ Ý BỎ QUA `__đậm__` và `_nghiêng_`: dấu gạch dưới sống đầy trong tên file và
 * URL thật (`bao_gia_2026.pdf`), nên bắt chúng là đổi hỏng dữ liệu thật để chữa
 * một dạng markdown model gần như không dùng khi đã được dặn viết lời thường.
 * Cũng bỏ qua `> trích dẫn` và danh sách đánh số - hai thứ đó đọc vẫn tự nhiên
 * trên Zalo.
 *
 * Module THUẦN: không env, không logger, không DB. `daSua` trả ra ngoài để
 * caller ghi log - sửa chữ của model rồi im lặng là tự bịt mắt mình lúc chẩn
 * đoán.
 */

export type KetQuaLamSach = {
  /** Chữ đã làm sạch. Rỗng khi `chan` - đừng gửi. */
  text: string;
  /** Những thứ đã chỉnh, để log. Rỗng nghĩa là không đụng một ký tự nào. */
  daSua: string[];
  /** Chặn hẳn: câu trả lời rò system prompt, gửi nửa vời còn tệ hơn không gửi. */
  chan: boolean;
};

/**
 * KHỐI code trước INLINE code.
 *
 * Làm ngược lại thì ba dấu nháy của khối bị bộ inline ăn mất hai cái đầu, phần
 * còn lại thành nháy lẻ và nội dung bên trong khối bị cắt loạn.
 *
 * Giữ NỘI DUNG, bỏ hàng rào và nhãn ngôn ngữ (```js).
 */
function boKhoiCode(text: string, daSua: string[]): string {
  const sau = text.replace(/```[^\n`]*\n?([\s\S]*?)```/g, (_, than: string) => than.trim());
  if (sau !== text) daSua.push("khối code");
  return sau;
}

function boInlineCode(text: string, daSua: string[]): string {
  const sau = text.replace(/`([^`\n]+)`/g, "$1");
  if (sau !== text) daSua.push("inline code");
  return sau;
}

/** `# Tiêu đề` -> `Tiêu đề`. Chỉ ở ĐẦU DÒNG, để `#hashtag` giữa câu không bị đụng. */
function boTieuDe(text: string, daSua: string[]): string {
  const sau = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
  if (sau !== text) daSua.push("tiêu đề");
  return sau;
}

/**
 * `[chữ](url)` -> `chữ (url)`. Giữ URL vì đó là thông tin THẬT người dùng cần -
 * bỏ luôn là làm mất nội dung, không phải làm sạch.
 *
 * `![alt](url)` (ảnh) cũng vào đây, dấu `!` bị nuốt cùng.
 */
function boLienKet(text: string, daSua: string[]): string {
  const sau = text.replace(/!?\[([^\]\n]*)\]\(([^)\s]+)[^)]*\)/g, (_, chu: string, url: string) =>
    chu.trim() ? `${chu} (${url})` : url,
  );
  if (sau !== text) daSua.push("liên kết");
  return sau;
}

/**
 * `**đậm**` -> `đậm`. Chạy TRƯỚC phần nghiêng, nếu không thì bộ nghiêng ăn một
 * dấu sao mỗi bên và để lại hai dấu lẻ.
 */
function boDam(text: string, daSua: string[]): string {
  const sau = text.replace(/\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/g, "$1");
  if (sau !== text) daSua.push("in đậm");
  return sau;
}

/**
 * `*nghiêng*` -> `nghiêng`.
 *
 * Hai thứ PHẢI giữ nguyên, và đó là lý do biểu thức khó đọc thế này:
 *
 *   - Gạch đầu dòng `-`: persona đang DẠY bot dùng nó để chia ý. Không đụng tới
 *     (biểu thức này chỉ nhìn dấu sao nên vốn đã an toàn).
 *   - Dấu sao giữa từ, kiểu `2*3*4`: phải ra đúng `2*3*4`. Chặn bằng cách đòi
 *     dấu mở KHÔNG đứng ngay sau ký tự chữ/số - đúng luật "left-flanking" của
 *     CommonMark. Thiếu vế này thì `2*3*4` bị đọc thành `2` + nghiêng(`3`) + `4`
 *     và một phép nhân biến thành `234`.
 *
 * Cũng đòi không có khoảng trắng ngay trong cặp: `a * b * c` là phép tính, không
 * phải chữ nghiêng.
 */
function boNghieng(text: string, daSua: string[]): string {
  const sau = text.replace(/(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, "$1");
  if (sau !== text) daSua.push("in nghiêng");
  return sau;
}

/**
 * Bỏ DÒNG PHÂN CÁCH của bảng markdown (`|---|---:|`).
 *
 * Chỉ bỏ đúng dòng đó, KHÔNG dựng lại cả bảng. Lý do: dòng phân cách là nhiễu
 * thuần túy - không mang một chữ nào - nên bỏ đi là mất trắng; còn các dòng dữ
 * liệu vẫn đọc được dạng "| A | B |", và tự dựng lại bảng thành văn xuôi thì
 * phải đoán đâu là tiêu đề đâu là dữ liệu, đúng kiểu "làm quá" mà phase này
 * tránh.
 *
 * An toàn: chỉ khớp dòng CHỈ gồm gạch đứng, gạch ngang, hai chấm và khoảng
 * trắng, và phải có ít nhất hai gạch ngang liền nhau. Không câu tiếng Việt nào
 * có hình dạng đó.
 */
function boDongPhanCachBang(text: string, daSua: string[]): string {
  const sau = text.replace(/^[ \t]*\|[ \t:|-]*--[ \t:|-]*\|?[ \t]*$\n?/gm, "");
  if (sau !== text) daSua.push("dòng kẻ bảng");
  return sau;
}

/**
 * Bỏ dòng `[SILENT]` lọt vào lượt chat THƯỜNG.
 *
 * Sentinel chỉ có nghĩa ở lượt theo lịch; lọt xuống Zalo là người dùng nhận một
 * nhãn nội bộ không hiểu gì. Dùng lại `isSilentResponse` để nhận biết thay vì
 * viết biểu thức thứ hai - hai bộ nhận dạng cho cùng một token là sớm muộn cũng
 * lệch nhau.
 */
function boSentinel(text: string, daSua: string[]): string {
  if (!isSilentResponse(text)) return text;
  const giuLai = text
    .split(/\r?\n/)
    .filter((dong) => !isSilentResponse(dong))
    .join("\n")
    .trim();
  daSua.push("nhãn [SILENT]");
  return giuLai;
}

/** Câu trả lời có mẩu chữ đặc trưng của system prompt không */
export function coDauHieuRoPrompt(text: string): boolean {
  return DAU_HIEU_RO_PROMPT.some((d) => text.includes(d));
}

/**
 * Làm sạch câu trả lời của model trước khi gửi.
 *
 * Kiểm rò prompt trên chữ GỐC, trước khi bỏ định dạng: bỏ trước rồi kiểm thì
 * một dấu hiệu có markdown xen vào (`**Quy tắc an toàn...`) đã bị đổi hình dạng,
 * và bộ canh trượt đúng ca người ta cố tình lách.
 */
export function lamSachTraLoi(text: string): KetQuaLamSach {
  if (coDauHieuRoPrompt(text)) {
    return { text: "", daSua: ["CHẶN: rò system prompt"], chan: true };
  }

  const daSua: string[] = [];
  let ra = boKhoiCode(text, daSua);
  ra = boInlineCode(ra, daSua);
  ra = boLienKet(ra, daSua);
  ra = boTieuDe(ra, daSua);
  ra = boDam(ra, daSua);
  ra = boNghieng(ra, daSua);
  ra = boDongPhanCachBang(ra, daSua);
  ra = boSentinel(ra, daSua);

  return { text: ra, daSua, chan: false };
}

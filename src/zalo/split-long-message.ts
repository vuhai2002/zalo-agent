/**
 * Cắt câu trả lời dài thành nhiều tin nhắn Zalo.
 *
 * Vì sao cần: Zalo chặn tin quá dài ở PHÍA SERVER (error_code 118 "Nội dung quá
 * dài") - zca-js không kiểm gì, chỉ ném lỗi lên. Trước khi có module này, một
 * câu trả lời dài là mất trắng: tin không gửi được, không vào history, người
 * nhắn không nhận được gì sau khi bot đã đốt cả trăm nghìn token.
 *
 * Nguyên tắc cắt: KHÔNG BAO GIỜ cắt giữa từ, ưu tiên ranh giới tự nhiên từ to
 * xuống nhỏ (đoạn văn -> dòng -> câu -> khoảng trắng). Cắt cứng chỉ dùng khi
 * một "từ" đơn dài hơn cả cửa sổ (URL khổng lồ) - lúc đó không còn lựa chọn.
 *
 * Module thuần (không import env) để test không cần setupTestEnv.
 */

export type SplitOptions = {
  /** Số ký tự tối đa mỗi tin */
  maxChars: number;
  /** Số tin tối đa cho 1 lượt trả lời - bắn quá nhiều tin liên tiếp dễ bị Zalo coi là spam */
  maxParts: number;
};

/**
 * Ghi chú gắn vào đoạn cuối khi câu trả lời vượt trần số đoạn. Nói thật là còn
 * nữa thay vì cắt ngang im lặng để người đọc biết mà hỏi tiếp.
 */
export const OVERFLOW_NOTE = "\n\n(Phần sau còn dài, bạn hỏi tiếp phần cần rõ nhé.)";

/**
 * Chỉ nhận điểm cắt nằm sau ngưỡng này của cửa sổ. Không có ràng buộc đó, một
 * dòng trống ở ký tự thứ 30 sẽ sinh ra đoạn 30 ký tự rồi đoạn 2000 ký tự - cũng
 * là một kiểu cắt vô duyên.
 */
const MIN_FILL_RATIO = 0.5;

/** Kết thúc câu: cắt NGAY SAU dấu để câu không bị mất dấu chấm */
const SENTENCE_END = /[.!?…](?=\s)/g;

/**
 * Vị trí cắt tốt nhất trong `limit` ký tự đầu của text.
 * Trả về index để `text.slice(0, index)` là đoạn giữ lại.
 */
function findCutIndex(text: string, limit: number): number {
  const window = text.slice(0, limit);
  const minIndex = Math.floor(limit * MIN_FILL_RATIO);

  // 1. Dòng trống - ranh giới đoạn văn, giữ nguyên khối ý
  const paragraph = window.lastIndexOf("\n\n");
  if (paragraph >= minIndex) return paragraph;

  // 2. Xuống dòng đơn - giữ nguyên từng gạch đầu dòng của danh sách
  const line = window.lastIndexOf("\n");
  if (line >= minIndex) return line;

  // 3. Hết câu (cắt sau dấu chấm/hỏi/than)
  let sentence = -1;
  for (const match of window.matchAll(SENTENCE_END)) {
    if (match.index >= minIndex) sentence = match.index + 1;
  }
  if (sentence > 0) return sentence;

  // 4. Khoảng trắng - tệ nhất cũng không cắt giữa từ
  const space = window.lastIndexOf(" ");
  if (space > 0) return space;

  // 5. Không có chỗ nào cắt được (1 "từ" dài hơn cả cửa sổ, vd URL) - cắt cứng
  return limit;
}

/**
 * Chia text thành các tin nhắn gửi tuần tự. Text ngắn trả về đúng 1 phần tử,
 * text rỗng trả về mảng rỗng (caller khỏi phải tự kiểm).
 */
export function splitLongMessage(text: string, { maxChars, maxParts }: SplitOptions): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const parts: string[] = [];
  let rest = trimmed;

  while (rest.length > maxChars) {
    // Đã tới đoạn cuối được phép mà vẫn còn dài: cắt kèm ghi chú "còn nữa"
    if (parts.length + 1 >= maxParts) {
      const room = Math.max(1, maxChars - OVERFLOW_NOTE.length);
      const cut = findCutIndex(rest, room);
      parts.push(rest.slice(0, cut).trimEnd() + OVERFLOW_NOTE);
      return parts;
    }

    const cut = findCutIndex(rest, maxChars);
    const chunk = rest.slice(0, cut).trimEnd();
    if (chunk) parts.push(chunk);
    rest = rest.slice(cut).trimStart();
  }

  if (rest) parts.push(rest);
  return parts;
}

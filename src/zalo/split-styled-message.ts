import type { Style } from "zca-js";
import { splitLongMessageWithOffsets, type SplitOptions } from "./split-long-message.js";

/**
 * Cắt tin dài KÈM định dạng.
 *
 * Vì sao phải có module riêng: `Style.start`/`len` tính trên TOÀN VĂN, nên khi
 * một câu trả lời bị chẻ thành nhiều tin Zalo, mọi span từ đoạn 2 trở đi lệch
 * đúng bằng độ dài các đoạn trước - Zalo sẽ tô đậm nhầm chỗ, hoặc bỏ qua span
 * vượt biên. Bản tham chiếu (`zalo-personal`) KHÔNG gặp bài này vì nó cắt cụt ở
 * 4000 ký tự thay vì chẻ nhiều tin.
 *
 * Hai việc phải làm, và việc thứ hai dễ quên: (1) dời mốc về đầu mỗi đoạn,
 * (2) CHẺ ĐÔI span nằm vắt qua chỗ cắt. Bỏ luôn span vắt qua thì mất định dạng;
 * giữ nguyên len thì tràn sang chữ không thuộc về nó.
 *
 * Module THUẦN: không env, không logger, không DB.
 */

export type TinCoDinhDang = { text: string; styles: Style[] };

/**
 * Chia `{text, styles}` thành nhiều tin, mỗi tin có mốc định dạng của RIÊNG nó.
 *
 * Không style thì đi thẳng đường cũ, khỏi tính giao nhau vô ích.
 */
export function splitStyledMessage(
  tin: TinCoDinhDang,
  options: SplitOptions,
): TinCoDinhDang[] {
  const doans = splitLongMessageWithOffsets(tin.text, options);
  if (tin.styles.length === 0) return doans.map((d) => ({ text: d.text, styles: [] }));

  return doans.map((doan) => {
    const het = doan.batDau + doan.phuGoc;
    const styles: Style[] = [];

    for (const s of tin.styles) {
      // Giao của [s.start, s.start+s.len) với [batDau, het)
      const dau = Math.max(s.start, doan.batDau);
      const cuoi = Math.min(s.start + s.len, het);
      if (cuoi <= dau) continue; // không dính đoạn này

      // `trimEnd`/`trimStart` ở chỗ cắt XÓA ký tự, nên `phuGoc` có thể ngắn hơn
      // khoảng đã tiêu. Kẹp lần nữa vào độ dài chữ thật để không bao giờ phát ra
      // span vượt biên - zca-js gói thẳng số này vào JSON, không ai kiểm hộ.
      const start = dau - doan.batDau;
      const len = Math.min(cuoi - dau, doan.text.length - start);
      if (len <= 0) continue;

      styles.push({ ...s, start, len });
    }

    return { text: doan.text, styles };
  });
}

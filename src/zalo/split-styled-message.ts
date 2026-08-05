import type { Style } from "zca-js";
import { OVERFLOW_NOTE, splitLongMessageWithOffsets, type SplitOptions } from "./split-long-message.js";

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

export type TinCoDinhDang = {
  text: string;
  styles: Style[];
  /**
   * Đoạn này bị BỎ định dạng vì quá nặng so với trần byte.
   *
   * Phải có cờ riêng, KHÔNG suy ra từ `styles.length === 0`: một đoạn vốn không
   * có chữ nào cần tô thì cũng rỗng, mà đó là chuyện bình thường. Bản đầu suy
   * ra từ độ dài và đã báo động giả ngay lượt chạy thật đầu tiên - đoạn cuối
   * của câu trả lời chỉ là văn xuôi nên không có span nào.
   */
  boDinhDang?: true;
};

/**
 * Số byte một tin sẽ chiếm trên đường dây: chữ (UTF-8) cộng JSON định dạng.
 *
 * Đây là con số Zalo thật sự đo, không phải số ký tự - đã đo được bằng cách
 * gửi thật (xem `chiaTheoNganSachByte`). Dựng đúng hình dạng zca-js gửi đi:
 * `textProperties: JSON.stringify({ styles })`.
 */
export function soByteTin(tin: TinCoDinhDang): number {
  const chu = Buffer.byteLength(tin.text, "utf8");
  if (tin.styles.length === 0) return chu;
  return chu + Buffer.byteLength(JSON.stringify({ styles: tin.styles }), "utf8");
}

/**
 * Số đoạn THẬT SỰ bị bỏ định dạng - để nơi gửi kêu lên.
 *
 * Là hàm riêng chứ không phải một dòng `filter` ở nơi gửi, vì đây đúng là chỗ
 * đã báo động giả: bản đầu đếm `styles.length === 0` và kêu ngay lượt chạy thật
 * đầu tiên, trong khi đoạn cuối chỉ là văn xuôi nên vốn không có span nào.
 * Tách ra thì phép phá code chạm được vào nó.
 */
export function demDoanBoDinhDang(phan: TinCoDinhDang[]): number {
  return phan.filter((p) => p.boDinhDang).length;
}

/** Cắt nhỏ tối đa - dưới mức này thì tin vụn tới mức khó đọc, thà bỏ định dạng */
const KY_TU_TOI_THIEU = 400;

/**
 * Bộ tin này có bị VỨT BỚT chữ không?
 *
 * Dấu hiệu duy nhất đáng tin là ghi chú "còn nữa" - `splitLongMessage` chỉ dán
 * nó khi phải bỏ chữ vì hết chỗ. KHÔNG đo bằng cách so tổng số ký tự giữa hai
 * lần cắt: cắt mịn hơn thì `trimEnd` ở mỗi ranh giới ăn thêm vài ký tự trắng
 * (đo thật: 2167 -> 2165 -> 2163 -> 2159), nên phép so đó luôn báo "mất chữ"
 * và vòng co thoát ngay từ bước đầu.
 */
function biVutBotChu(phan: TinCoDinhDang[]): boolean {
  return phan.at(-1)?.text.endsWith(OVERFLOW_NOTE) ?? false;
}

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

/**
 * Chia sao cho MỖI TIN nằm dưới ngân sách byte của Zalo.
 *
 * VÌ SAO CÓ HÀM NÀY - đo thật ngày 2026-08-05 bằng cách gửi vào Zalo:
 *
 * | byte chữ + byte style | kết quả |
 * |---|---|
 * | 1642 + 572 = 2214 | được |
 * | 2321 + 0 = 2321 | được |
 * | 320 + 2412 = 2732 | được |
 * | 2321 + 546 = 2867 | được |
 * | 2321 + 1391 = 3712 | HỎNG (mã 112) |
 * | 2321 + 1580 = 3901 | HỎNG (mã 112) |
 *
 * Hai dòng cuối dùng ĐÚNG đoạn chữ của dòng 2321+0 - khác mỗi chỗ có style. Nên
 * trần không nằm ở độ dài chữ (1600 ký tự kèm style vẫn gửi được), không nằm ở
 * số span (80 span vẫn gửi được), không nằm ở số dòng (1/30/60 dòng đều được),
 * mà ở TỔNG hai thứ cộng lại. Đã dò nhầm hướng ba vòng trước khi thấy.
 *
 * Cách chữa là cắt NHỎ HƠN chứ không phải bỏ định dạng: người dùng nhận thêm
 * một tin thì vẫn đọc được, còn mất định dạng thì mất đúng thứ vừa làm ra.
 * Chỉ khi co hết cỡ mà vẫn vượt (tin dày đặc span bất thường) mới bỏ định dạng
 * của riêng đoạn đó - vẫn còn `sendOneCoDuongLui` đỡ phía sau.
 */
export function chiaTheoNganSachByte(
  tin: TinCoDinhDang,
  options: SplitOptions & { maxPayloadBytes: number },
): TinCoDinhDang[] {
  const { maxPayloadBytes, ...cat } = options;
  let phan = splitStyledMessage(tin, cat);
  if (tin.styles.length === 0) return phan;

  // Co dần trần ký tự cho tới khi mọi tin lọt ngân sách.
  //
  // Bước co 10% chứ không phải 30%: mỗi lần co quá tay là THÊM một tin người
  // dùng phải đọc. Đo trên tin thật - ở mức 980 ký tự tin chỉ vượt trần đúng 50
  // byte, mà bước 30% nhảy thẳng xuống 686 và đẻ ra tin thứ ba không cần thiết.
  // Vòng lặp chỉ là phép cắt chuỗi trên vài nghìn ký tự nên chạy thêm chục vòng
  // không đáng kể so với một lượt gọi API.
  let kyTu = cat.maxChars;
  while (phan.some((p) => soByteTin(p) > maxPayloadBytes) && kyTu > KY_TU_TOI_THIEU) {
    kyTu = Math.max(KY_TU_TOI_THIEU, Math.floor(kyTu * 0.9));
    const thu = splitStyledMessage(tin, { ...cat, maxChars: kyTu });

    // DỪNG khi co tiếp làm MẤT CHỮ - đo thẳng số chữ giao được, không đo số tin.
    // Bản đầu chặn bằng `thu.length >= maxParts` và đó là đo sai đại lượng:
    // chạm đúng trần số tin KHÔNG phải mất chữ (`splitLongMessage` chỉ cắt bớt
    // khi cần NHIỀU HƠN maxParts). Hậu quả đo được trên tin thật: ở bước co
    // 685 ký tự bộ cắt cho ra 5 tin, mọi tin đều dưới trần và không hụt chữ -
    // vậy mà chốt chặn nổ, vứt kết quả tốt, giữ bản 3 tin có một tin 3754 byte
    // rồi bỏ định dạng của tin đó. Người dùng nhận tin đầu phẳng lì.
    if (biVutBotChu(thu)) break;
    phan = thu;
  }

  // Đoạn nào vẫn quá khổ thì bỏ định dạng của riêng nó, giữ nguyên chữ. Đánh
  // dấu `boDinhDang` để nơi gửi phân biệt được với đoạn vốn không có gì để tô.
  return phan.map((p) =>
    soByteTin(p) > maxPayloadBytes ? { text: p.text, styles: [], boDinhDang: true as const } : p,
  );
}

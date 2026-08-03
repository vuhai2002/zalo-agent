/**
 * Con trỏ phân trang cho trang Logs.
 *
 * Dòng log KHÔNG có id - chỉ có mốc thời gian `time` (ms). Mà pino ghi nhiều
 * dòng trong CÙNG một mili giây lúc bot bận: một lượt agent bắn ra cả cụm dòng
 * dính nhau. Nên con trỏ chỉ mang `time` là hỏng theo một trong hai kiểu, tùy
 * mình so sánh thế nào:
 *
 *   - lấy `time < mốc`  -> RƠI MẤT mọi dòng cùng mili giây với dòng cuối trang
 *   - lấy `time <= mốc` -> LẶP LẠI chính những dòng đó ở trang sau
 *
 * Cả hai đều tệ, và tệ đúng vào lúc đáng đọc nhất (lúc bot đang bận). Nên con
 * trỏ mang thêm `daLay`: đã lấy bao nhiêu dòng có ĐÚNG mốc đó. Trang sau bỏ qua
 * đúng bấy nhiêu rồi lấy tiếp - không sót, không lặp.
 *
 * Dạng chuỗi `<time>.<daLay>` để đi được qua query string mà không cần mã hóa.
 *
 * Module thuần, không import gì.
 */

export type ConTroLog = {
  /** Mốc thời gian (ms) của dòng cuối trang trước */
  time: number;
  /** Số dòng có đúng mốc `time` đó đã trả ở các trang trước */
  daLay: number;
};

export function doiConTroThanhChuoi(c: ConTroLog): string {
  return `${c.time}.${c.daLay}`;
}

/**
 * Đọc con trỏ từ query string. Trả `null` khi chuỗi hỏng.
 *
 * Con trỏ hỏng KHÔNG được rơi về trang đầu - đó là cách client nối thêm bản sao
 * vô tận mà không ai nhận ra (Hermes ghi rõ luật này ở `list_sessions`:
 * "Unknown cursor -> empty page, do not fall back to full list"). Caller nhận
 * `null` thì phải trả trang RỖNG, không phải trang đầu.
 */
export function docConTro(raw: string | undefined): ConTroLog | null {
  if (!raw) return null;
  // CHỈ nhận chuỗi toàn chữ số hai bên dấu chấm - đúng dạng mình tự sinh ra.
  //
  // Không dùng `Number()` rồi kiểm `Number.isInteger`: `Number("")` trả về 0
  // chứ không phải NaN, nên con trỏ cụt đuôi ("1700000000000.") lọt qua thành
  // `daLay: 0` và trang sau trả LẶP nguyên cụm dòng cùng mili giây. Test bắt
  // được đúng ca này.
  const khop = /^(\d+)\.(\d+)$/.exec(raw);
  if (!khop) return null;
  const time = Number(khop[1]);
  const daLay = Number(khop[2]);
  // Vượt số nguyên an toàn thì phép so sánh mốc thời gian hết đáng tin
  if (!Number.isSafeInteger(time) || time <= 0) return null;
  if (!Number.isSafeInteger(daLay)) return null;
  return { time, daLay };
}

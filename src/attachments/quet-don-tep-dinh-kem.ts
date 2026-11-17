import { createLogger } from "../shared/logger.js";
import { xoaCacheHetHan, xoaTepHetHan } from "./attachment-store.js";

/**
 * Vòng quét dọn tệp đính kèm MỖI GIỜ (cache chữ có hạn trượt tính theo giờ,
 * dọn mỗi ngày là giữ chữ sao kê lâu hơn hứa tới gần một ngày). Đọc tệp đã hết
 * hạn giữa hai lần quét vẫn bị chặn ở tầng đọc (`layTepGanDay` lọc `xoa_luc`,
 * `layNoiDungTep` kiểm `cache_het_han`) - vòng quét chỉ là việc xóa thật.
 */

const log = createLogger("quet-don-tep-dinh-kem");
const MOT_GIO_MS = 60 * 60 * 1000;

export function quetDonMotLuot(now: Date): void {
  try {
    const tep = xoaTepHetHan(now);
    const cache = xoaCacheHetHan(now);
    if (tep + cache > 0) log.info({ tep, cache }, "Đã dọn tệp đính kèm hết hạn");
  } catch (err) {
    log.error({ err }, "Dọn tệp đính kèm lỗi - thử lại ở lượt sau");
  }
}

/** Chạy ngay một lượt rồi mỗi giờ. Trả hàm dừng cho shutdown. */
export function startQuetDonTepDinhKem(): () => void {
  quetDonMotLuot(new Date());
  const timer = setInterval(() => quetDonMotLuot(new Date()), MOT_GIO_MS);
  timer.unref();
  return () => clearInterval(timer);
}

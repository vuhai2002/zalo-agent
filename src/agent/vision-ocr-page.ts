import { getVisionSettings, isSidecarConfigured } from "../config/runtime-vision-settings.js";
import { createLogger } from "../shared/logger.js";
import { defaultCaller, type SidecarCaller, type SidecarImage, type SidecarResult } from "./vision-sidecar.js";

/**
 * Chép chữ MỘT trang tài liệu quét bằng model đọc ảnh (sidecar) - phần OCR của
 * tool đọc tệp đính kèm.
 *
 * Khác mô tả ảnh (`describeImage`): prompt ép CHÉP chứ không TẢ, và trần output
 * riêng - sao kê/bảng dày chữ vượt 2048 token của mô tả ảnh. Không cache ở đây
 * (cache theo trang nằm ở kho tệp đính kèm). Gửi PDF thẳng cho model không
 * được: 9Router biến part `file` thành chữ JSON trên đường model `cx/*`.
 *
 * Không bao giờ ném: lỗi/chưa cấu hình trả null để caller báo "chưa chép được
 * trang này" thay vì hỏng cả tệp. Không log nội dung trang (dữ liệu nhạy cảm).
 */

const log = createLogger("vision-ocr-page");

export const PROMPT_CHEP_CHU_TRANG =
  "Chép lại NGUYÊN VĂN toàn bộ chữ trong ảnh trang tài liệu này, theo đúng thứ tự đọc. " +
  "Giữ nguyên ngôn ngữ gốc, KHÔNG dịch, KHÔNG tóm tắt, KHÔNG thêm lời bình. " +
  'Bảng thì chép thành từng dòng, các ô cách nhau bằng " | ". ' +
  "Chữ không đọc được thì ghi [không rõ]. Trang không có chữ thì trả đúng một dòng: [trang trống]";

export async function chepChuTrang(
  anh: SidecarImage,
  p: { maxOutputTokens: number; hanMs: number },
  call: SidecarCaller = defaultCaller,
): Promise<SidecarResult | null> {
  const settings = getVisionSettings();
  if (!isSidecarConfigured(settings)) return null;
  try {
    // Hủy hẳn luồng khi quá hạn (không chỉ bỏ chờ): sidecar treo không được giữ
    // cả loạt OCR tới 50 trang
    const kq = await call(settings.sidecar, anh, PROMPT_CHEP_CHU_TRANG, p.maxOutputTokens, AbortSignal.timeout(p.hanMs));
    log.info({ model: settings.sidecar.model, chars: kq.text.length, truncated: kq.truncated }, "Sidecar đã chép chữ một trang");
    return kq;
  } catch (err) {
    log.warn({ err }, "Sidecar chép chữ trang thất bại - bỏ qua trang này");
    return null;
  }
}

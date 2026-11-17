import { chepChuTrang } from "../agent/vision-ocr-page.js";
import { getTuning } from "../config/runtime-tuning-settings.js";
import { isSidecarConfigured } from "../config/runtime-vision-settings.js";
import type { TranTienTrinhCon } from "../shared/chay-tien-trinh-con-co-tran.js";
import { createHourlyRateLimit } from "../shared/hourly-rate-limit.js";
import { createLogger } from "../shared/logger.js";
import { layTep } from "./attachment-store.js";
import { taoGioiHanLuotTai } from "./gioi-han-luot-tai-tep.js";
import { layNoiDungTep, type PhuThuocLayTep } from "./lay-noi-dung-tep.js";
import { ocrCacTrang } from "./ocr-cac-trang.js";
import { taiTepZalo } from "./tai-tep-zalo.js";
import { renderTrangCanOcr, trichXuatTep } from "./trich-xuat-tep.js";

/**
 * Nối `layNoiDungTep` với cấu hình THẬT (trang Cấu hình > Tệp người dùng gửi)
 * và tiến trình con thật. Đọc `getTuning` mỗi lần gọi - đổi trên dashboard ăn
 * ngay, không cần khởi động lại.
 */

const log = createLogger("tep-dinh-kem");

const gioiHanTep = createHourlyRateLimit({
  limit: () => getTuning("ATTACHMENT_MAX_FILES_PER_HOUR"),
  buildReason: ({ used, waitMinutes }) => `Đã đọc ${used} tệp mới trong 1 giờ qua, thử lại sau ${waitMinutes} phút`,
});
const gioiHanTrangOcr = createHourlyRateLimit({
  limit: () => getTuning("ATTACHMENT_OCR_MAX_PAGES_PER_HOUR"),
  buildReason: ({ used, waitMinutes }) => `Đã chép ${used} trang quét trong 1 giờ qua, thử lại sau ${waitMinutes} phút`,
});

/**
 * Cố định, không lên dashboard - cùng lý do hàng đợi trích xuất cố định 1:
 * 2 tệp x 20 MB (+ bản sao qua IPC) là phần RAM tiến trình cha dành cho việc
 * này trong container 768 MB. Xem `gioi-han-luot-tai-tep.ts`.
 */
const luotTai = taoGioiHanLuotTai({ toiDa: 2, toiDaMoiKey: 1 });

let daCanhBaoProc = false;
function canhBaoKhongDoDuocRss(): void {
  if (daCanhBaoProc) return;
  daCanhBaoProc = true;
  log.warn("Không đọc được /proc của tiến trình đọc tệp - trần RSS lùi về số tự báo, tệp bom có thể lọt");
}

/** Trần tiến trình con: heap dùng chung trần của Kho tri thức, RSS dùng chung `EXTRACT_MAX_RSS_MB` */
const tranCon = (): TranTienTrinhCon => ({
  hanMs: getTuning("ATTACHMENT_EXTRACT_TIMEOUT_MS"),
  tranRssMb: getTuning("EXTRACT_MAX_RSS_MB"),
  tranHeapMb: getTuning("KB_EXTRACT_MAX_RAM_MB"),
});

export function taoPhuThuocLayTep(): PhuThuocLayTep {
  return {
    taiTep: (href, maxBytes, duoiKhai) => taiTepZalo(href, maxBytes, undefined, duoiKhai),
    lyDoKhongOcr: (nguoiGuiKey) =>
      !isSidecarConfigured() ? "chua-cau-hinh" : gioiHanTrangOcr.conSuat(nguoiGuiKey) ? null : "het-tran-gio",
    trichXuat: (buf, duoiKhai) =>
      trichXuatTep(buf, {
        duoiKhai,
        tranKyTu: getTuning("ATTACHMENT_EXTRACT_MAX_CHARS"),
        tranTrangPdf: getTuning("ATTACHMENT_PDF_MAX_PAGES"),
        tran: tranCon(),
        baoKhongDoDuocRss: canhBaoKhongDoDuocRss,
      }),
    ocr: (buf, soTrang, nguoiGuiKey) =>
      ocrCacTrang(buf, soTrang, nguoiGuiKey, {
        sidecarSanSang: () => isSidecarConfigured(),
        render: (b, so) => renderTrangCanOcr(b, so, tranCon(), canhBaoKhongDoDuocRss),
        chep: (anh) =>
          chepChuTrang(anh, {
            maxOutputTokens: getTuning("ATTACHMENT_OCR_MAX_OUTPUT_TOKENS"),
            hanMs: getTuning("ATTACHMENT_OCR_PAGE_TIMEOUT_MS"),
          }),
        gioiHan: gioiHanTrangOcr,
        songSong: getTuning("ATTACHMENT_OCR_CONCURRENCY"),
      }),
    gioiHanTep,
    giuLuotTai: (key) => luotTai.giu(key),
    cauHinh: () => ({
      maxMb: getTuning("ATTACHMENT_MAX_MB"),
      officeMaxMb: getTuning("ATTACHMENT_OFFICE_MAX_MB"),
      ocrSanTrang: getTuning("ATTACHMENT_OCR_PREFETCH_PAGES"),
      ocrToiDaMoiTep: getTuning("ATTACHMENT_OCR_MAX_PAGES_PER_FILE"),
    }),
  };
}

/**
 * Tải + trích (+ OCR sẵn vài trang) ngay lúc nhận tin GỌI bot, chạy nền, để
 * lời gọi tool đầu tiên nhanh. Đặt trong object để test router thay được mà
 * không chạm mạng. Chỉ log metadata - không tên tệp, không link, không chữ.
 */
export const napSan = {
  chay(tepId: number, nguoiGuiKey: string): void {
    const t = layTep(tepId);
    if (!t) return;
    void layNoiDungTep(t, { nguoiGuiKey, now: new Date(), deps: taoPhuThuocLayTep() })
      .then((kq) => log.info({ tepId, ok: kq.ok, ...(kq.ok ? {} : { ma: kq.ma }) }, "Đã nạp sẵn tệp đính kèm"))
      .catch((err) => log.warn({ tepId, err }, "Nạp sẵn tệp đính kèm lỗi"));
  },
};

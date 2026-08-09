import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../config/env.js";
import { getTuning } from "../config/runtime-tuning-settings.js";
import { createLogger } from "../shared/logger.js";
import { LoiTrichXuatBiNgatGiuaChung, trichXuatTachLuong } from "./chay-trich-xuat-tach-luong.js";
import { laDinhDangHoTro, type DinhDangKb } from "./doc-text-extract.js";
import { donDoanMoCoi } from "./don-doan-mo-coi.js";
import { luuDoan } from "./kb-chunk-store.js";
import { giaNguonChoXuLy, layNguonTheoTrangThai, type KbSourceTomTat } from "./kb-source-queries.js";
import { datTrangThai, layNguon } from "./kb-source-store.js";

/**
 * Vòng xử lý nền của Kho tri thức: đọc chữ từ nguồn `cho_xu_ly` -> cắt đoạn ->
 * lưu -> `san_sang`. CHẠY NỀN, không nằm trong request upload - đọc PDF 200
 * trang ngay trong handler là chặn cả bot (không nhận tin, không chạy lượt
 * nào).
 *
 * Trích xuất + cắt đoạn chạy trong `node:worker_threads` (xem
 * `chay-trich-xuat-tach-luong.ts`) - file NÀY chỉ giành nguồn, gọi worker, rồi
 * GHI DB (luồng chính là nơi DUY NHẤT mở SQLite, bất biến "một connection cho
 * cả process").
 */

const log = createLogger("kb-ingest-worker");

// Quét mỗi 5s: bảng kb_sources rất nhỏ nên quét dày không tốn gì đáng kể, chỉ
// ảnh hưởng độ trễ tối đa trước khi một nguồn vừa upload được nhặt lên xử lý.
// Không đưa vào tuning-definitions.ts (không phải thứ người vận hành cần chỉnh
// nóng, khác SCHEDULER_TICK_MS vốn ảnh hưởng trực tiếp độ trễ gửi tin cho khách).
const TICK_MS = 5000;

async function xuLyMotNguon(n: KbSourceTomTat): Promise<void> {
  try {
    // Giành CÓ ĐIỀU KIỆN (so sánh-rồi-đổi nguyên tử, kèm tăng so_lan_thu) - xem
    // giaNguonChoXuLy(). Giành thất bại (trả false) thì BỎ QUA hẳn, không xử
    // lý tiếp: nguồn đã bị vòng khác giành/xử lý xong, hoặc đã hết lượt thử.
    //
    // NẰM TRONG try (I8) - KHÔNG được đặt trước try: giaNguonChoXuLy là một
    // câu UPDATE thật, có thể NÉM vì lý do SQL (không phải "giành thất bại"
    // bình thường). Ném ở ngoài try thì thoát thẳng khỏi `await
    // xuLyMotNguon(n)` trong vòng for của xuLyMotVong(), làm CẢ VÒNG quét bỏ
    // dở - các nguồn xử lý SAU nguồn lỗi không bao giờ được xét tới.
    const tranLanThu = getTuning("KB_MAX_INGEST_ATTEMPTS");
    if (!giaNguonChoXuLy(n.id, tranLanThu)) return;

    let buf: Buffer;
    let dinhDang: DinhDangKb;
    if (n.loai === "text") {
      // noi_dung_goc CHỈ đọc lại SAU KHI giành, cho ĐÚNG MỘT nguồn tại một
      // thời điểm - danh sách "cho_xu_ly" (layNguonTheoTrangThai) KHÔNG kéo
      // cột này (I5: 8 nguồn x 5 triệu ký tự = +30 MB một lần gọi nếu snapshot
      // kéo toàn văn MỌI nguồn đang chờ vào RAM cùng lúc).
      const day = layNguon(n.id);
      if (!day) return; // đã bị xóa giữa lúc giành và lúc đọc lại - hiếm nhưng an toàn
      buf = Buffer.from(day.noiDungGoc, "utf-8");
      dinhDang = "txt"; // nội dung gõ tay đã là chữ thuần, đúng ngữ nghĩa "txt" của docChuTuFile
    } else {
      if (!laDinhDangHoTro(n.dinhDang)) {
        throw new Error(`Định dạng "${n.dinhDang}" chưa được hỗ trợ`);
      }
      buf = fs.readFileSync(path.join(dataDir, n.duongDan));
      dinhDang = n.dinhDang;
    }

    const { doan } = await trichXuatTachLuong({
      buf,
      dinhDang,
      thamSoCat: { coDoanToiDa: getTuning("KB_CHUNK_CHARS"), chongLan: getTuning("KB_CHUNK_OVERLAP_PERCENT") },
      hanMs: getTuning("KB_EXTRACT_TIMEOUT_MS"),
    });

    // I4: DELETE có thể xen vào ĐÚNG lúc worker đang await trích xuất - nguồn
    // không còn thì KHÔNG ghi đoạn (đoạn mồ côi vĩnh viễn nếu ghi, không đường
    // dọn nào khác ngoài donDoanMoCoi() chạy lúc boot).
    if (!layNguon(n.id)) return;

    // I7: trích xuất RA CHỮ không đồng nghĩa với CẮT ĐƯỢC ĐOẠN - tài liệu chỉ
    // toàn tiêu đề (không thân bài) hoặc file .txt/.md rỗng vẫn trả chữ hợp lệ
    // (không rỗng hoặc không ném ở extractor) nhưng catThanhDoan() ra mảng
    // RỖNG. Không chặn ở đây thì nguồn thành "Sẵn sàng, 0 đoạn" - kb_search
    // không bao giờ trả gì cho nguồn này mà không ai biết vì sao. Ném ở đây để
    // rơi vào nhánh "lỗi trích xuất THƯỜNG" bên dưới (đánh hong ngay, không
    // chờ hết so_lan_thu - nội dung rỗng thì thử lại bao nhiêu lần cũng vậy).
    if (doan.length === 0) {
      throw new Error("Tài liệu không có nội dung để cắt đoạn (có thể chỉ chứa tiêu đề hoặc trống)");
    }

    luuDoan(n.id, doan);
    // Vừa xử lý XONG - cấp lại budget lượt thử mới, đúng lý do reset ở
    // datTrangThai(): so_lan_thu không tự lùi theo trạng thái, phải truyền
    // tường minh.
    datTrangThai(n.id, "san_sang", { soDoan: doan.length, soLanThu: 0 });
  } catch (err) {
    if (err instanceof LoiTrichXuatBiNgatGiuaChung) {
      // Worker bị buộc dừng (quá hạn hoặc chết bất thường) - KHÔNG BIẾT tài
      // liệu hỏng thật hay chỉ máy chậm/OOM thoáng qua, nên KHÔNG đánh "hong"
      // ngay: để nguyên "dang_xu_ly" (đã đặt bởi giaNguonChoXuLy), chờ
      // goNguonKetLucKhoiDong() (đọc so_lan_thu, gọi lúc khởi động lại) quyết
      // định thử lại hay bỏ hẳn.
      log.warn({ sourceId: n.id, loi: err.message }, "Worker trích xuất Kho tri thức bị dừng giữa chừng");
      return;
    }
    // Lỗi trích xuất THƯỜNG (file hỏng, định dạng lạ, không đọc ra chữ nào) -
    // đánh "hong" NGAY, không chờ hết so_lan_thu: nội dung hỏng thì thử lại
    // bao nhiêu lần cũng vẫn hỏng, giữ nguyên hành vi trước phase này.
    const loi = err instanceof Error ? err.message : String(err);
    log.warn({ sourceId: n.id, loi }, "Xử lý nguồn Kho tri thức thất bại");
    datTrangThai(n.id, "hong", { loi });
  }
}

/** Xử lý mọi nguồn đang `cho_xu_ly`; một nguồn hỏng không dừng vòng. */
export async function xuLyMotVong(): Promise<void> {
  const dangCho = layNguonTheoTrangThai("cho_xu_ly");
  for (const n of dangCho) {
    await xuLyMotNguon(n);
    // Nhả event loop giữa MỖI nguồn - xem lịch sử đo ở phase trước: trích xuất
    // giờ chạy trong worker thread riêng (không còn chặn luồng chính khi CPU
    // nặng), nhưng bước giành/đọc file/ghi DB vẫn đồng bộ trên luồng chính, và
    // nhả giữa từng nguồn vẫn rẻ.
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * Gọi ĐẦU MỖI TICK (qua `chayMotVongAnToan()` bên dưới), KHÔNG chỉ lúc boot:
 * mọi `dang_xu_ly` sót lại - từ lần khởi động trước (worker bị giết giữa
 * chừng) HOẶC từ chính tick liền trước (worker bị `terminate()` vì quá hạn -
 * catch trong `xuLyMotNguon` cố ý ĐỂ NGUYÊN `dang_xu_ly`) - được xét theo
 * `so_lan_thu`: còn dưới trần thì về `cho_xu_ly` để tick kế tiếp thử lại; đã
 * chạm trần thì đi thẳng sang `hong` - không thử lại VÔ HẠN (C3).
 *
 * TRƯỚC bản sửa chỉ gọi lúc boot: nguồn quá hạn SAU boot kẹt `dang_xu_ly`
 * VĨNH VIỄN (route reindex từ chối 409 mọi `dang_xu_ly` - chỉ còn đường xóa
 * nguồn hoặc restart bot). Gọi lại mỗi tick làm 409 đó thành TẠM THỜI: chờ
 * tối đa một `TICK_MS` là nguồn tự thoát `dang_xu_ly`.
 */
export function goNguonKetLucKhoiDong(): void {
  const tranLanThu = getTuning("KB_MAX_INGEST_ATTEMPTS");
  for (const n of layNguonTheoTrangThai("dang_xu_ly")) {
    if (n.soLanThu >= tranLanThu) {
      datTrangThai(n.id, "hong", {
        loi: `Nguồn này làm worker treo hoặc dừng bất thường liên tiếp - đã thử ${n.soLanThu} lần, dừng xử lý.`,
      });
    } else {
      datTrangThai(n.id, "cho_xu_ly");
    }
  }
}

// Chặn hai vòng interval chồng lên nhau: nguồn lớn (PDF vài trăm trang) có
// thể xử lý lâu hơn TICK_MS, tick sau bắn vào lúc vòng trước còn dở thì bỏ
// qua - giành có điều kiện ở trên đã đủ AN TOÀN dù thiếu cờ này (không xử lý
// trùng một nguồn), nhưng thiếu cờ thì vẫn tốn công quét trùng lặp mỗi 5s.
// CÙNG cờ này còn đảm bảo goNguonKetLucKhoiDong() (gọi ngay dưới) KHÔNG BAO
// GIỜ chạy trong lúc nguồn khác đang THẬT SỰ được xử lý ở CHÍNH tick hiện tại
// (tick mới chỉ bắt đầu sau khi tick trước đã hoàn toàn xong) - chỉ gỡ đúng
// nguồn kẹt lại TỪ tick/lần khởi động trước.
let dangChayVong = false;

/**
 * Một tick đầy đủ: gỡ nguồn kẹt `dang_xu_ly` từ tick/lần khởi động TRƯỚC rồi
 * mới xử lý nguồn `cho_xu_ly` - export để test gọi trực tiếp, không phải chờ
 * `TICK_MS` thật qua `setInterval`.
 */
export async function chayMotVongAnToan(): Promise<void> {
  if (dangChayVong) return;
  dangChayVong = true;
  try {
    goNguonKetLucKhoiDong();
    await xuLyMotVong();
  } finally {
    dangChayVong = false;
  }
}

/** Gọi một lần lúc boot. Trả hàm dừng, mẫu `scheduler-loop.ts`. */
export function batDauWorker(): () => void {
  const { soDoan, soHangFts } = donDoanMoCoi();
  if (soDoan > 0) {
    log.info({ soDoan, soHangFts }, "Đã dọn đoạn/hàng FTS mồ côi (nguồn gốc đã bị xóa) lúc khởi động");
  }
  // Chạy NGAY, không đợi hết TICK_MS đầu tiên - nguồn upload lúc bot vừa khởi
  // động lại không phải chờ oan một nhịp quét. Lượt đầu tiên này CŨNG gỡ mọi
  // dang_xu_ly kẹt từ lần chạy trước (chayMotVongAnToan tự gọi
  // goNguonKetLucKhoiDong()) - các tick SAU tiếp tục gọi lại, không chỉ riêng
  // lượt boot này.
  void chayMotVongAnToan();
  const timer = setInterval(() => void chayMotVongAnToan(), TICK_MS);
  timer.unref();
  return () => clearInterval(timer);
}

import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../config/env.js";
import { getTuning } from "../config/runtime-tuning-settings.js";
import { createLogger } from "../shared/logger.js";
import { catThanhDoan } from "./chunk-text.js";
import { docChuTuFile, laDinhDangHoTro } from "./doc-text-extract.js";
import { luuDoan } from "./kb-chunk-store.js";
import { giaNguonChoXuLy, layNguonTheoTrangThai } from "./kb-source-queries.js";
import { datTrangThai, type KbSource } from "./kb-source-store.js";

/**
 * Vòng xử lý nền của Kho tri thức: đọc chữ từ nguồn `cho_xu_ly` -> cắt đoạn ->
 * lưu -> `san_sang`. CHẠY NỀN, không nằm trong request upload - `node:sqlite`
 * đồng bộ trong tiến trình một luồng nên đọc PDF 200 trang ngay trong handler
 * là chặn cả bot (không nhận tin, không chạy lượt nào).
 */

const log = createLogger("kb-ingest-worker");

// Quét mỗi 5s: bảng kb_sources rất nhỏ nên quét dày không tốn gì đáng kể, chỉ
// ảnh hưởng độ trễ tối đa trước khi một nguồn vừa upload được nhặt lên xử lý.
// Không đưa vào tuning-definitions.ts (không phải thứ người vận hành cần chỉnh
// nóng, khác SCHEDULER_TICK_MS vốn ảnh hưởng trực tiếp độ trễ gửi tin cho khách).
const TICK_MS = 5000;

async function xuLyMotNguon(n: KbSource): Promise<void> {
  // Giành CÓ ĐIỀU KIỆN (so sánh-rồi-đổi nguyên tử) - không dùng datTrangThai
  // (UPDATE vô điều kiện) ở đây: hai vòng xuLyMotVong() có thể chồng lấn thời
  // gian thật (vòng này đang await đọc file lớn thì tick 5s sau đã bắn tiếp),
  // nên `n` có thể tới từ một SNAPSHOT CŨ mà nguồn đã bị vòng khác giành/xử lý
  // xong. Giành thất bại thì BỎ QUA hẳn, không xử lý tiếp - xem giaNguonChoXuLy().
  if (!giaNguonChoXuLy(n.id)) return;
  try {
    let chu: string;
    if (n.loai === "text") {
      chu = n.noiDungGoc;
    } else {
      if (!laDinhDangHoTro(n.dinhDang)) {
        throw new Error(`Định dạng "${n.dinhDang}" chưa được hỗ trợ`);
      }
      const buf = fs.readFileSync(path.join(dataDir, n.duongDan));
      chu = await docChuTuFile(buf, n.dinhDang);
    }

    const doan = catThanhDoan(chu, {
      coDoanToiDa: getTuning("KB_CHUNK_CHARS"),
      chongLan: getTuning("KB_CHUNK_OVERLAP_PERCENT"),
    });
    luuDoan(n.id, doan);
    datTrangThai(n.id, "san_sang", { soDoan: doan.length });
  } catch (err) {
    // Một nguồn hỏng (file lỗi, định dạng lạ) không được kéo cả vòng chết theo -
    // try/catch bọc TỪNG nguồn, không bọc cả vòng `xuLyMotVong`.
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
    // Nhả event loop giữa MỖI nguồn: `xuLyMotNguon` đọc/cắt/lưu đều đồng bộ
    // (node:sqlite đồng bộ, `catThanhDoan`/regex extractor đều đồng bộ), nhánh
    // "text" (gõ tay) còn không có await THẬT nào bên trong - cả vòng chạy
    // liền MỘT khối JS, chặn luôn việc nhận/gửi tin Zalo (cùng tiến trình 1
    // luồng). Đo trên DB tạm với 3 nguồn gõ tay 20MB: KHÔNG nhả thì cả vòng
    // chạy liền ~5,1 giây, 0 lần nào khác chen được vào giữa; nhả sau mỗi
    // nguồn thì khối lớn nhất còn lại tụt từ "cả vòng" xuống "một nguồn đơn" -
    // KHÔNG về dưới mili-giây. Đo trực tiếp (vòng tick độc lập chạy song song,
    // 3 nguồn 20MB): một nguồn đơn vẫn giữ nhịp bot ~2,2 giây. Đo tách riêng
    // `catThanhDoan`+`luuDoan` cho một nguồn ở trần tối đa cho phép (100MB):
    // ~6,3 giây - suy theo tỉ lệ tuyến tính từ số này thì một nguồn đúng
    // TRẦN MẶC ĐỊNH `KB_MAX_FILE_MB` (20MB, chưa ai chỉnh trên dashboard) tốn
    // khoảng ~1,2 giây (chi tiết đo ở
    // `.superpowers/sdd/plan/final-fix-wave-report.md`, mục 2). Dù đo bằng
    // cách nào, kết luận không đổi: một nguồn đơn đủ lớn vẫn giữ nhịp bot
    // NHIỀU GIÂY, không phải "dưới mili-giây" như comment cũ nói sai.
    //
    // KHÔNG nhả thêm giữa từng ĐOẠN trong vòng ghi (`luuDoan`) - dù đó mới là
    // phần tốn thời gian nhất (đo trên nguồn 100MB: `catThanhDoan` 198ms so
    // với `luuDoan` 6099ms, tức 97%). Lý do KHÔNG PHẢI vì đoạn đó rẻ, mà vì
    // RÀNG BUỘC GIAO DỊCH: `luuDoan` chạy trong `trongGiaoDich` (`BEGIN
    // IMMEDIATE`) trên connection SQLite DÙNG CHUNG cho cả process
    // (`conversation/database.ts` export một `DatabaseSync` duy nhất, xem
    // `shared/db-transaction.ts:8-10`). Nhả event loop giữa một giao dịch
    // đang mở KHÔNG ném `SQLITE_BUSY` (lỗi đó xảy ra GIỮA các connection khác
    // nhau, không phải giữa hai đoạn code trên cùng một connection) - nó âm
    // thầm để code khác trong tiến trình (agent loop ghi tin nhắn, scheduler
    // tick, `setTuning`...) ghi LẠC vào bên trong giao dịch KB đang mở. Hậu
    // quả: `luuDoan` ném lỗi thì `ROLLBACK` cuốn theo cả dữ liệu không liên
    // quan vừa ghi xen vào; giao dịch nào khác cố mở trong lúc đó sẽ ăn lỗi
    // "cannot start a transaction within a transaction" (`node:sqlite` không
    // hỗ trợ giao dịch lồng nhau).
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * Gọi một lần lúc boot: mọi `dang_xu_ly` sót lại từ lần chạy trước (worker bị
 * giết giữa chừng - process 1 luồng duy nhất, không cần chứng minh bằng pid)
 * về `cho_xu_ly` để vòng tick kế tiếp nhặt lại xử lý, không nằm kẹt vĩnh viễn.
 */
export function goNguonKetLucKhoiDong(): void {
  for (const n of layNguonTheoTrangThai("dang_xu_ly")) {
    datTrangThai(n.id, "cho_xu_ly");
  }
}

// Chặn hai vòng interval chồng lên nhau: nguồn lớn (PDF vài trăm trang) có
// thể xử lý lâu hơn TICK_MS, tick sau bắn vào lúc vòng trước còn dở thì bỏ
// qua - giành có điều kiện ở trên đã đủ AN TOÀN dù thiếu cờ này (không xử lý
// trùng một nguồn), nhưng thiếu cờ thì vẫn tốn công quét trùng lặp mỗi 5s.
let dangChayVong = false;

async function chayMotVongAnToan(): Promise<void> {
  if (dangChayVong) return;
  dangChayVong = true;
  try {
    await xuLyMotVong();
  } finally {
    dangChayVong = false;
  }
}

/** Gọi một lần lúc boot. Trả hàm dừng, mẫu `scheduler-loop.ts`. */
export function batDauWorker(): () => void {
  goNguonKetLucKhoiDong();
  // Chạy NGAY, không đợi hết TICK_MS đầu tiên - nguồn upload lúc bot vừa khởi
  // động lại không phải chờ oan một nhịp quét.
  void chayMotVongAnToan();
  const timer = setInterval(() => void chayMotVongAnToan(), TICK_MS);
  timer.unref();
  return () => clearInterval(timer);
}

import fs from "node:fs";

/**
 * Đọc RSS (MB) của một tiến trình KHÁC từ `/proc/<pid>/statm` - cột thứ hai là
 * số trang đang nằm trong RAM.
 *
 * Vì sao cha phải tự đo thay vì tin con tự báo: con đang giải nén một luồng
 * PDF là đang chạy code ĐỒNG BỘ, nhịp tự báo của nó không được chạy cho tới
 * khi xong - đúng lúc cần đo nhất thì nó câm. `/proc` đọc được bất kể con đang
 * làm gì.
 *
 * Trả `null` khi không có `/proc` (Windows, macOS - chỉ là máy dev) hoặc tiến
 * trình đã thoát. Caller lúc đó lùi về số con tự báo.
 */
export function docRssTuProc(pid: number): number | null {
  try {
    const statm = fs.readFileSync(`/proc/${pid}/statm`, "utf-8");
    const soTrang = Number(statm.split(" ")[1]);
    if (!Number.isFinite(soTrang)) return null;
    return (soTrang * KICH_THUOC_TRANG) / (1024 * 1024);
  } catch {
    return null;
  }
}

/**
 * Cỡ trang bộ nhớ. 4 KiB trên mọi máy chủ x86-64/arm64 Linux phổ thông; Node
 * không có API đọc `getpagesize()` nên ghi cố định - sai trên máy trang 64 KiB
 * thì RSS bị ĐẾM THIẾU, tức trần nới ra 16 lần. Chấp nhận vì image chạy trên
 * VPS x86-64.
 */
const KICH_THUOC_TRANG = 4096;

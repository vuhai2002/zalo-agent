import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../config/env.js";

/**
 * Ghi/xóa file gốc của nguồn Kho tri thức trong `dataDir/kb/`.
 *
 * Tên file người dùng đặt KHÔNG BAO GIỜ chạm vào đường dẫn thật: `luuFile`
 * nhận một id do CALLER sinh (không phải tên gốc của người dùng), rồi vẫn tự
 * lọc lại bằng `segmentAnToan` phòng id đó lỡ mang ký tự lạ - hai lớp phòng thủ
 * cho một bất biến cùng loại với `sanitizeSegment` của `media-store.ts`.
 */

const KB_DIR = "kb";

/** Chỉ giữ ký tự an toàn cho tên file - chặn `..`, `/`, `\` thoát khỏi thư mục */
function segmentAnToan(gia: string): string {
  return gia.replace(/[^a-zA-Z0-9_-]/g, "_") || "x";
}

/**
 * Lưu buffer vào `dataDir/kb/<id>.<dinhDang>`. Trả về đường dẫn TƯƠNG ĐỐI so
 * với `dataDir` (dùng dấu `/` cố định, không phải `path.sep` của hệ điều hành -
 * đây là giá trị lưu vào cột `duong_dan` trong DB nên phải ổn định giữa các máy).
 */
export function luuFile(sourceId: string, dinhDang: string, buf: Buffer): string {
  const thuMuc = path.join(dataDir, KB_DIR);
  fs.mkdirSync(thuMuc, { recursive: true });
  const relPath = `${KB_DIR}/${segmentAnToan(sourceId)}.${segmentAnToan(dinhDang)}`;
  fs.writeFileSync(path.join(dataDir, relPath), buf);
  return relPath;
}

/**
 * Xóa file theo đường dẫn TƯƠNG ĐỐI đã lưu trong `kb_sources.duong_dan`.
 * Idempotent: đường dẫn rỗng (nguồn gõ tay, chưa từng ghi file) hoặc file đã
 * mất sẵn đều không phải lỗi - route xóa nguồn không được vỡ vì đĩa lệch DB.
 */
export function xoaFile(duongDanTuongDoi: string): void {
  if (!duongDanTuongDoi) return;
  try {
    fs.unlinkSync(path.join(dataDir, duongDanTuongDoi));
  } catch {
    /* đã mất sẵn - coi như đã xóa */
  }
}

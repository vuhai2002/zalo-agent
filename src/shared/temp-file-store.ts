import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../config/env.js";
import { startDailyTask } from "./daily-task-schedule.js";
import { createLogger } from "./logger.js";

/**
 * File tạm cho việc gửi file tải từ URL. Nguyên tắc: file được xóa ngay sau khi
 * gửi xong (kể cả khi gửi lỗi) - data/tmp không phải nơi lưu trữ. Sweep định kỳ
 * chỉ để quét file bị bỏ lại khi process chết giữa lượt gửi.
 */

const log = createLogger("temp-file-store");
const tempDir = path.join(dataDir, "tmp");

/** File tạm sống lâu hơn mức này = chắc chắn mồ côi (lượt gửi bình thường tính bằng giây) */
const ORPHAN_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Ghi buffer ra file tạm, chạy `use(filePath)` rồi xóa file trong `finally`.
 * Tên file có tiền tố random để 2 lượt gửi cùng lúc không đè nhau.
 */
export async function withTempFile<T>(
  fileName: string,
  data: Buffer,
  use: (filePath: string) => Promise<T>,
): Promise<T> {
  fs.mkdirSync(tempDir, { recursive: true });
  const prefix = crypto.randomBytes(6).toString("hex");
  const filePath = path.join(tempDir, `${prefix}-${path.basename(fileName)}`);
  fs.writeFileSync(filePath, data, { mode: 0o600 });

  try {
    return await use(filePath);
  } finally {
    try {
      fs.rmSync(filePath, { force: true });
    } catch (err) {
      log.debug({ filePath, err }, "Không xóa được file tạm - sweep định kỳ sẽ dọn");
    }
  }
}

/**
 * Như `withTempFile` nhưng GIỮ NGUYÊN tên file: phần random nằm ở thư mục con
 * chứ không phải tiền tố tên. Dùng cho file bot tự dựng (.docx/.xlsx) vì người
 * nhận nhìn thấy tên này - "bao-gia.docx" đọc được, "a1b2c3-bao-gia.docx" thì không.
 */
export async function withNamedTempFile<T>(
  fileName: string,
  data: Buffer,
  use: (filePath: string) => Promise<T>,
): Promise<T> {
  const dir = path.join(tempDir, crypto.randomBytes(6).toString("hex"));
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, path.basename(fileName));
  fs.writeFileSync(filePath, data, { mode: 0o600 });

  try {
    return await use(filePath);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      log.debug({ dir, err }, "Không xóa được thư mục tạm - sweep định kỳ sẽ dọn");
    }
  }
}

/** Dọn ngay lúc gọi + lặp lại mỗi 24h - bắt file mồ côi sau khi process bị kill */
export function startTempFileCleanupSchedule(): void {
  startDailyTask("temp-file-cleanup", () => {
    const removed = cleanupOrphanTempFiles();
    if (removed > 0) log.info({ removed }, "Đã dọn file tạm mồ côi");
  });
}

/** Xóa file tạm mồ côi. Trả về số file đã xóa. */
export function cleanupOrphanTempFiles(maxAgeMs = ORPHAN_AGE_MS): number {
  const cutoff = Date.now() - maxAgeMs;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(tempDir, { withFileTypes: true });
  } catch {
    return 0; // chưa gửi file nào từ URL
  }

  let removed = 0;
  for (const entry of entries) {
    // Thư mục con là của withNamedTempFile - dọn cả cụm, không bỏ sót
    if (!entry.isFile() && !entry.isDirectory()) continue;
    const entryPath = path.join(tempDir, entry.name);
    try {
      if (fs.statSync(entryPath).mtimeMs >= cutoff) continue;
      if (entry.isDirectory()) fs.rmSync(entryPath, { recursive: true, force: true });
      else fs.unlinkSync(entryPath);
      removed++;
    } catch (err) {
      log.debug({ entryPath, err }, "Không dọn được file tạm - bỏ qua");
    }
  }
  return removed;
}

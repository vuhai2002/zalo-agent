import fs from "node:fs";
import path from "node:path";
import { pruneOldTraces } from "../agent/agent-trace-store.js";
import { dataDir } from "../config/env.js";
import { startDailyTask } from "../shared/daily-task-schedule.js";
import { downloadImage, type DownloadedImage } from "../shared/download-image.js";
import { createLogger } from "../shared/logger.js";
import { estimateImageTokens, readImageSize } from "../zalo/zalo-image-variant.js";
import { pruneExpiredImageDescriptions } from "./image-description-store.js";
import { getTuning } from "../config/runtime-tuning-settings.js";

const log = createLogger("media-store");
const mediaDir = path.join(dataDir, "media");

const EXT_BY_MEDIA_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MEDIA_TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/** Zalo id là số nhưng không tin tưởng: chỉ giữ ký tự an toàn cho tên file */
function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_") || "x";
}

export type PersistableMessage = {
  threadId: string;
  msgId: string;
  images: { url: string; localPath?: string }[];
};

export type ImageDownloader = (url: string) => Promise<DownloadedImage | null>;

/**
 * Tải ảnh của cả batch về data/media, gắn localPath vào từng ảnh tải thành công.
 * Ảnh lỗi (URL chết, quá 8MB, IP nội bộ...) chỉ log debug - không được chặn đường
 * trả lời. Không bao giờ reject để caller fire-and-forget được.
 *
 * `download` tiêm được để test không cần mạng thật.
 */
export async function persistBatchImages(
  accountId: string,
  messages: PersistableMessage[],
  download: ImageDownloader = downloadImage,
): Promise<void> {
  for (const msg of messages) {
    for (const [index, image] of msg.images.entries()) {
      try {
        const downloaded = await download(image.url);
        if (!downloaded) continue;
        const ext = EXT_BY_MEDIA_TYPE[downloaded.mediaType.split(";")[0]!.trim()] ?? "jpg";
        const relPath = [
          "media",
          sanitizeSegment(accountId),
          sanitizeSegment(msg.threadId),
          `${sanitizeSegment(msg.msgId)}-${index}.${ext}`,
        ].join("/");
        const absPath = path.join(dataDir, relPath);
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, downloaded.data);
        image.localPath = relPath;

        // Ảnh là khoản token đắt nhất mỗi lượt - log kích thước thật + ước
        // lượng token để đo được ngay khi đổi ZALO_IMAGE_QUALITY, khỏi đoán
        const size = readImageSize(downloaded.data);
        log.info(
          {
            accountId,
            relPath,
            kb: Math.round(downloaded.data.length / 1024),
            ...(size
              ? { size: `${size.width}x${size.height}`, tokenUocLuong: estimateImageTokens(size.width, size.height) }
              : {}),
          },
          "Đã lưu ảnh nhận được",
        );
      } catch (err) {
        log.debug({ accountId, msgId: msg.msgId, err }, "Không lưu được ảnh - bỏ qua");
      }
    }
  }
}

/** Đường dẫn các ảnh đã lưu thành công của 1 tin - để ghi vào cột images */
export function imagePathsOf(images: { localPath?: string }[]): string[] {
  return images.map((i) => i.localPath).filter((p): p is string => Boolean(p));
}

/**
 * Đọc ảnh đã lưu theo đường dẫn tương đối trong DB. File mất (đã bị dọn theo
 * MEDIA_RETENTION_DAYS) hoặc đường dẫn thoát khỏi data/media đều trả null.
 */
export function loadStoredImage(relPath: string): { base64: string; mediaType: string } | null {
  try {
    const absPath = path.resolve(dataDir, relPath);
    if (!absPath.startsWith(mediaDir + path.sep)) return null;
    const data = fs.readFileSync(absPath);
    const ext = path.extname(absPath).slice(1).toLowerCase();
    return { base64: data.toString("base64"), mediaType: MEDIA_TYPE_BY_EXT[ext] ?? "image/jpeg" };
  } catch {
    return null;
  }
}

/** Xóa file media cũ hơn MEDIA_RETENTION_DAYS + gỡ thư mục rỗng. Trả về số file đã xóa. */
export function cleanupExpiredMedia(): number {
  const cutoff = Date.now() - getTuning("MEDIA_RETENTION_DAYS") * 24 * 60 * 60 * 1000;
  return removeExpiredIn(mediaDir, cutoff);
}

function removeExpiredIn(dir: string, cutoff: number): number {
  let removed = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0; // thư mục chưa tồn tại (chưa nhận ảnh nào)
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        removed += removeExpiredIn(full, cutoff);
        if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
      } else if (fs.statSync(full).mtimeMs < cutoff) {
        fs.unlinkSync(full);
        removed++;
      }
    } catch (err) {
      log.debug({ file: full, err }, "Không dọn được file media - bỏ qua");
    }
  }
  return removed;
}

/** Dọn ngay lúc gọi + lặp lại mỗi 24h */
export function startMediaCleanupSchedule(): void {
  // Callback phải ĐỒNG BỘ: startDailyTask bọc try/catch quanh lời gọi, hàm
  // async thì promise reject lọt ra ngoài thành unhandled rejection
  startDailyTask("media-cleanup", () => {
    const removed = cleanupExpiredMedia();
    // Mô tả ảnh của sidecar dọn cùng nhịp: quá hạn thì cả pixel lẫn mô tả cùng đi
    const prunedDescriptions = pruneExpiredImageDescriptions(getTuning("MEDIA_RETENTION_DAYS"));
    // Trace step agent dọn cùng nhịp - bảng phình nhanh nhất trong DB
    const prunedTraces = pruneOldTraces();
    if (removed > 0 || prunedDescriptions > 0 || prunedTraces > 0) {
      log.info(
        { removed, prunedDescriptions, prunedTraces },
        "Đã dọn file media + mô tả ảnh + trace hết hạn",
      );
    }
  });
}

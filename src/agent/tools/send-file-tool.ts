import fs from "node:fs";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { dataDir } from "../../config/env.js";
import { downloadFromPublicUrl } from "../../shared/safe-remote-download.js";
import { withTempFile } from "../../shared/temp-file-store.js";
import type { ToolContext } from "./index.js";
import { ketQuaLoi } from "./tool-failure-result.js";
import { guiFileKemCaption } from "./send-attachment-with-caption.js";
import { ghiChuDaGuiFile } from "./sent-by-tool-note.js";

/**
 * Trần tải file từ URL - CHÍNH SÁCH tự đặt, không phải giới hạn của Zalo.
 * Giới hạn thật nằm ở `settings.features.sharefile.max_size_share_file_v3` do
 * server Zalo trả về lúc login và zca-js tự kiểm (ném lỗi kèm số MB cụ thể).
 * Con số ở đây chỉ để khỏi tải hàng trăm MB rồi mới biết là vô ích.
 */
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

// Chỉ cho gửi file trong data/shared-files (chặn agent đọc file tùy ý trên máy,
// vd credentials) hoặc tải từ URL http(s) công khai.
//
// Nguồn URL do LLM quyết mà LLM đọc tin của người lạ, nên đường tải phải đi qua
// safe-remote-download: chặn IP nội bộ (SSRF - loopback, 169.254.169.254...) và
// cắt theo stream khi vượt 25MB. File tạm bị xóa ngay sau khi gửi.
export function createSendFileTool({ api, account, message, ghiNhanDaGui }: ToolContext) {
  // Ghi history NGAY TRONG hàm gửi để hai nhánh (URL và kho shared-files) không
  // thể quên: tin này không đi qua `deliverChatReply` nên không ai ghi hộ.
  const sendAttachment = async (filePath: string, caption: string | undefined, tenHienThi: string) => {
    await guiFileKemCaption(
      api,
      `${account.id}:${message.threadId}`,
      message.threadId,
      message.threadType,
      filePath,
      caption,
    );
    ghiNhanDaGui?.(ghiChuDaGuiFile(tenHienThi, caption));
  };

  return tool({
    description:
      "Gửi 1 file cho cuộc trò chuyện hiện tại. Nguồn: tên file có sẵn trong kho shared-files (vd 'bao-gia.pdf') hoặc URL http(s) công khai.",
    inputSchema: z.object({
      source: z.string().describe("Tên file trong shared-files hoặc URL http(s)"),
      caption: z.string().optional().describe("Chú thích kèm file (tùy chọn)"),
    }),
    execute: async ({ source, caption }) => {
      try {
        if (/^https?:\/\//i.test(source)) {
          const file = await downloadFromPublicUrl(source, { maxBytes: MAX_DOWNLOAD_BYTES });
          await withTempFile(file.fileName, file.data, (filePath) =>
            sendAttachment(filePath, caption, file.fileName),
          );
          return "Đã gửi file thành công";
        }

        const sharedDir = path.join(dataDir, "shared-files");
        // basename chặn path traversal kiểu ../../data/accounts/...
        const filePath = path.join(sharedDir, path.basename(source));
        if (!fs.existsSync(filePath)) {
          return ketQuaLoi(`Không có file "${source}" trong kho shared-files`);
        }
        await sendAttachment(filePath, caption, path.basename(source));
        return "Đã gửi file thành công";
      } catch (err) {
        return ketQuaLoi(`Gửi file thất bại: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });
}

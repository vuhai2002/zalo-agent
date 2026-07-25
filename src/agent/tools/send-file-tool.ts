import fs from "node:fs";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { dataDir } from "../../config/env.js";
import { enqueueSend } from "../../middleware/rate-limiter.js";
import type { ToolContext } from "./index.js";

const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

// Chỉ cho gửi file trong data/shared-files (chặn agent đọc file tùy ý trên máy,
// vd credentials) hoặc tải từ URL http(s) về temp rồi gửi.
export function createSendFileTool({ api, account, message }: ToolContext) {
  return tool({
    description:
      "Gửi 1 file cho cuộc trò chuyện hiện tại. Nguồn: tên file có sẵn trong kho shared-files (vd 'bao-gia.pdf') hoặc URL http(s) công khai.",
    inputSchema: z.object({
      source: z.string().describe("Tên file trong shared-files hoặc URL http(s)"),
      caption: z.string().optional().describe("Chú thích kèm file (tùy chọn)"),
    }),
    execute: async ({ source, caption }) => {
      try {
        let filePath: string;

        if (/^https?:\/\//i.test(source)) {
          const res = await fetch(source);
          if (!res.ok) return `Tải URL thất bại: HTTP ${res.status}`;
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.byteLength > MAX_DOWNLOAD_BYTES) return "File quá lớn (>25MB), không gửi";

          const name = path.basename(new URL(source).pathname) || "tep-tai-ve";
          const tmpDir = path.join(dataDir, "tmp");
          fs.mkdirSync(tmpDir, { recursive: true });
          filePath = path.join(tmpDir, `${Date.now()}-${name}`);
          fs.writeFileSync(filePath, buf);
        } else {
          const sharedDir = path.join(dataDir, "shared-files");
          // basename chặn path traversal kiểu ../../data/accounts/...
          filePath = path.join(sharedDir, path.basename(source));
          if (!fs.existsSync(filePath)) {
            return `Không có file "${source}" trong kho shared-files`;
          }
        }

        await enqueueSend(`${account.id}:${message.threadId}`, () =>
          api.sendMessage(
            { msg: caption ?? "", attachments: [filePath] },
            message.threadId,
            message.threadType,
          ),
        );
        return "Đã gửi file thành công";
      } catch (err) {
        return `Gửi file thất bại: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

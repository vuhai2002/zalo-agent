import { tool } from "ai";
import { z } from "zod";
import { getSearchSettings } from "../../config/runtime-tool-settings.js";
import { searchWeb } from "../../shared/web-search-providers.js";
import { ketQuaLoi } from "./tool-failure-result.js";
import { wrapUntrustedContent } from "./wrap-untrusted-content.js";
import { getTuning } from "../../config/runtime-tuning-settings.js";

/**
 * Tìm kiếm web cho agent. Không cần cấu hình gì: DuckDuckGo chạy không key;
 * có BRAVE_SEARCH_API_KEY thì tự dùng Brave trước (kết quả tốt hơn).
 *
 * Kết quả web là DỮ LIỆU không tin cậy - persona đã có quy tắc chung, nhưng
 * vẫn nhắc lại trong khung kết quả vì nội dung trang lạ hoàn toàn có thể chứa
 * chỉ thị prompt injection.
 */
export function createWebSearchTool() {
  return tool({
    description:
      "Tìm kiếm trên web (tin tức, giá cả, sự kiện, thông tin mới sau thời điểm huấn luyện). Trả về danh sách tiêu đề + URL + mô tả ngắn. Muốn đọc chi tiết 1 trang thì gọi tiếp tool web_fetch với URL.",
    inputSchema: z.object({
      query: z.string().min(1).max(400).describe("Từ khóa tìm kiếm, giữ ngắn gọn"),
    }),
    execute: async ({ query }) => {
      // Cấu hình đọc lại mỗi lượt - đổi provider trên dashboard có hiệu lực ngay.
      // Provider duckduckgo thì không truyền key Brave để chain bỏ qua nó luôn.
      const settings = getSearchSettings();
      const results = await searchWeb(query, {
        maxResults: getTuning("WEB_SEARCH_MAX_RESULTS"),
        braveApiKey: settings.provider === "brave" ? settings.braveApiKey : undefined,
      });

      if (results.length === 0) {
        return ketQuaLoi(
          "Không tìm thấy kết quả nào (hoặc dịch vụ tìm kiếm đang lỗi). Thử từ khóa khác.",
        );
      }

      const lines = results.map(
        (r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`,
      );
      // Tiêu đề và mô tả trong kết quả tìm kiếm cũng do bên ngoài viết ra - một
      // trang đặt tiêu đề thành chỉ thị là đủ để thử điều khiển model
      return wrapUntrustedContent(lines.join("\n"), `kết quả tìm kiếm: ${query}`);
    },
  });
}

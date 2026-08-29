/**
 * Map trạng thái kết nối server MCP -> chữ hiển thị + tông màu cho Badge.
 *
 * `TrangThaiServer` IMPORT TYPE xuyên biên từ `src/mcp/mcp-types.ts` (không
 * khai lại cục bộ): file nguồn đó KHÔNG có import nào cả (thuần type alias),
 * cùng dạng "file thuần, browser nạp thẳng" như `tuning-number-presets.ts` /
 * `ky-tu-moi-token.ts` (đã có tiền lệ cross-boundary import thật sự ở
 * `web/src/pages/agent-model-section.tsx`, `tuning-field-control.tsx`) - và vì
 * là `import type` nên bị xóa hoàn toàn lúc biên dịch, không lọt byte nào vào
 * bundle trình duyệt. Tránh khai trùng union 4 giá trị ở hai nơi (đúng bài học
 * "hằng số quy đổi chỉ được có MỘT bản" đã trả giá ở `ky-tu-moi-token.ts`).
 *
 * `tone` dùng vocabulary RIÊNG ("ok"/"warn"/"muted") thay vì tone của
 * `Badge` ("green"/"amber"/...) - hàm này giữ THUẦN, không phụ thuộc UI, nơi
 * gọi (`mcp-server-row.tsx`) tự quy đổi sang tone của Badge.
 */
import type { TrangThaiServer } from "../../../src/mcp/mcp-types.js";

export function nhanTrangThai(t: TrangThaiServer): { chu: string; tone: "ok" | "warn" | "muted" } {
  switch (t) {
    case "da_ket_noi":
      return { chu: "Đã kết nối", tone: "ok" };
    case "loi":
      return { chu: "Lỗi", tone: "warn" };
    case "can_duyet_lai":
      return { chu: "Chờ duyệt lại", tone: "warn" };
    default:
      return { chu: "Chờ kết nối", tone: "muted" };
  }
}

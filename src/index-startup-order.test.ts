import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Không mô phỏng runtime: KHÔNG import `index.ts` (nó có tác dụng phụ chạy
 * thật ngay lúc nạp module - kết nối Zalo, mở dashboard...). Đọc THẲNG thứ tự
 * dòng nguồn - bất đắc dĩ nhưng đúng chỗ: đây là một bất biến về THỨ TỰ KHỞI
 * ĐỘNG, không có hành vi runtime nào quan sát được nó rẻ hơn. Nguồn Kho tri
 * thức treo/chết worker thì đây là thứ quyết định người vận hành có vào được
 * dashboard để xóa nó hay không (C2).
 */
describe("thứ tự khởi động trong src/index.ts (C2)", () => {
  it("startDashboardServer() chạy TRƯỚC batDauKbIngestWorker() - nguồn độc treo worker không được khóa luôn đường vào dashboard", () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "index.ts"), "utf-8");
    const viTriDashboard = src.indexOf("startDashboardServer()");
    const viTriWorker = src.indexOf("batDauKbIngestWorker()");
    assert.ok(viTriDashboard >= 0, "không tìm thấy lời gọi startDashboardServer() trong index.ts");
    assert.ok(viTriWorker >= 0, "không tìm thấy lời gọi batDauKbIngestWorker() trong index.ts");
    assert.ok(
      viTriDashboard < viTriWorker,
      "worker Kho tri thức khởi động TRƯỚC dashboard - nguồn độc treo/chết worker thì người vận hành không vào được dashboard để xóa nó",
    );
  });
});

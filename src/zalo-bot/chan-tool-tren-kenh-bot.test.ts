import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { ToolScope } from "../agent/tools/tool-catalog-types.js";

/**
 * `tool-registry.js` bắc cầu tới `database.ts` - module đó mở SQLite và chạy
 * migration ở MODULE SCOPE. Import TĨNH ở đây là mở nhầm `data/zalo-agent.db`
 * THẬT mỗi lần chạy `pnpm test` (xem CLAUDE.md, mục "Bẫy khi viết test").
 * Bản đầu của file này đã dính đúng bẫy đó, và hậu quả không dừng ở chuyện mở
 * nhầm DB: `create_image.available()` đọc `runtime_settings` thật, nên hai
 * khẳng định dưới XANH trên máy đã cấu hình vẽ ảnh và ĐỎ trên bản clone sạch.
 */
let dataDir: string;
let registry: typeof import("../agent/tools/tool-registry.js");
let nangLuc: typeof import("./nang-luc-kenh-bot.js");
let catalog: typeof import("../agent/tools/tool-catalog.js");

before(async () => {
  dataDir = setupTestEnv();
  registry = await import("../agent/tools/tool-registry.js");
  nangLuc = await import("./nang-luc-kenh-bot.js");
  catalog = await import("../agent/tools/tool-catalog.js");
});

after(async () => {
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

const agent = { id: "a1", disabledTools: [] };
const KENH_BOT: ToolScope = { agent, account: { disabledTools: [], loai: "bot" } };
const KENH_CA_NHAN: ToolScope = { agent, account: { disabledTools: [], loai: "ca_nhan" } };

const keys = (s: ToolScope) => registry.listAvailableTools(s).map((t) => t.key);

describe("chặn tool trên kênh bot", () => {
  it("7 tool đụng kênh KHÔNG vào schema của lượt chạy trên bot", () => {
    // Đây là chốt thật sự: tool không nằm trong danh sách này thì model KHÔNG
    // nhận được schema của nó, nên không gọi được, nên không hứa được.
    const tren = keys(KENH_BOT);
    for (const k of Object.keys(nangLuc.TOOL_KHONG_CHAY_TREN_BOT)) {
      assert.ok(!tren.includes(k), `"${k}" vẫn vào schema trên kênh bot`);
    }
  });

  it("kênh cá nhân KHÔNG bị chặn gì thêm - chỉ kênh bot mới hẹp lại", () => {
    // Chốt chống "sửa cho bot làm hỏng luôn kênh đang chạy" - hồi quy đắt nhất
    // có thể xảy ra ở đợt này.
    //
    // Đo qua `kiemTraKhaDung` CHỨ KHÔNG qua `listAvailableTools`: hàm sau còn
    // xét `available()` của từng tool, mà vài tool trong đó đọc cấu hình runtime
    // (`create_image` cần model vẽ ảnh, `read_image` cần sidecar). Trộn hai
    // chuyện vào một phép đo là test đổi màu theo cấu hình của MÁY CHẠY chứ
    // không theo code - bản đầu của file này đã sai đúng như vậy.
    // Đo bằng LÝ DO chứ không bằng cờ khả dụng: vài tool tự tắt vì thiếu hạ
    // tầng (`create_image` cần model vẽ ảnh, `read_image` cần sidecar), nên
    // "không khả dụng" trên kênh cá nhân là chuyện bình thường và không nói
    // lên điều gì. Thứ phải canh là cổng KÊNH chỉ bắn cho kênh bot.
    for (const [key, ly] of Object.entries(nangLuc.TOOL_KHONG_CHAY_TREN_BOT)) {
      const def = catalog.TOOL_DEFINITIONS.find((t) => t.key === key)!;
      assert.equal(registry.kiemTraKhaDung(def, KENH_BOT).hint, ly.hint, `"${key}" phải bị cổng kênh bot chặn`);
      assert.notEqual(
        registry.kiemTraKhaDung(def, KENH_CA_NHAN).hint,
        ly.hint,
        `"${key}" bị cổng kênh bot chặn NHẦM trên kênh cá nhân`,
      );
    }
  });

  it("tool thuần vẫn chạy trên kênh bot", () => {
    const tren = keys(KENH_BOT);
    for (const k of ["get_datetime", "web_search", "web_fetch", "save_memory", "schedule_task"]) {
      assert.ok(tren.includes(k), `"${k}" bị chặn nhầm trên kênh bot`);
    }
  });

  it("kênh bot hẹp hơn kênh cá nhân ĐÚNG bằng bảng chặn, không hơn không kém", () => {
    // Đếm hiệu hai tập trên TOÀN BỘ catalog (không qua `available()`) nên con
    // số này chỉ phụ thuộc bảng chặn, không phụ thuộc cấu hình máy.
    // Lọc theo LÝ DO là của cổng kênh, không phải theo cờ khả dụng - cùng lý do
    // với ca trên, nhờ vậy con số chỉ phụ thuộc bảng chặn chứ không phụ thuộc
    // cấu hình của máy chạy test.
    const lyDoKenhBot = new Set(Object.values(nangLuc.TOOL_KHONG_CHAY_TREN_BOT).map((l) => l.hint));
    const chanBot = catalog.TOOL_DEFINITIONS.filter((d) =>
      lyDoKenhBot.has(registry.kiemTraKhaDung(d, KENH_BOT).hint ?? ""),
    ).map((d) => d.key);
    assert.deepEqual(chanBot.sort(), Object.keys(nangLuc.TOOL_KHONG_CHAY_TREN_BOT).sort());
  });

  it("lý do chặn nói rõ là giới hạn Zalo, để dashboard hiện đúng nguyên nhân", () => {
    const def = catalog.TOOL_DEFINITIONS.find((t) => t.key === "send_file")!;
    const kq = registry.kiemTraKhaDung(def, KENH_BOT);
    assert.equal(kq.khaDung, false);
    assert.match(kq.hint ?? "", /Zalo Bot API/);
  });

  it("giới hạn nền tảng THẮNG cả khi tool được bật trên dashboard", () => {
    // Người vận hành bật "Gửi file" cho tài khoản bot là chuyện sẽ xảy ra -
    // dashboard không cấm. Bật kiểu gì cũng phải hỏng, và hỏng theo cách người
    // nhắn tưởng agent bị lỗi. Nên giới hạn nền tảng phải thắng.
    assert.ok(!keys({ agent: { id: "a1", disabledTools: [] }, account: { disabledTools: [], loai: "bot" } }).includes("send_file"));
  });
});

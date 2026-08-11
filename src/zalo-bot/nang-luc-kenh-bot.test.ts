import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import {
  LUAT_PERSONA_KENH_BOT,
  TOOL_KHONG_CHAY_TREN_BOT,
  toolChayDuocTrenBot,
} from "./nang-luc-kenh-bot.js";

// `tool-catalog.js` bắc cầu tới `database.ts` (mở SQLite ở module scope) - nạp
// ĐỘNG sau `setupTestEnv()`, xem CLAUDE.md mục "Bẫy khi viết test".
let dataDir: string;
let TOOL_KEYS: string[];

before(async () => {
  dataDir = setupTestEnv();
  TOOL_KEYS = (await import("../agent/tools/tool-catalog.js")).TOOL_KEYS;
});

after(async () => {
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("năng lực kênh bot", () => {
  it("mọi key trong danh sách chặn PHẢI là tool có thật", () => {
    // Đây là chốt chống gõ sai tên và chống tool bị đổi key mà quên sửa ở đây -
    // gõ sai thì tool vẫn chạy trên kênh bot rồi hỏng trước mặt người dùng, mà
    // không có gì báo.
    for (const key of Object.keys(TOOL_KHONG_CHAY_TREN_BOT)) {
      assert.ok(TOOL_KEYS.includes(key), `"${key}" không phải tool có thật trong catalog`);
    }
  });

  it("THÊM TOOL MỚI phải quyết định nó chạy được trên bot hay không", () => {
    // Danh sách này cố ý viết TAY. Thêm tool mới mà quên xét kênh bot thì mặc
    // định nó được coi là chạy được - im lặng sai. Test đỏ ở đây buộc người
    // thêm tool phải đọc bảng năng lực và chọn một bên.
    const daXet = new Set([
      ...Object.keys(TOOL_KHONG_CHAY_TREN_BOT),
      // Tool CHẠY ĐƯỢC - liệt kê tường minh để danh sách này không tự phình
      "get_datetime",
      "web_search",
      "web_fetch",
      "read_image",
      "kb_search",
      "save_memory",
    ]);
    const chuaXet = TOOL_KEYS.filter((k) => !daXet.has(k));
    assert.deepEqual(chuaXet, [], `tool chưa xét cho kênh bot: ${chuaXet.join(", ")}`);
  });

  it("8 tool đụng kênh bị chặn, tool thuần thì không", () => {
    assert.equal(toolChayDuocTrenBot("send_file"), false);
    assert.equal(toolChayDuocTrenBot("create_word_document"), false);
    assert.equal(toolChayDuocTrenBot("create_excel_file"), false);
    assert.equal(toolChayDuocTrenBot("create_image"), false);
    assert.equal(toolChayDuocTrenBot("add_reaction"), false);
    assert.equal(toolChayDuocTrenBot("tag_member"), false);
    assert.equal(toolChayDuocTrenBot("get_group_info"), false);

    assert.equal(toolChayDuocTrenBot("schedule_task"), false);

    assert.equal(toolChayDuocTrenBot("kb_search"), true);
    assert.equal(toolChayDuocTrenBot("web_search"), true);
  });

  it("mỗi lý do phải nói ĐƯỢC GÌ và MẤT GÌ, không chỉ 'không hỗ trợ'", () => {
    // Câu chung chung để lại người vận hành đúng chỗ họ đang đứng: không biết
    // đây là lỗi cấu hình hay giới hạn nền tảng.
    for (const [key, ly] of Object.entries(TOOL_KHONG_CHAY_TREN_BOT)) {
      assert.ok(ly.hint.length > 30, `hint của ${key} quá ngắn để nói được lý do`);
      assert.match(ly.hint, /Zalo Bot API/, `hint của ${key} không nói rõ đây là giới hạn của Zalo`);
    }
  });

  it("luật persona nói RÕ đây là giới hạn nền tảng, không phải agent hỏng", () => {
    // Ẩn tool là chưa đủ: model sẽ nói "tôi không làm được" mà không nói vì sao,
    // và người nhắn tưởng agent bị lỗi - đúng điều cần tránh.
    assert.match(LUAT_PERSONA_KENH_BOT, /KHÔNG phải bạn bị lỗi/);
    assert.match(LUAT_PERSONA_KENH_BOT, /tài khoản cá nhân/);
    assert.match(LUAT_PERSONA_KENH_BOT, /file/i);
  });
});

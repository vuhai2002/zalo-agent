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
      // Nối vào bộ hẹn lịch ở V3.19 - scheduler dựng đường gửi theo KÊNH thay
      // vì khóa cứng zca-js. Bot API gửi chủ động được (đo: 10 tin/416ms).
      "schedule_task",
    ]);
    const chuaXet = TOOL_KEYS.filter((k) => !daXet.has(k));
    assert.deepEqual(chuaXet, [], `tool chưa xét cho kênh bot: ${chuaXet.join(", ")}`);
  });

  it("7 tool đụng năng lực Bot API KHÔNG CÓ thì bị chặn, tool thuần thì không", () => {
    assert.equal(toolChayDuocTrenBot("send_file"), false);
    assert.equal(toolChayDuocTrenBot("create_word_document"), false);
    assert.equal(toolChayDuocTrenBot("create_excel_file"), false);
    assert.equal(toolChayDuocTrenBot("create_image"), false);
    assert.equal(toolChayDuocTrenBot("add_reaction"), false);
    assert.equal(toolChayDuocTrenBot("tag_member"), false);
    assert.equal(toolChayDuocTrenBot("get_group_info"), false);
    assert.equal(Object.keys(TOOL_KHONG_CHAY_TREN_BOT).length, 7);

    // `schedule_task` TỪNG bị chặn và là mục DUY NHẤT trong bảng không dẫn
    // được một số đo 404 nào - lý do thật là scheduler khóa cứng vào zca-js,
    // đã sửa ở V3.19.
    assert.equal(toolChayDuocTrenBot("schedule_task"), true);

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

  it("persona nêu ĐỦ CẢ BẢY tool bị chặn - không để model im lặng về một giới hạn", () => {
    // Bất đối xứng đã trả giá: câu mô tả trên dashboard có ca canh độ phủ, còn
    // persona thì không - nên khi vòng rà soát 3 bổ sung `get_group_info` vào
    // dashboard, persona trôi lại và độ lệch chỉ ĐẢO CHIỀU chứ chưa hết
    // (dashboard 7, persona 6). Đúng bài học "chỗ nào có test canh thì sống
    // sót, chỗ nào dựa vào người nhớ thì trôi".
    //
    // Ràng buộc này KHÔNG làm prompt phình vô hạn: bảng chặn chỉ CO LẠI theo
    // thời gian (Zalo mở thêm method là bớt một mục), không nở ra.
    //
    // So VỊ TRÍ KHỚP chứ không so mẫu, cùng lý do đã ghi ở
    // `web/src/pages/mo-ta-loai-kenh.test.ts`: hai mẫu khác nhau vẫn có thể
    // khớp cùng một đoạn chữ, và khi đó key sau chỉ đang đi ké key trước.
    const chuCanCo: Record<string, RegExp> = {
      send_file: /gửi được file/i,
      create_word_document: /tài liệu Word/i,
      create_excel_file: /Excel/i,
      create_image: /ảnh tự vẽ/i,
      add_reaction: /thả được cảm xúc/i,
      tag_member: /tag được ai/i,
      get_group_info: /danh sách thành viên nhóm/i,
    };

    assert.deepEqual(
      Object.keys(chuCanCo).sort(),
      Object.keys(TOOL_KHONG_CHAY_TREN_BOT).sort(),
      "bảng chặn đã đổi mà persona chưa theo - model sẽ nói 'không làm được' mà không nói vì sao",
    );

    const doanKhop: { key: string; dau: number; cuoi: number }[] = [];
    for (const [key, m] of Object.entries(chuCanCo)) {
      const kq = LUAT_PERSONA_KENH_BOT.match(m);
      assert.ok(kq && kq.index !== undefined, `persona không nhắc tới giới hạn của "${key}"`);
      doanKhop.push({ key, dau: kq.index, cuoi: kq.index + kq[0].length });
    }
    for (const a of doanKhop) {
      for (const b of doanKhop) {
        if (a.key >= b.key) continue;
        assert.ok(
          a.cuoi <= b.dau || b.cuoi <= a.dau,
          `"${a.key}" và "${b.key}" khớp CHỒNG LẤN cùng một đoạn chữ - phép đo mất răng`,
        );
      }
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

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Tham số chỉnh từ dashboard đè lên `.env`, và phải ĐỌC LẠI mỗi lần gọi - cache
 * ở đây là quay về đúng vấn đề cũ: phải khởi động lại mới thấy thay đổi.
 */

let dataDir: string;
let tuning: typeof import("./runtime-tuning-settings.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv({ LLM_MAX_STEPS: "8", LLM_REASONING_EFFORT: "medium" });
  tuning = await import("./runtime-tuning-settings.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  database.db.exec("DELETE FROM runtime_settings WHERE key LIKE 'tuning_%';");
});

describe("getTuning - DB đè env", () => {
  it("chưa đặt gì thì lấy giá trị trong .env", () => {
    assert.equal(tuning.getTuning("LLM_MAX_STEPS"), 8);
  });

  it("đặt rồi thì lấy giá trị mới NGAY, không cần khởi động lại", () => {
    tuning.setTuning("LLM_MAX_STEPS", 12);
    assert.equal(tuning.getTuning("LLM_MAX_STEPS"), 12, "đọc lại phải thấy ngay - cache là hỏng cả mục đích");
  });

  it("null = xóa đè, quay về .env", () => {
    tuning.setTuning("LLM_MAX_STEPS", 12);
    tuning.setTuning("LLM_MAX_STEPS", null);
    assert.equal(tuning.getTuning("LLM_MAX_STEPS"), 8);
  });

  it("giá trị ngoài khoảng cho phép bị bỏ qua thay vì làm chết bot", () => {
    database.db
      .prepare("INSERT INTO runtime_settings (key, value) VALUES ('tuning_LLM_MAX_STEPS', '9999')")
      .run();
    assert.equal(tuning.getTuning("LLM_MAX_STEPS"), 8, "sửa tay trong DB không được phá bot");
  });

  it("giá trị không phải số cũng rơi về .env", () => {
    database.db
      .prepare("INSERT INTO runtime_settings (key, value) VALUES ('tuning_LLM_MAX_STEPS', 'tam')")
      .run();
    assert.equal(tuning.getTuning("LLM_MAX_STEPS"), 8);
  });

  it("kiểu bật/tắt đọc đúng", () => {
    tuning.setTuning("AGENT_TRACE_ENABLED", false);
    assert.equal(tuning.getTuning("AGENT_TRACE_ENABLED"), false);
    tuning.setTuning("AGENT_TRACE_ENABLED", true);
    assert.equal(tuning.getTuning("AGENT_TRACE_ENABLED"), true);
  });

  it("kiểu chọn: giá trị lạ rơi về .env", () => {
    tuning.setTuning("LLM_REASONING_EFFORT", "sieu-cao");
    assert.equal(tuning.getTuning("LLM_REASONING_EFFORT"), "medium");
    tuning.setTuning("LLM_REASONING_EFFORT", "high");
    assert.equal(tuning.getTuning("LLM_REASONING_EFFORT"), "high");
  });

  it("listTuning nói rõ ô nào đang lấy từ .env", () => {
    tuning.setTuning("LLM_MAX_STEPS", 5);
    const ds = tuning.listTuning();
    assert.equal(ds.find((x) => x.key === "LLM_MAX_STEPS")?.fromEnv, false);
    assert.equal(ds.find((x) => x.key === "WEB_FETCH_MAX_CHARS")?.fromEnv, true);
  });
});

/**
 * Ràng buộc GIỮA các tham số. Nhìn hai ô nhập rời nhau thì không ai nhận ra
 * đặt trần lượt thấp hơn trần vẽ ảnh là giết ngang lượt vẽ hợp lệ.
 */
describe("validateTuning - ràng buộc chéo", () => {
  it("trần lượt phải lớn hơn trần vẽ ảnh", () => {
    const loi = tuning.validateTuning({ LLM_TURN_TIMEOUT_MS: 300_000, IMAGE_GEN_TIMEOUT_MS: 600_000 });
    // Kiểm đúng câu lỗi thay vì đếm: các luật khác cũng chạy trên cùng bộ giá
    // trị, đếm số lỗi là buộc test vào luật không liên quan
    assert.ok(loi.some((l) => /lớn hơn trần thời gian mỗi ảnh/.test(l)));
  });

  it("kiểm được cả khi chỉ sửa MỘT ô - ô kia lấy giá trị hiện tại", () => {
    tuning.setTuning("IMAGE_GEN_TIMEOUT_MS", 600_000);
    const loi = tuning.validateTuning({ LLM_TURN_TIMEOUT_MS: 120_000 });
    assert.ok(loi.length > 0, "chỉ gửi 1 ô vẫn phải bắt được");
  });

  it("thời gian im lặng phải nhỏ hơn trần mỗi ảnh", () => {
    const loi = tuning.validateTuning({ IMAGE_GEN_STALL_MS: 300_000, IMAGE_GEN_TIMEOUT_MS: 100_000 });
    assert.ok(loi.some((l) => /im lặng/.test(l)));
  });

  it("giãn nhịp gửi tối thiểu không được lớn hơn tối đa", () => {
    const loi = tuning.validateTuning({ SEND_DELAY_MIN_MS: 5000, SEND_DELAY_MAX_MS: 1000 });
    assert.ok(loi.some((l) => /tối thiểu/.test(l)));
  });

  it("trần ký tự tài liệu quá lớn so với trần token thì chặn", () => {
    const loi = tuning.validateTuning({ DOCUMENT_MAX_CHARS: 400_000, LLM_MAX_OUTPUT_TOKENS: 16_384 });
    assert.ok(loi.some((l) => /tài liệu/.test(l)));
  });

  it("trần context quá thấp so với trần token viết ra thì chặn", () => {
    // Bot chỉ dùng tới 70% trần context; 30% còn lại phải đủ chứa phần model
    // viết ra. Đặt trần context ở mức tối thiểu 4.000 trong khi output tối đa
    // 16.384 là cấu hình tự mâu thuẫn - phần chừa đã bị output ăn sạch.
    const loi = tuning.validateTuning({ LLM_CONTEXT_WINDOW: 4_000, LLM_MAX_OUTPUT_TOKENS: 16_384 });
    assert.ok(loi.some((l) => /viết ra/.test(l)), `phải chặn, nhận: ${JSON.stringify(loi)}`);
  });

  it("mặc định 128.000 với 16.384 thì hợp lệ - đối chứng cho ca trên", () => {
    const loi = tuning.validateTuning({ LLM_CONTEXT_WINDOW: 128_000, LLM_MAX_OUTPUT_TOKENS: 16_384 });
    assert.deepEqual(loi, [], "cấu hình mặc định không được báo lỗi");
  });

  it("bộ mặc định KHI PHÁT HÀNH hợp lệ - không tự chặn chính mình", () => {
    // Ghi thẳng giá trị mặc định của schema env chứ không đọc env: môi trường
    // test cố tình hạ LLM_MAX_OUTPUT_TOKENS xuống 2048 cho nhẹ, đọc env ở đây
    // là test đi kiểm cấu hình test thay vì cấu hình người dùng thật nhận được.
    assert.deepEqual(
      tuning.validateTuning({
        LLM_TURN_TIMEOUT_MS: 900_000,
        IMAGE_GEN_TIMEOUT_MS: 600_000,
        IMAGE_GEN_STALL_MS: 90_000,
        SEND_DELAY_MIN_MS: 800,
        SEND_DELAY_MAX_MS: 2500,
        DOCUMENT_MAX_CHARS: 20_000,
        LLM_MAX_OUTPUT_TOKENS: 16_384,
      }),
      [],
    );
  });

  it("trần token thấp mà trần tài liệu cao thì chặn - đúng ca môi trường test đang dính", () => {
    const loi = tuning.validateTuning({ DOCUMENT_MAX_CHARS: 20_000, LLM_MAX_OUTPUT_TOKENS: 2048 });
    assert.ok(loi.some((l) => /tài liệu/.test(l)), "2048 token không viết nổi 20.000 ký tự");
  });
});

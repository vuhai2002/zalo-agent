import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

// agent-loop kéo theo env + DB (qua các store) nên setupTestEnv trước, import động sau
let dataDir: string;
let loop: typeof import("./agent-loop.js");

before(async () => {
  dataDir = setupTestEnv();
  loop = await import("./agent-loop.js");
});

after(async () => {
  const { closeDatabase } = await import("../conversation/database.js");
  closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("isEmptyRouterCompletion", () => {
  it("chữ ký glitch 9Router: text rỗng + không tool call + 0 token", () => {
    assert.equal(
      loop.isEmptyRouterCompletion({ text: "", toolCallCount: 0, totalTokens: 0 }),
      true,
    );
    assert.equal(
      loop.isEmptyRouterCompletion({ text: "   ", toolCallCount: 0, totalTokens: 0 }),
      true,
    );
  });

  it("lượt chỉ thả reaction hợp lệ KHÔNG bị coi là glitch (có tool call + token)", () => {
    assert.equal(
      loop.isEmptyRouterCompletion({ text: "", toolCallCount: 1, totalTokens: 850 }),
      false,
    );
  });

  it("lượt trả lời bình thường không phải glitch", () => {
    assert.equal(
      loop.isEmptyRouterCompletion({ text: "Chào bạn", toolCallCount: 0, totalTokens: 1200 }),
      false,
    );
  });

  it("text rỗng nhưng CÓ token: model thật sự chọn im lặng - không phải glitch, không retry oan", () => {
    assert.equal(
      loop.isEmptyRouterCompletion({ text: "", toolCallCount: 0, totalTokens: 900 }),
      false,
    );
  });
});


/**
 * Chạm trần step là ca hỏng THẦM LẶNG nhất: vòng lặp dừng vì hết lượt chứ không
 * phải vì model xong việc, nên `result.text` là text của step đang-gọi-tool. Từ
 * khi persona dạy model kể tiến trình, text đó là câu tường thuật nội bộ kiểu
 * "Đủ 2 nguồn - giờ đối chiếu và trả lời." - gửi thẳng xuống Zalo là người dùng
 * nhận đúng câu đó làm câu trả lời, rồi lượt sau model đọc history tưởng mình đã
 * trả lời xong. Trước khi có persona đó thì text rỗng và bot im lặng.
 */
describe("hitStepLimit - phân biệt hết lượt với xong việc", () => {
  it("đủ step MÀ step cuối vẫn gọi tool = bị cắt ngang", () => {
    assert.equal(loop.hitStepLimit({ stepCount: 8, maxSteps: 8, lastStepToolCalls: 2 }), true);
  });

  it("đủ step nhưng step cuối KHÔNG gọi tool = model chốt kịp, không phải bị cắt", () => {
    assert.equal(loop.hitStepLimit({ stepCount: 8, maxSteps: 8, lastStepToolCalls: 0 }), false);
  });

  it("chưa đủ step thì dù có tool call cũng không phải bị cắt", () => {
    assert.equal(loop.hitStepLimit({ stepCount: 3, maxSteps: 8, lastStepToolCalls: 1 }), false);
  });

  it("maxSteps = 1 - dashboard cho đặt giá trị này, mọi lượt dùng tool đều dính", () => {
    assert.equal(loop.hitStepLimit({ stepCount: 1, maxSteps: 1, lastStepToolCalls: 1 }), true);
  });

  it("lượt trò chuyện thường (1 step, không tool) không bao giờ dính", () => {
    assert.equal(loop.hitStepLimit({ stepCount: 1, maxSteps: 8, lastStepToolCalls: 0 }), false);
  });

  it("vượt quá trần (retry nối thêm step) vẫn nhận ra", () => {
    assert.equal(loop.hitStepLimit({ stepCount: 9, maxSteps: 8, lastStepToolCalls: 1 }), true);
  });
});

describe("canLuotChot - dừng sớm vì BẤT KỲ lý do gì cũng phải chốt lại", () => {
  it("step cuối còn gọi tool = bị cắt ngang, cần lượt chốt", () => {
    assert.equal(loop.canLuotChot({ lastStepToolCalls: 1 }), true);
  });

  it("step cuối không gọi tool = model đã chốt kịp", () => {
    assert.equal(loop.canLuotChot({ lastStepToolCalls: 0 }), false);
  });

  it("KHÔNG đòi đủ step - đây là điểm khác hitStepLimit và là lý do hàm này tồn tại", () => {
    // Lượt dừng vì chạm trần TOKEN có steps.length < maxSteps. Dùng hitStepLimit
    // ở đây sẽ trả false và câu tường thuật nội bộ đi thẳng xuống Zalo.
    assert.equal(loop.hitStepLimit({ stepCount: 3, maxSteps: 8, lastStepToolCalls: 2 }), false);
    assert.equal(loop.canLuotChot({ lastStepToolCalls: 2 }), true);
  });
});

describe("vuotTranToken - điều kiện dừng theo usage THẬT", () => {
  const steps = (...n: number[]) => n.map((inputTokens) => ({ usage: { inputTokens } }));

  it("chưa chạm trần thì chạy tiếp", () => {
    assert.equal(loop.vuotTranToken(10_000)({ steps: steps(3_000, 5_000) }), false);
  });

  it("một step chạm trần là dừng", () => {
    assert.equal(loop.vuotTranToken(10_000)({ steps: steps(3_000, 10_000) }), true);
  });

  it("lấy step NẶNG NHẤT chứ không phải tổng - tràn cửa sổ là chuyện của một lần gọi", () => {
    // Tổng 12.000 vượt trần nhưng không lần gọi nào vượt: không được dừng
    assert.equal(loop.vuotTranToken(10_000)({ steps: steps(4_000, 4_000, 4_000) }), false);
  });

  it("trần <= 0 coi như tắt", () => {
    assert.equal(loop.vuotTranToken(0)({ steps: steps(999_999) }), false);
  });

  it("step thiếu usage (provider không trả) không làm vỡ", () => {
    assert.equal(loop.vuotTranToken(10_000)({ steps: [{}, { usage: {} }] }), false);
  });

  it("chưa có step nào thì chưa dừng", () => {
    assert.equal(loop.vuotTranToken(10_000)({ steps: [] }), false);
  });
});

describe("nhanLyDoDung - nhãn phải kể ĐÚNG một trong ba điều kiện dừng", () => {
  it("guard chặn thì nói là guard, kèm mã để lọc log", () => {
    assert.equal(
      loop.nhanLyDoDung({ maGuardChan: "cung-tool-loi", hetStep: false }),
      "guard chặn (cung-tool-loi)",
    );
  });

  it("guard chặn THẮNG cả khi số step tình cờ cũng vừa chạm trần", () => {
    // Bản nhị phân cũ ghi "hết step" ở đây - đúng một nửa, mà nửa bị mất lại là
    // nửa nói vì sao lượt cụt
    assert.equal(
      loop.nhanLyDoDung({ maGuardChan: "loi-giong-het", hetStep: true }),
      "guard chặn (loi-giong-het)",
    );
  });

  it("không có guard thì phân biệt hết step với chạm trần token", () => {
    assert.equal(loop.nhanLyDoDung({ maGuardChan: null, hetStep: true }), "hết step");
    assert.equal(loop.nhanLyDoDung({ maGuardChan: null, hetStep: false }), "chạm trần token");
    assert.equal(loop.nhanLyDoDung({ hetStep: false }), "chạm trần token");
  });
});

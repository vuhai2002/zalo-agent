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

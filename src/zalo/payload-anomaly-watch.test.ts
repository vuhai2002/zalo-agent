import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { ThreadType } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

let dataDir: string;
let watch: typeof import("./payload-anomaly-watch.js");
let parser: typeof import("./zalo-message-parser.js");

before(async () => {
  dataDir = setupTestEnv();
  watch = await import("./payload-anomaly-watch.js");
  parser = await import("./zalo-message-parser.js");
});

after(() => cleanupTestEnv(dataDir));

beforeEach(() => watch.resetAnomalyThrottle());

function makeMessage(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    accountId: "acc-1",
    threadId: "thread-1",
    threadType: ThreadType.User,
    isGroup: false,
    senderId: "user-1",
    senderName: "Hải",
    text: "hi",
    images: [],
    msgId: "m1",
    cliMsgId: "c1",
    isSelf: false,
    mentionsMe: false,
    rawData: {},
    ...overrides,
  };
}

describe("detectPayloadAnomalies", () => {
  it("payload bình thường không cảnh báo gì", () => {
    assert.deepEqual(watch.detectPayloadAnomalies(makeMessage()), []);
  });

  it("thiếu threadId - đây là ca bot bỏ tin lặng lẽ nên phải bắt được", () => {
    const anomalies = watch.detectPayloadAnomalies(makeMessage({ threadId: "" }));
    assert.equal(anomalies.length, 1);
    assert.match(anomalies[0]!, /threadId/);
  });

  it("thiếu uidFrom mà không phải tin của bot", () => {
    const anomalies = watch.detectPayloadAnomalies(makeMessage({ senderId: "" }));
    assert.match(anomalies[0]!, /uidFrom/);
  });

  it("tin của chính bot thiếu uidFrom là bình thường, không cảnh báo", () => {
    assert.deepEqual(watch.detectPayloadAnomalies(makeMessage({ senderId: "", isSelf: true })), []);
  });

  it("msgType là photo nhưng không moi được URL - dấu hiệu Zalo đổi tên field", () => {
    const msg = makeMessage({ rawData: { msgType: "chat.photo" }, images: [] });
    const anomalies = watch.detectPayloadAnomalies(msg);
    assert.equal(anomalies.length, 1);
    assert.match(anomalies[0]!, /đổi tên field/);
  });

  it("photo có URL thì im lặng", () => {
    const msg = makeMessage({
      rawData: { msgType: "chat.photo" },
      images: [{ url: "https://z.vn/a.jpg" }],
    });
    assert.deepEqual(watch.detectPayloadAnomalies(msg), []);
  });

  it("tin không phải ảnh mà không có images là bình thường", () => {
    const msg = makeMessage({ rawData: { msgType: "webchat" }, images: [] });
    assert.deepEqual(watch.detectPayloadAnomalies(msg), []);
  });

  it("nhiều bất thường cùng lúc thì báo hết", () => {
    const msg = makeMessage({ threadId: "", senderId: "", rawData: { msgType: "chat.photo" } });
    assert.equal(watch.detectPayloadAnomalies(msg).length, 3);
  });

  it("bắt được đúng ca payload rỗng đi qua parser thật", () => {
    // Đây là hình dạng payload khi Zalo đổi cấu trúc: parser trả về toàn rỗng
    const parsed = parser.parseIncomingMessage("acc-1", "self-1", {});
    const anomalies = watch.detectPayloadAnomalies(parsed);
    assert.ok(anomalies.some((a) => /threadId/.test(a)));
    assert.ok(anomalies.some((a) => /uidFrom/.test(a)));
  });
});

describe("reportPayloadAnomalies - chống ngập log", () => {
  const T0 = 1_000_000;

  it("payload hỏng dội liên tục chỉ log 1 lần trong cửa sổ 10 phút", () => {
    const msg = makeMessage({ threadId: "" });

    assert.deepEqual(watch.reportPayloadAnomalies("acc-1", msg, T0).length, 1, "lần đầu phải log");
    for (let i = 1; i < 50; i++) {
      assert.equal(
        watch.reportPayloadAnomalies("acc-1", msg, T0 + i * 1000).length,
        0,
        "trong cửa sổ throttle không được log lại",
      );
    }
  });

  it("hết cửa sổ thì log lại để biết lỗi vẫn còn", () => {
    const msg = makeMessage({ threadId: "" });
    watch.reportPayloadAnomalies("acc-1", msg, T0);

    assert.equal(watch.reportPayloadAnomalies("acc-1", msg, T0 + 9 * 60_000).length, 0);
    assert.equal(watch.reportPayloadAnomalies("acc-1", msg, T0 + 11 * 60_000).length, 1);
  });

  it("account khác nhau throttle riêng - 1 nick hỏng không che lỗi nick kia", () => {
    const msg = makeMessage({ threadId: "" });
    assert.equal(watch.reportPayloadAnomalies("acc-1", msg, T0).length, 1);
    assert.equal(watch.reportPayloadAnomalies("acc-2", msg, T0).length, 1);
  });

  it("loại bất thường khác nhau throttle riêng", () => {
    // threadId rỗng log trước, sau đó thêm lỗi ảnh -> lỗi ảnh vẫn phải log
    watch.reportPayloadAnomalies("acc-1", makeMessage({ threadId: "" }), T0);
    const logged = watch.reportPayloadAnomalies(
      "acc-1",
      makeMessage({ threadId: "", rawData: { msgType: "chat.photo" } }),
      T0 + 1000,
    );
    assert.equal(logged.length, 1);
    assert.match(logged[0]!, /đổi tên field/);
  });
});

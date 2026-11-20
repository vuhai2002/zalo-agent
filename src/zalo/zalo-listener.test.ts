import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { API } from "zca-js";
import { doiChoDenKhi } from "../shared/doi-cho-den-khi.js";
import { moTaLoiListener, startListener } from "./zalo-listener.js";

/**
 * Websocket lỗi KHÔNG được làm sập tiến trình, và vòng nối lại phải chạy tiếp.
 *
 * Ca thật 2026-11-19: DNS của VPS chết vài phút, listener nối lại websocket bị
 * lỗi `getaddrinfo`, zca-js `emit("error")` mà không ai nghe -> Node ném ->
 * `uncaughtException` -> container restart -> lúc boot DNS vẫn chết nên account
 * cá nhân bị bỏ qua vĩnh viễn.
 *
 * Dùng class `Listener` THẬT của zca-js + thư viện ws thật, nối tới một cổng
 * đóng trên 127.0.0.1. Lỗi là ECONNREFUSED chứ không phải EAI_AGAIN, nhưng ws
 * xử MỌI lỗi của request bắt tay qua CÙNG một đường với prod:
 * `req.on('error')` -> `emitErrorAndClose` -> `ws.onerror` -> `emit("error")`.
 * Không dùng tên miền `.invalid`: đo trên Windows, phân giải nó treo quá 15s.
 * Một listener giả tự `emit` thì chỉ đo lại mô hình của chính mình về zca-js.
 * `Listener` không được export ở gốc gói (exports map chặn đường sâu) nên nạp
 * thẳng file cạnh entry của gói.
 */
const { Listener } = (await import(new URL("./apis/listen.js", import.meta.resolve("zca-js")).href)) as {
  Listener: new (ctx: unknown, urls: string[]) => API["listener"];
};

/** Ngữ cảnh tối thiểu để constructor + `start()` của Listener chạy được */
function nguCanhGia(): unknown {
  return {
    cookie: { getCookieStringSync: () => "" },
    userAgent: "zalo-agent-test",
    API_VERSION: 1,
    API_TYPE: 1,
    options: { selfListen: false, agent: undefined },
    settings: {
      features: {
        socket: { retries: {}, close_and_retry_codes: [], rotate_error_codes: [], ping_interval: 600_000 },
      },
    },
  };
}

describe("listener: websocket lỗi không làm sập tiến trình", () => {
  it("nối lỗi: lỗi được nghe, close vẫn tới, vòng nối lại tự mở kết nối mới", async () => {
    const listener = new Listener(nguCanhGia(), ["ws://127.0.0.1:1/"]);
    // "disconnected" phát MỖI lần ws đóng (trước nhánh retryOnClose của zca-js),
    // tức đếm được số lần thử kết nối đã đi trọn tới bước close.
    let soLanDong = 0;
    let soLanLoi = 0;
    listener.on("disconnected", () => {
      soLanDong += 1;
    });
    // Đếm lỗi qua callback CŨ `onError`, TUYỆT ĐỐI không qua `on("error")`: một
    // người nghe "error" do test gắn là đủ để EventEmitter không ném nữa, và ca
    // này xanh cả khi `startListener` quên nghe - đúng thứ nó sinh ra để bắt.
    listener.onError(() => {
      soLanLoi += 1;
    });

    const dung = startListener("acc-test-dns", { listener } as unknown as API, () => {});
    try {
      // Lần 1 đóng = lỗi không chặn ngang `emitClose`. Lần 2 đóng = `onClosed`
      // của mình đã lên lịch và `start()` lại thật (backoff đầu ~1-2s).
      await doiChoDenKhi(() => soLanDong >= 2, {
        tranMs: 15_000,
        moTa: "listener đóng 2 lần (lỗi đầu không chặn vòng nối lại)",
      });
      assert.ok(soLanLoi >= 1, "không có lỗi websocket nào - ca này không đi đúng đường DNS hỏng");
    } finally {
      dung();
    }
  });
});

describe("moTaLoiListener", () => {
  it("rút message + mã từ ErrorEvent của ws (pino ghi ErrorEvent thành {})", () => {
    const suKien = { message: "getaddrinfo EAI_AGAIN wpa.chat.zalo.me", error: { code: "EAI_AGAIN" } };
    assert.equal(moTaLoiListener(suKien), "getaddrinfo EAI_AGAIN wpa.chat.zalo.me (EAI_AGAIN)");
  });

  it("Error thường (giải mã gói tin hỏng) và giá trị lạ", () => {
    assert.equal(moTaLoiListener(new Error("Unexpected token")), "Unexpected token");
    assert.equal(moTaLoiListener({}), "không rõ");
    assert.equal(moTaLoiListener(undefined), "undefined");
  });
});

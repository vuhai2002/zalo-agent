import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { APICallError, RetryError } from "ai";
import {
  giayChoLai,
  maHttpCua,
  nenThuLai,
  phanLoaiLoiProvider,
} from "./provider-error-classifier.js";
import { isImageRejectionError } from "./vision-rejection-fallback.js";
import { LoiCauHinhLlm } from "./llm-config-error.js";

/** Module thuần - không cần setupTestEnv, không cần import động */

const loiApi = (statusCode: number, message: string, headers?: Record<string, string>) =>
  new APICallError({
    message,
    url: "https://router.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseHeaders: headers,
    responseBody: message,
  });

describe("phanLoaiLoiProvider - theo mã HTTP", () => {
  it("429 là hết quota / bị siết nhịp", () => {
    assert.equal(phanLoaiLoiProvider(loiApi(429, "Rate limit exceeded")), "rate_limit");
  });

  it("401 và 403 là sai khóa hoặc thiếu quyền", () => {
    assert.equal(phanLoaiLoiProvider(loiApi(401, "Invalid API key")), "auth");
    assert.equal(phanLoaiLoiProvider(loiApi(403, "Forbidden")), "auth");
  });

  it("5xx là lỗi tạm", () => {
    assert.equal(phanLoaiLoiProvider(loiApi(500, "Internal error")), "transient");
    assert.equal(phanLoaiLoiProvider(loiApi(503, "Upstream unavailable")), "transient");
  });

  it("400 KHÔNG kèm dấu hiệu tràn context thì là unknown, không phải context_overflow", () => {
    assert.equal(phanLoaiLoiProvider(loiApi(400, "Invalid value for 'temperature'")), "unknown");
  });
});

describe("phanLoaiLoiProvider - tràn context", () => {
  it("nhận ra qua thông báo, vì provider nào cũng trả 400 chung", () => {
    for (const msg of [
      "This model's maximum context length is 128000 tokens",
      "prompt is too long: 210000 tokens",
      "Request exceeds the maximum allowed tokens",
      "Please reduce the length of the messages",
      "input exceeds context window",
    ]) {
      assert.equal(phanLoaiLoiProvider(loiApi(400, msg)), "context_overflow", msg);
    }
  });

  it("chữ 'too long' trong lỗi 5xx KHÔNG bị bắt nhầm", () => {
    // Gateway trả trang HTML 502 có chữ "too long" trong nội dung - cắt ngữ cảnh
    // rồi thử lại là chữa nhầm bệnh
    assert.equal(phanLoaiLoiProvider(loiApi(502, "Gateway timeout, request too long")), "transient");
  });

  it("gateway ném lỗi không kèm mã vẫn nhận ra được", () => {
    assert.equal(phanLoaiLoiProvider(new Error("context length exceeded")), "context_overflow");
  });
});

describe("phanLoaiLoiProvider - lỗi mạng", () => {
  it("các mã lỗi socket quen thuộc là transient", () => {
    for (const msg of [
      "connect ECONNREFUSED 127.0.0.1:443",
      "read ECONNRESET",
      "getaddrinfo ENOTFOUND router.test",
      "socket hang up",
      "The operation was aborted",
    ]) {
      assert.equal(phanLoaiLoiProvider(new Error(msg)), "transient", msg);
    }
  });

  it("đọc cả `cause` - lỗi mạng thật thường bị bọc trong TypeError: fetch failed", () => {
    // Đây là hình dạng THẬT của undici: message ngoài chỉ có "fetch failed",
    // mã lỗi nằm ở cause. Không đọc cause là bỏ sót đúng ca hay gặp nhất.
    const boc = new Error("fetch failed");
    (boc as { cause?: unknown }).cause = new Error("connect ECONNREFUSED 10.0.0.1:443");
    assert.equal(phanLoaiLoiProvider(boc), "transient");
  });
});

describe("bóc lớp bọc RetryError - hình dạng THẬT của lỗi retry được", () => {
  // Đo trên ai@7.0.37: SDK tự retry 429 và 5xx (3 lần gọi) rồi ném RetryError,
  // KHÔNG ném APICallError. RetryError không có statusCode, nên thiếu bước bóc
  // là bộ phân loại mù hoàn toàn với đúng hai loại hay gặp nhất.
  const boc = (goc: unknown) =>
    new RetryError({ message: "Failed after 3 attempts.", reason: "maxRetriesExceeded", errors: [goc] });

  it("429 bị bọc vẫn ra rate_limit", () => {
    assert.equal(phanLoaiLoiProvider(boc(loiApi(429, "Rate limit"))), "rate_limit");
  });

  it("500 bị bọc vẫn ra transient", () => {
    assert.equal(phanLoaiLoiProvider(boc(loiApi(500, "Internal"))), "transient");
  });

  it("maHttpCua đọc được mã qua lớp bọc", () => {
    assert.equal(maHttpCua(boc(loiApi(429, "x"))), 429);
  });

  it("giayChoLai đọc được Retry-After qua lớp bọc", () => {
    assert.equal(giayChoLai(boc(loiApi(429, "x", { "retry-after": "7" }))), 7);
  });

  it("RetryError rỗng (không có lastError) không làm vỡ", () => {
    const rong = new RetryError({ message: "x", reason: "maxRetriesExceeded", errors: [] });
    assert.doesNotThrow(() => phanLoaiLoiProvider(rong));
  });
});

describe("phanLoaiLoiProvider - đầu vào lạ không được làm vỡ", () => {
  it("null, undefined, chuỗi, số, object rỗng", () => {
    for (const x of [null, undefined, "", 123, {}, [], true]) {
      assert.doesNotThrow(() => phanLoaiLoiProvider(x), `ném với ${JSON.stringify(x)}`);
    }
    assert.equal(phanLoaiLoiProvider(null), "unknown");
    assert.equal(phanLoaiLoiProvider(undefined), "unknown");
  });

  it("chuỗi thuần vẫn dò được nội dung", () => {
    assert.equal(phanLoaiLoiProvider("ECONNRESET"), "transient");
    assert.equal(phanLoaiLoiProvider("maximum context length exceeded"), "context_overflow");
  });

  it("object tự chế có statusCode vẫn đọc được", () => {
    assert.equal(phanLoaiLoiProvider({ statusCode: 429, message: "slow down" }), "rate_limit");
    assert.equal(phanLoaiLoiProvider({ status: 401, message: "nope" }), "auth");
  });
});

describe("KHÔNG được giẫm chân bộ phân loại lỗi ảnh", () => {
  it("lỗi từ chối ảnh (400) vẫn được isImageRejectionError nhận ra", () => {
    // Bất biến sống còn: nhánh fallback ảnh phải được kiểm TRƯỚC trong
    // agent-loop. Lỗi ảnh cũng là 400, nếu để bộ phân loại mới chạy trước thì
    // nó ra "unknown" và nhánh bỏ pixel không bao giờ chạy.
    const loiAnh = loiApi(400, "Invalid image content");
    assert.equal(isImageRejectionError(loiAnh), true);
    assert.equal(phanLoaiLoiProvider(loiAnh), "unknown", "bộ mới KHÔNG nhận ra lỗi ảnh - đúng như thiết kế");
  });

  it("401 và 429 không bị nhánh ảnh bắt, nên hai bộ không tranh nhau", () => {
    assert.equal(isImageRejectionError(loiApi(401, "x")), false);
    assert.equal(isImageRejectionError(loiApi(429, "x")), false);
  });
});

describe("nenThuLai", () => {
  it("chỉ auth là KHÔNG thử lại - thử lại sai khóa chỉ chậm gấp ba rồi vẫn hỏng", () => {
    assert.equal(nenThuLai("auth"), false);
    for (const l of ["rate_limit", "context_overflow", "transient", "unknown"] as const) {
      assert.equal(nenThuLai(l), true, l);
    }
  });
});

describe("giayChoLai", () => {
  it("đọc Retry-After dạng số giây", () => {
    assert.equal(giayChoLai(loiApi(429, "x", { "retry-after": "12" })), 12);
  });

  it("đọc Retry-After dạng mốc thời gian HTTP", () => {
    const sau5s = new Date(Date.now() + 5000).toUTCString();
    const g = giayChoLai(loiApi(429, "x", { "retry-after": sau5s }));
    assert.ok(g !== undefined && g >= 4 && g <= 6, `mong 4-6 giây, nhận ${g}`);
  });

  it("kẹp trần 60 giây - chờ lâu hơn là lượt đã chạm trần thời gian và khóa thread", () => {
    assert.equal(giayChoLai(loiApi(429, "x", { "retry-after": "3600" })), 60);
  });

  it("không có header, header rác, hay lỗi không phải APICallError thì trả undefined", () => {
    assert.equal(giayChoLai(loiApi(429, "x")), undefined);
    assert.equal(giayChoLai(loiApi(429, "x", { "retry-after": "khong-phai-so" })), undefined);
    assert.equal(giayChoLai(new Error("x")), undefined);
    assert.equal(giayChoLai(null), undefined);
  });

  it("mốc thời gian đã qua thì trả 0, không trả số âm", () => {
    const truoc = new Date(Date.now() - 60_000).toUTCString();
    assert.equal(giayChoLai(loiApi(429, "x", { "retry-after": truoc })), 0);
  });
});

describe("maHttpCua", () => {
  it("đọc từ APICallError và từ object tự chế; không có thì undefined", () => {
    assert.equal(maHttpCua(loiApi(418, "x")), 418);
    assert.equal(maHttpCua({ status: 500 }), 500);
    assert.equal(maHttpCua(new Error("x")), undefined);
    assert.equal(maHttpCua("chuoi"), undefined);
  });
});

describe("cau_hinh - CHÍNH MÌNH chưa cấu hình xong", () => {
  it("LoiCauHinhLlm ra 'cau_hinh', KHÔNG phải 'unknown'", () => {
    // Rơi vào `unknown` thì `cauLoiTheoLoai` trả câu "bạn nhắn lại sau ít phút"
    // - nói dối, vì chưa nhập cấu hình thì chờ bao lâu cũng không tự hết. Và
    // trạng thái này KHÔNG hiếm nữa từ khi .env chỉ còn một biến bắt buộc: bot
    // khởi động được khi chưa cấu hình gì, nên MỌI tin nhắn đều đi qua đây.
    for (const loai of ["api_key", "model", "base_url"] as const) {
      const err = new LoiCauHinhLlm(loai, "Chưa cấu hình gì đó");
      assert.equal(phanLoaiLoiProvider(err), "cau_hinh", loai);
    }
  });

  it("KHÔNG thử lại - thử lại chỉ chậm gấp ba rồi vẫn hỏng", () => {
    assert.equal(nenThuLai("cau_hinh"), false);
  });

  it("nhận diện qua HÌNH DẠNG, sống sót khi có hai bản sao module", () => {
    // `instanceof` trần vỡ khi pnpm layout hay `await import()` động nạp hai bản
    assert.equal(LoiCauHinhLlm.isInstance({ name: "LoiCauHinhLlm" }), true);
    assert.equal(LoiCauHinhLlm.isInstance(new Error("x")), false);
    assert.equal(LoiCauHinhLlm.isInstance(null), false);
  });

  it("lỗi thường có cùng CHỮ vẫn ra unknown - không dò câu chữ", () => {
    // Nếu ai đó chữa bằng cách dò chuỗi "Chưa cấu hình" thì ca này đỏ
    assert.equal(phanLoaiLoiProvider(new Error("Chưa cấu hình LLM API key")), "unknown");
  });
});

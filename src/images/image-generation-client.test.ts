import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let client: typeof import("./image-generation-client.js");
let database: typeof import("../conversation/database.js");

const SETTINGS = { baseUrl: "https://router.test", model: "cx/gpt-5.5-image", apiKey: "sk-test" };

/** Response giả dạng binary - đúng thứ router trả khi có ?response_format=binary */
function binaryResponse(bytes: Buffer, mime = "image/jpeg"): Response {
  return new Response(bytes, { status: 200, headers: { "Content-Type": mime } });
}

/** Dựng stream SSE đúng định dạng router trả (đã đọc stream thật để đối chiếu) */
function sseResponse(...blocks: string[]): Response {
  return new Response(`${blocks.join("\n\n")}\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const sseDone = (b64: string) =>
  `event: done\ndata: ${JSON.stringify({ created: 1, data: [{ b64_json: b64 }] })}`;
const SSE_PROGRESS = 'event: progress\ndata: {"stage":"response.created","bytesReceived":1393}';

/** Response JSON thường - provider không hỗ trợ SSE thì router trả dạng này */
function jsonResponse(b64: string): Response {
  return new Response(JSON.stringify({ created: 1, data: [{ b64_json: b64 }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Bắt lại request để khẳng định client gửi đúng cái gì */
function captureFetch(response: Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response;
  };
  return { calls, impl: impl as unknown as typeof fetch };
}

before(async () => {
  dataDir = setupTestEnv({ IMAGE_GEN_BASE_URL: "", IMAGE_GEN_MODEL: "", IMAGE_GEN_API_KEY: "" });
  client = await import("./image-generation-client.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const JPEG_B64 = JPEG.toString("base64");
const okSse = () => sseResponse(SSE_PROGRESS, sseDone(JPEG_B64));

describe("generateImage - dựng request", () => {
  it("XIN SSE bằng header Accept - đây là thứ cứu khỏi 524 của Cloudflare", async () => {
    const { calls, impl } = captureFetch(okSse());
    await client.generateImage({ prompt: "con mèo" }, SETTINGS, impl);

    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers["Accept"], "text/event-stream");
  });

  it("KHÔNG kèm response_format=binary - router chỉ stream khi không xin binary", async () => {
    const { calls, impl } = captureFetch(okSse());
    await client.generateImage({ prompt: "con mèo" }, SETTINGS, impl);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "https://router.test/v1/images/generations");
  });

  it("cắt dấu / thừa ở cuối base URL, không thành //v1", async () => {
    const { calls, impl } = captureFetch(okSse());
    await client.generateImage({ prompt: "x" }, { ...SETTINGS, baseUrl: "https://router.test/" }, impl);
    assert.ok(!calls[0]!.url.includes("//v1"), calls[0]!.url);
  });

  it("gửi Bearer key và body có model + prompt", async () => {
    const { calls, impl } = captureFetch(okSse());
    await client.generateImage({ prompt: "một ly cà phê" }, SETTINGS, impl);

    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers["Authorization"], "Bearer sk-test");
    const body = JSON.parse(String(calls[0]!.init.body));
    assert.equal(body.model, "cx/gpt-5.5-image");
    assert.equal(body.prompt, "một ly cà phê");
  });

  it("KHÔNG gửi size: model bỏ qua tham số này (đo thật: xin 1024x1024 nhận 1536x1024)", async () => {
    const { calls, impl } = captureFetch(okSse());
    await client.generateImage({ prompt: "x" }, SETTINGS, impl);
    assert.equal(JSON.parse(String(calls[0]!.init.body)).size, undefined);
  });

  it("gửi quality theo env - bỏ trống thì provider tự chọn mức thấp hơn", async () => {
    // Đo A/B cùng prompt: có quality=high ra ảnh giàu chi tiết hơn hẳn (khối
    // phát sáng, lớp sóng hạt, nhiều tầng biểu đồ) mà KHÔNG chậm hơn.
    const { calls, impl } = captureFetch(okSse());
    await client.generateImage({ prompt: "x" }, SETTINGS, impl);
    assert.equal(JSON.parse(String(calls[0]!.init.body)).quality, "high");
  });

  it("mặc định JPEG - nhẹ hơn PNG hàng chục lần", async () => {
    const { calls, impl } = captureFetch(okSse());
    const result = await client.generateImage({ prompt: "x" }, SETTINGS, impl);
    assert.equal(JSON.parse(String(calls[0]!.init.body)).output_format, "jpeg");
    assert.equal(result.ext, "jpg", "SSE không mang Content-Type riêng cho ảnh - đuôi lấy theo format đã xin");
  });

  it("nền trong suốt ép sang PNG - JPEG không có kênh alpha", async () => {
    const { calls, impl } = captureFetch(okSse());
    const result = await client.generateImage({ prompt: "logo", transparentBackground: true }, SETTINGS, impl);

    const body = JSON.parse(String(calls[0]!.init.body));
    assert.equal(body.output_format, "png");
    assert.equal(body.background, "transparent");
    assert.equal(result.ext, "png");
  });
});

describe("generateImage - đọc stream SSE", () => {
  it("lấy ảnh từ event done, bỏ qua progress và partial_image", async () => {
    const { impl } = captureFetch(
      sseResponse(
        SSE_PROGRESS,
        'event: partial_image\ndata: {"b64_json":"AAAA","index":0}',
        SSE_PROGRESS,
        sseDone(JPEG_B64),
      ),
    );
    const result = await client.generateImage({ prompt: "x" }, SETTINGS, impl);
    assert.deepEqual(result.data, JPEG, "partial_image là ảnh dở dang - lấy nhầm là gửi ảnh chưa vẽ xong");
  });

  it("event error trong stream -> ném lỗi kèm đúng câu của provider", async () => {
    const { impl } = captureFetch(
      sseResponse(SSE_PROGRESS, 'event: error\ndata: {"message":"Account may not be entitled (Plus/Pro required)."}'),
    );
    await assert.rejects(() => client.generateImage({ prompt: "x" }, SETTINGS, impl), /Plus\/Pro required/);
  });

  it("stream kết thúc mà không có done -> lỗi rõ ràng, không trả file rỗng", async () => {
    const { impl } = captureFetch(sseResponse(SSE_PROGRESS, SSE_PROGRESS));
    await assert.rejects(() => client.generateImage({ prompt: "x" }, SETTINGS, impl), /không trả về ảnh/i);
  });

  it("lỗi giữa chừng vẫn ĐÓNG stream - bot chạy thường trú, bỏ mặc là rò rỉ kết nối", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('event: error\ndata: {"message":"provider hỏng"}\n\n'));
        // KHÔNG close: mô phỏng stream còn dở khi mình bỏ đi giữa chừng
      },
      cancel() {
        cancelled = true;
      },
    });
    const { impl } = captureFetch(
      new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );

    await assert.rejects(() => client.generateImage({ prompt: "x" }, SETTINGS, impl), /provider hỏng/);
    assert.equal(cancelled, true, "phải cancel reader khi thoát sớm");
  });

  it("block SSE bị chẻ làm đôi giữa 2 chunk mạng vẫn ghép lại đúng", async () => {
    const full = `${SSE_PROGRESS}\n\n${sseDone(JPEG_B64)}\n\n`;
    const cut = Math.floor(full.length / 2);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(full.slice(0, cut)));
        controller.enqueue(enc.encode(full.slice(cut)));
        controller.close();
      },
    });
    const { impl } = captureFetch(
      new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );
    const result = await client.generateImage({ prompt: "x" }, SETTINGS, impl);
    assert.deepEqual(result.data, JPEG);
  });
});

describe("generateImage - provider không stream", () => {
  it("router trả JSON thường vẫn đọc được b64_json", async () => {
    const { impl } = captureFetch(jsonResponse(JPEG_B64));
    const result = await client.generateImage({ prompt: "x" }, SETTINGS, impl);
    assert.deepEqual(result.data, JPEG);
  });

  it("router trả thẳng bytes ảnh vẫn dùng được, đuôi theo Content-Type", async () => {
    const { impl } = captureFetch(binaryResponse(JPEG, "image/png"));
    const result = await client.generateImage({ prompt: "x" }, SETTINGS, impl);
    assert.deepEqual(result.data, JPEG);
    assert.equal(result.ext, "png");
  });
});

describe("generateImage - ảnh gốc để sửa", () => {
  it("ảnh gốc thành data URI ở trường `image` (KHÔNG phải ref_image)", async () => {
    const { calls, impl } = captureFetch(okSse());
    await client.generateImage(
      { prompt: "đổi mũ thành beret đỏ", refImage: { base64: "QUJD", mediaType: "image/png" } },
      SETTINGS,
      impl,
    );

    const body = JSON.parse(String(calls[0]!.init.body));
    assert.equal(body.image, "data:image/png;base64,QUJD");
    assert.equal(body.ref_image, undefined, "tên trường sai sẽ bị provider bỏ qua âm thầm");
    assert.equal(body.image_detail, "high", "đọc kỹ ảnh gốc thì mới sửa đúng chi tiết");
  });

  it("không có ảnh gốc thì không gửi trường image", async () => {
    const { calls, impl } = captureFetch(okSse());
    await client.generateImage({ prompt: "vẽ mới" }, SETTINGS, impl);
    assert.equal("image" in JSON.parse(String(calls[0]!.init.body)), false);
  });
});

describe("generateImage - kiểu response lạ", () => {
  it("Content-Type không phải ảnh/SSE/JSON -> lỗi rõ ràng, không ghi file rác", async () => {
    const html = new Response("<html>trang lỗi của proxy</html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
    const { impl } = captureFetch(html);
    await assert.rejects(() => client.generateImage({ prompt: "x" }, SETTINGS, impl), /không trả về ảnh/i);
  });
});

describe("generateImage - đường lỗi", () => {
  it("lỗi 400: error là OBJECT có .message", async () => {
    const res = new Response(JSON.stringify({ error: { message: "Missing required field: prompt" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
    const { impl } = captureFetch(res);
    await assert.rejects(() => client.generateImage({ prompt: "x" }, SETTINGS, impl), /Missing required field/);
  });

  it("lỗi 401: error là CHUỖI - dạng khác hẳn 400, parser chỉ đọc .message sẽ ra undefined", async () => {
    const res = new Response(JSON.stringify({ error: "API key required for remote API access" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
    const { impl } = captureFetch(res);
    await assert.rejects(
      () => client.generateImage({ prompt: "x" }, SETTINGS, impl),
      (err: Error) => {
        assert.match(err.message, /API key required/);
        assert.doesNotMatch(err.message, /undefined/);
        return true;
      },
    );
  });

  it("body lỗi không phải JSON vẫn ném lỗi kèm mã HTTP", async () => {
    const res = new Response("<html>502 Bad Gateway</html>", { status: 502 });
    const { impl } = captureFetch(res);
    await assert.rejects(() => client.generateImage({ prompt: "x" }, SETTINGS, impl), /502/);
  });

  it("quá hạn ngay khi gọi -> câu tiếng Việt nói rõ là timeout, không phải AbortError trần trụi", async () => {
    const impl = (async () => {
      throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    }) as unknown as typeof fetch;
    await assert.rejects(() => client.generateImage({ prompt: "x" }, SETTINGS, impl), /quá lâu|quá hạn/i);
  });

  it("quá hạn GIỮA CHỪNG lúc đọc stream cũng phải ra câu tiếng Việt đó", async () => {
    // Đây mới là ca dễ xảy ra nhất với SSE: fetch trả về sau ~1.8 giây rồi mình
    // đọc stream thêm cả phút. Nếu chỉ bọc try/catch quanh fetch thì abort lúc
    // đang đọc lọt ra ngoài dạng "This operation was aborted" trần trụi.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${SSE_PROGRESS}\n\n`));
      },
      pull() {
        throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
      },
    });
    const { impl } = captureFetch(
      new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );
    await assert.rejects(() => client.generateImage({ prompt: "x" }, SETTINGS, impl), /quá lâu|quá hạn/i);
  });

  it("chưa cấu hình đủ 3 trường thì báo lỗi NGAY, không gọi mạng", async () => {
    const { calls, impl } = captureFetch(okSse());
    await assert.rejects(
      () => client.generateImage({ prompt: "x" }, { ...SETTINGS, apiKey: "" }, impl),
      /chưa cấu hình/i,
    );
    assert.equal(calls.length, 0);
  });
});

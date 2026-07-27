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

describe("generateImage - dựng request", () => {
  it("gọi đúng endpoint kèm response_format=binary (nhẹ hơn base64 15 lần)", async () => {
    const { calls, impl } = captureFetch(binaryResponse(Buffer.from([1, 2, 3])));
    await client.generateImage({ prompt: "con mèo" }, SETTINGS, impl);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "https://router.test/v1/images/generations?response_format=binary");
  });

  it("cắt dấu / thừa ở cuối base URL, không thành //v1", async () => {
    const { calls, impl } = captureFetch(binaryResponse(Buffer.from([1])));
    await client.generateImage({ prompt: "x" }, { ...SETTINGS, baseUrl: "https://router.test/" }, impl);
    assert.ok(!calls[0]!.url.includes("//v1"), calls[0]!.url);
  });

  it("gửi Bearer key và body có model + prompt", async () => {
    const { calls, impl } = captureFetch(binaryResponse(Buffer.from([1])));
    await client.generateImage({ prompt: "một ly cà phê" }, SETTINGS, impl);

    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers["Authorization"], "Bearer sk-test");
    const body = JSON.parse(String(calls[0]!.init.body));
    assert.equal(body.model, "cx/gpt-5.5-image");
    assert.equal(body.prompt, "một ly cà phê");
  });

  it("KHÔNG gửi size: model bỏ qua tham số này (đo thật: xin 1024x1024 nhận 1536x1024)", async () => {
    const { calls, impl } = captureFetch(binaryResponse(Buffer.from([1])));
    await client.generateImage({ prompt: "x" }, SETTINGS, impl);
    assert.equal(JSON.parse(String(calls[0]!.init.body)).size, undefined);
  });

  it("mặc định JPEG - 157KB so với 2.4MB của PNG cùng ảnh", async () => {
    const { calls, impl } = captureFetch(binaryResponse(Buffer.from([1])));
    await client.generateImage({ prompt: "x" }, SETTINGS, impl);
    assert.equal(JSON.parse(String(calls[0]!.init.body)).output_format, "jpeg");
  });

  it("nền trong suốt ép sang PNG - JPEG không có kênh alpha", async () => {
    const { calls, impl } = captureFetch(binaryResponse(Buffer.from([1]), "image/png"));
    const result = await client.generateImage({ prompt: "logo", transparentBackground: true }, SETTINGS, impl);

    const body = JSON.parse(String(calls[0]!.init.body));
    assert.equal(body.output_format, "png");
    assert.equal(body.background, "transparent");
    assert.equal(result.ext, "png");
  });
});

describe("generateImage - ảnh gốc để sửa", () => {
  it("ảnh gốc thành data URI ở trường `image` (KHÔNG phải ref_image)", async () => {
    const { calls, impl } = captureFetch(binaryResponse(Buffer.from([1])));
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
    const { calls, impl } = captureFetch(binaryResponse(Buffer.from([1])));
    await client.generateImage({ prompt: "vẽ mới" }, SETTINGS, impl);
    assert.equal("image" in JSON.parse(String(calls[0]!.init.body)), false);
  });
});

describe("generateImage - đọc kết quả", () => {
  it("trả về Buffer đúng bytes và đuôi file theo Content-Type", async () => {
    const pixels = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const { impl } = captureFetch(binaryResponse(pixels));
    const result = await client.generateImage({ prompt: "x" }, SETTINGS, impl);

    assert.deepEqual(result.data, pixels);
    assert.equal(result.ext, "jpg");
  });

  it("Content-Type png trả đuôi png", async () => {
    const { impl } = captureFetch(binaryResponse(Buffer.from([0x89, 0x50]), "image/png"));
    assert.equal((await client.generateImage({ prompt: "x" }, SETTINGS, impl)).ext, "png");
  });

  it("router trả JSON thay vì ảnh (binary không được hỗ trợ) -> lỗi rõ ràng, không trả file rác", async () => {
    const json = new Response(JSON.stringify({ data: [{ b64_json: "AAA" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const { impl } = captureFetch(json);
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

  it("quá hạn chờ -> câu tiếng Việt nói rõ là timeout, không phải AbortError trần trụi", async () => {
    const impl = (async () => {
      throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    }) as unknown as typeof fetch;
    await assert.rejects(() => client.generateImage({ prompt: "x" }, SETTINGS, impl), /quá lâu|quá hạn/i);
  });

  it("chưa cấu hình đủ 3 trường thì báo lỗi NGAY, không gọi mạng", async () => {
    const { calls, impl } = captureFetch(binaryResponse(Buffer.from([1])));
    await assert.rejects(
      () => client.generateImage({ prompt: "x" }, { ...SETTINGS, apiKey: "" }, impl),
      /chưa cấu hình/i,
    );
    assert.equal(calls.length, 0);
  });
});

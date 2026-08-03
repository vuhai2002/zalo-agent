import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BASE_URL_PRESETS, timPreset, TU_NHAP } from "./llm-base-url-presets";

describe("BASE_URL_PRESETS", () => {
  it("mọi URL đều bắt đầu bằng http - server chặn dạng khác", () => {
    // `updateSchema` ở provider-routes.ts dùng `.startsWith("http")`. Một mục
    // sai dạng ở đây là chọn xong bấm Lưu thì ăn 400, không hiểu vì sao.
    for (const p of BASE_URL_PRESETS) {
      assert.ok(p.baseUrl.startsWith("http"), `${p.label}: "${p.baseUrl}"`);
    }
  });

  it("KHÔNG có dấu gạch cuối - SDK nối thẳng '/chat/completions' vào sau", () => {
    for (const p of BASE_URL_PRESETS) {
      assert.ok(!p.baseUrl.endsWith("/"), `${p.label} thừa dấu gạch cuối`);
    }
  });

  it("không có URL hay tên hãng trùng nhau", () => {
    const urls = BASE_URL_PRESETS.map((p) => p.baseUrl);
    const nhan = BASE_URL_PRESETS.map((p) => p.label);
    assert.equal(new Set(urls).size, urls.length, "có base URL trùng");
    assert.equal(new Set(nhan).size, nhan.length, "có tên hãng trùng");
  });

  it("không mục nào trùng giá trị 'Tự nhập' - trùng là chọn xong không có tác dụng", () => {
    assert.ok(!BASE_URL_PRESETS.some((p) => p.baseUrl === TU_NHAP));
  });
});

describe("timPreset", () => {
  it("khớp đúng URL trong danh sách", () => {
    assert.equal(timPreset("https://api.deepseek.com"), "https://api.deepseek.com");
    assert.equal(timPreset("https://api.moonshot.ai/v1"), "https://api.moonshot.ai/v1");
  });

  it("bỏ qua dấu gạch cuối - tài liệu Gemini ghi hẳn URL có gạch cuối", () => {
    const gemini = "https://generativelanguage.googleapis.com/v1beta/openai";
    assert.equal(timPreset(gemini + "/"), gemini);
    assert.equal(timPreset(gemini + "///"), gemini);
  });

  it("bỏ qua hoa thường và khoảng trắng thừa khi dán từ tài liệu", () => {
    assert.equal(timPreset("  https://API.X.AI/v1  "), "https://api.x.ai/v1");
  });

  it("URL lạ (router riêng) thì về Tự nhập, KHÔNG đoán bừa mục gần giống", () => {
    assert.equal(timPreset("https://9router.example.io.vn/v1"), TU_NHAP);
    // Tiền tố trùng nhưng không phải cùng một endpoint
    assert.equal(timPreset("https://api.deepseek.com/beta"), TU_NHAP);
  });

  it("chuỗi rỗng thì về Tự nhập", () => {
    assert.equal(timPreset(""), TU_NHAP);
    assert.equal(timPreset("   "), TU_NHAP);
  });
});

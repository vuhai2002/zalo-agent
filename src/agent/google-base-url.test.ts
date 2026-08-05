import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Base URL cũ NẰM LẠI trong DB khi người dùng đổi ô "Kiểu kết nối" - form chỉ
 * ẩn ô đi chứ không xóa giá trị. Hai kiểu hỏng sinh ra từ đó:
 *
 *   - Đuôi "/openai": lớp giả OpenAI của Google, không phải API riêng mà
 *     provider này nói. Người dùng cũ CHẮC CHẮN có đuôi này vì nút chọn nhanh
 *     "Google Gemini" từng điền đúng URL đó.
 *   - URL của hãng KHÁC (OpenRouter, 9Router): gửi khóa Google sang đó là vừa
 *     lộ khóa sang bên thứ ba vừa nhận 401 khó hiểu.
 */

let dataDir: string;
let provider: typeof import("./llm-provider.js");

before(async () => {
  dataDir = setupTestEnv();
  provider = await import("./llm-provider.js");
});

after(async () => {
  const { closeDatabase } = await import("../conversation/database.js");
  closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("baseUrlChoGoogle", () => {
  const GOC = "https://generativelanguage.googleapis.com/v1beta";

  it("gỡ đuôi /openai - đó là lớp giả, trỏ vào là 404", () => {
    assert.equal(provider.baseUrlChoGoogle(`${GOC}/openai`), GOC);
    assert.equal(provider.baseUrlChoGoogle(`${GOC}/OpenAI`), GOC);
  });

  it("gỡ cả gạch cuối lẫn /openai khi dán từ tài liệu", () => {
    assert.equal(provider.baseUrlChoGoogle(`${GOC}/openai/`), GOC);
    assert.equal(provider.baseUrlChoGoogle(`${GOC}/openai///`), GOC);
    assert.equal(provider.baseUrlChoGoogle(`  ${GOC}/openai  `), GOC);
  });

  it("URL đúng dạng API riêng thì giữ nguyên", () => {
    assert.equal(provider.baseUrlChoGoogle(GOC), GOC);
  });

  it("BỎ HẲN base URL của hãng khác - không gửi khóa Google sang bên thứ ba", () => {
    assert.equal(provider.baseUrlChoGoogle("https://openrouter.ai/api/v1"), undefined);
    assert.equal(provider.baseUrlChoGoogle("https://9router.example.io.vn/v1"), undefined);
    assert.equal(provider.baseUrlChoGoogle("https://api.openai.com/v1"), undefined);
  });

  it("KHÔNG bị lừa bởi host chỉ chứa chuỗi googleapis.com", () => {
    // Khớp kiểu "có chứa" thì mấy host này lọt và khóa bay sang đó
    assert.equal(provider.baseUrlChoGoogle("https://googleapis.com.evil.example/v1"), undefined);
    assert.equal(provider.baseUrlChoGoogle("https://notgoogleapis.com/v1"), undefined);
  });

  it("rỗng hoặc không phải URL thì để SDK tự dùng endpoint mặc định", () => {
    assert.equal(provider.baseUrlChoGoogle(undefined), undefined);
    assert.equal(provider.baseUrlChoGoogle(""), undefined);
    assert.equal(provider.baseUrlChoGoogle("   "), undefined);
    assert.equal(provider.baseUrlChoGoogle("khong-phai-url"), undefined);
  });
});

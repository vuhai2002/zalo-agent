import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OVERFLOW_NOTE, splitLongMessage } from "./split-long-message.js";

const opts = { maxChars: 100, maxParts: 5 };

describe("splitLongMessage", () => {
  it("text ngắn giữ nguyên 1 tin", () => {
    assert.deepEqual(splitLongMessage("Chào anh Hải", opts), ["Chào anh Hải"]);
  });

  it("text rỗng trả mảng rỗng", () => {
    assert.deepEqual(splitLongMessage("   \n  ", opts), []);
  });

  it("mọi đoạn đều nằm trong giới hạn", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Dòng số ${i} nội dung vừa phải.`).join("\n");
    const parts = splitLongMessage(text, opts);
    assert.ok(parts.length > 1, "phải cắt ra nhiều đoạn");
    for (const part of parts) {
      assert.ok(part.length <= opts.maxChars, `đoạn dài ${part.length} vượt ${opts.maxChars}`);
    }
  });

  it("không cắt giữa từ", () => {
    const text = "khoancatgiuatu ".repeat(30);
    for (const part of splitLongMessage(text, opts)) {
      // Cắt giữa từ sẽ để lại mảnh vụn khác với từ gốc
      for (const word of part.split(/\s+/).filter(Boolean)) {
        assert.equal(word, "khoancatgiuatu", `mảnh vụn "${word}" - đã cắt giữa từ`);
      }
    }
  });

  it("ưu tiên cắt ở dòng trống (ranh giới đoạn văn)", () => {
    const doanA = `A${"a".repeat(58)}`;
    const doanB = `B${"b".repeat(58)}`;
    const parts = splitLongMessage(`${doanA}\n\n${doanB}`, opts);
    assert.deepEqual(parts, [doanA, doanB]);
  });

  it("giữ nguyên từng gạch đầu dòng khi danh sách không có dòng trống", () => {
    const bullets = Array.from({ length: 12 }, (_, i) => `- Mục thứ ${i} của danh sách`);
    const parts = splitLongMessage(bullets.join("\n"), opts);
    for (const part of parts) {
      for (const line of part.split("\n")) {
        assert.match(line, /^- Mục thứ \d+ của danh sách$/, `dòng bị cắt dở: "${line}"`);
      }
    }
  });

  it("ghép lại đủ nội dung, không mất chữ (khi chưa chạm trần số đoạn)", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Câu số ${i} nói một điều gì đó.`).join(" ");
    const parts = splitLongMessage(text, { maxChars: 100, maxParts: 20 });
    const rebuilt = parts.join(" ").replace(/\s+/g, " ");
    assert.equal(rebuilt, text.replace(/\s+/g, " "));
  });

  it("cắt cứng khi một từ dài hơn cả cửa sổ (URL khổng lồ)", () => {
    const url = `https://example.com/${"x".repeat(250)}`;
    const parts = splitLongMessage(url, opts);
    assert.ok(parts.length > 1);
    assert.equal(parts.join(""), url);
  });

  it("vượt trần số đoạn thì đoạn cuối kèm ghi chú còn nữa", () => {
    const text = "Nội dung rất dài. ".repeat(200);
    const parts = splitLongMessage(text, { maxChars: 100, maxParts: 3 });
    assert.equal(parts.length, 3);
    assert.ok(parts[2]!.endsWith(OVERFLOW_NOTE), "đoạn cuối phải có ghi chú");
    assert.ok(parts[2]!.length <= 100);
  });

  it("vừa đúng trần thì không kèm ghi chú", () => {
    const text = `${"a".repeat(90)}\n\n${"b".repeat(90)}`;
    const parts = splitLongMessage(text, { maxChars: 100, maxParts: 2 });
    assert.equal(parts.length, 2);
    assert.ok(!parts[1]!.includes(OVERFLOW_NOTE));
  });
});

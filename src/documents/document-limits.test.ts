import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { DocumentBlock, Sheet } from "./document-content-schema.js";

// Đọc env nên phải setupTestEnv trước, import động sau
let dataDir: string;
let limits: typeof import("./document-limits.js");

before(async () => {
  dataDir = setupTestEnv({
    DOCUMENT_MAX_BLOCKS: "5",
    DOCUMENT_MAX_ROWS: "4",
    // 500 là trần dưới của schema env - đặt thấp hơn thì boot bị từ chối
    DOCUMENT_MAX_CHARS: "500",
    DOCUMENT_MAX_SHEETS: "2",
  });
  limits = await import("./document-limits.js");
});

after(async () => {
  // Đọc cấu hình chỉnh-nóng nên module này mở SQLite - không đóng thì
  // Windows chặn xóa thư mục tạm (EPERM)
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

const para = (text: string): DocumentBlock => ({ type: "paragraph", text });

describe("checkDocumentLimits", () => {
  it("nội dung vừa phải thì cho qua", () => {
    assert.deepEqual(limits.checkDocumentLimits([para("chào"), para("bạn")]), { ok: true });
  });

  it("quá nhiều block -> báo rõ số hiện tại và trần", () => {
    const result = limits.checkDocumentLimits(Array.from({ length: 6 }, () => para("x")));
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /6 phần.*trần 5/);
  });

  it("bảng quá nhiều dòng -> chặn", () => {
    const result = limits.checkDocumentLimits([
      { type: "table", headers: ["A"], rows: Array.from({ length: 5 }, () => ["x"]) },
    ]);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /5 dòng.*trần 4/);
  });

  it("dòng bảng lệch số cột -> chặn, chỉ đúng dòng nào sai", () => {
    const result = limits.checkDocumentLimits([
      { type: "table", headers: ["A", "B"], rows: [["1", "2"], ["3"]] },
    ]);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /Dòng 2.*1 ô.*2 cột/);
  });

  it("tổng ký tự vượt trần -> chặn", () => {
    const result = limits.checkDocumentLimits([para("x".repeat(501))]);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /501 ký tự.*trần 500/);
  });

  it("đếm ký tự gộp cả bullets và bảng, không chỉ đoạn văn", () => {
    const result = limits.checkDocumentLimits([
      { type: "bullets", items: ["y".repeat(400)] },
      { type: "table", headers: ["z".repeat(150)], rows: [["w"]] },
    ]);
    assert.equal(result.ok, false, "400 + 150 + 1 > 500 nên phải chặn");
  });
});

describe("checkSpreadsheetLimits", () => {
  const sheet = (name: string, rows: Sheet["rows"]): Sheet => ({
    name,
    headers: ["Cột"],
    rows,
  });

  it("bảng tính hợp lệ thì cho qua", () => {
    assert.deepEqual(
      limits.checkSpreadsheetLimits([sheet("S1", [[{ kind: "text", value: "a" }]])]),
      { ok: true },
    );
  });

  it("quá nhiều sheet -> chặn", () => {
    const sheets = Array.from({ length: 3 }, (_, i) => sheet(`S${i}`, [[{ kind: "text", value: "a" }]]));
    const result = limits.checkSpreadsheetLimits(sheets);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /3 sheet.*trần 2/);
  });

  it("dòng lệch số cột -> chặn kèm tên sheet", () => {
    const result = limits.checkSpreadsheetLimits([
      {
        name: "Báo giá",
        headers: ["A", "B"],
        rows: [[{ kind: "text", value: "x" }]],
      },
    ]);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /Báo giá.*dòng 1/);
  });
});

describe("safeFileName", () => {
  it("giữ tên tiếng Việt có dấu, ép đúng đuôi", () => {
    assert.equal(limits.safeFileName("Báo giá tháng 7", "docx"), "Báo giá tháng 7.docx");
    assert.equal(limits.safeFileName("bang-luong.xlsx", "xlsx"), "bang-luong.xlsx");
  });

  it("chặn path traversal", () => {
    const name = limits.safeFileName("../../data/accounts/credentials", "docx");
    assert.ok(!name.includes(".."), `vẫn còn .. trong "${name}"`);
    assert.ok(!name.includes("/") && !name.includes("\\"));
    assert.ok(name.endsWith(".docx"));
  });

  it("đuôi nguy hiểm bị thay bằng đuôi thật", () => {
    assert.equal(limits.safeFileName("virus.exe", "docx"), "virus.docx");
    assert.equal(limits.safeFileName("script.bat", "xlsx"), "script.xlsx");
  });

  it("tên rỗng hoặc toàn ký tự lạ -> dùng tên mặc định", () => {
    assert.equal(limits.safeFileName("", "docx"), "tai-lieu.docx");
    assert.equal(limits.safeFileName("***", "xlsx"), "tai-lieu.xlsx");
  });

  it("tên quá dài bị cắt ngắn", () => {
    const name = limits.safeFileName("a".repeat(200), "docx");
    assert.ok(name.length <= 85, `tên dài ${name.length} ký tự`);
  });
});

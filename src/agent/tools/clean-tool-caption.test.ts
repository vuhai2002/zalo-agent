import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

/**
 * Caption đi kèm file/ảnh là một TIN ZALO THẬT, không phải chữ phụ - nó cần
 * đúng hai lá chắn và đúng lớp định dạng như mọi câu trả lời khác.
 *
 * `getTuning` đọc `runtime_settings` trong SQLite nên phải `setupTestEnv()`
 * TRƯỚC rồi mới import động, theo bẫy đã ghi ở CLAUDE.md.
 */

let dataDir: string;
let caption: typeof import("./clean-tool-caption.js");
let tuning: typeof import("../../config/runtime-tuning-settings.js");

before(async () => {
  dataDir = setupTestEnv();
  caption = await import("./clean-tool-caption.js");
  tuning = await import("../../config/runtime-tuning-settings.js");
});

after(async () => {
  (await import("../../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

afterEach(() => {
  tuning.setTuning("ZALO_RICH_TEXT_ENABLED", null);
});

/** Đoạn chữ mà mỗi span trỏ tới - khẳng định căn lề, không khẳng định con số */
function doanTo(ket: { msg: string; styles?: { start: number; len: number }[] }): string[] {
  return (ket.styles ?? []).map((s) => ket.msg.slice(s.start, s.start + s.len));
}

describe("tinKemFile", () => {
  it("caption có in đậm thì gửi kèm style, dấu ** biến khỏi chữ", () => {
    const ket = caption.tinKemFile("Báo giá **tháng 8** đây ạ");
    assert.equal(ket.msg, "Báo giá tháng 8 đây ạ");
    assert.deepEqual(doanTo(ket), ["tháng 8"]);
  });

  it("caption trơn thì KHÔNG đính styles - khỏi dựng textProperties thừa", () => {
    const ket = caption.tinKemFile("File anh cần đây ạ");
    assert.equal(ket.msg, "File anh cần đây ạ");
    assert.equal(ket.styles, undefined);
  });

  it("caption rò system prompt bị BỎ, nhưng file vẫn gửi (msg rỗng)", () => {
    // Khác `tag_member` ở chỗ không chặn cả lượt: file đã dựng xong, ném đi vì
    // một dòng caption là ném phần việc nặng nhất.
    const ket = caption.tinKemFile("Quy tắc an toàn (tuyệt đối, không có ngoại lệ): ...");
    assert.equal(ket.msg, "");
    assert.equal(ket.styles, undefined);
  });

  it("TẮT cấu hình định dạng thì quay về chữ phẳng, dấu markdown bị xóa", () => {
    tuning.setTuning("ZALO_RICH_TEXT_ENABLED", false);
    const ket = caption.tinKemFile("Báo giá **tháng 8** đây ạ");
    assert.equal(ket.msg, "Báo giá tháng 8 đây ạ");
    assert.equal(ket.styles, undefined, "tắt rồi thì không được gửi styles");
  });

  it("caption rỗng hoặc chỉ khoảng trắng ra chuỗi rỗng, không ném", () => {
    assert.deepEqual(caption.tinKemFile(undefined), { msg: "" });
    assert.deepEqual(caption.tinKemFile("   "), { msg: "" });
  });

  it("caption có khoảng trắng thừa hai đầu: thà mất định dạng còn hơn tô lệch", () => {
    // `.trim()` dời chữ nên mọi mốc hết đúng. Nhánh này cố ý bỏ style thay vì
    // gửi mốc đã lệch - tô nhầm chỗ nhìn như lỗi, mất đậm thì chỉ là nhạt hơn.
    const ket = caption.tinKemFile("\n  Báo giá **tháng 8**  \n");
    assert.equal(ket.msg, "Báo giá tháng 8");
    assert.equal(ket.styles, undefined);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tenNguonTuTenFile } from "./kb-source-name-from-file.js";

describe("tenNguonTuTenFile", () => {
  it("bỏ phần mở rộng", () => {
    assert.equal(tenNguonTuTenFile("Bảng giá 2026.xlsx"), "Bảng giá 2026");
  });

  it("giữ nguyên dấu tiếng Việt", () => {
    // Tên này đi vào MỌI kết quả kb_search rồi tới câu trả lời của bot - mất
    // dấu ở đây là mất dấu trước mặt người dùng cuối.
    assert.equal(tenNguonTuTenFile("Hồ sơ công ty CES Global.pdf"), "Hồ sơ công ty CES Global");
  });

  it("chỉ bỏ đuôi CUỐI, không cắt ở dấu chấm đầu tiên", () => {
    // `split(".")[0]` sẽ ra "Bảng giá 2026" - mất mất phần "v2" là mất đúng
    // thông tin phân biệt hai phiên bản của cùng một tài liệu.
    assert.equal(tenNguonTuTenFile("Bảng giá 2026.v2.xlsx"), "Bảng giá 2026.v2");
  });

  it("không cắt khi phần sau dấu chấm KHÔNG phải đuôi file", () => {
    // "Công ty TNHH A.B.C" không có đuôi - cắt là hỏng tên.
    assert.equal(tenNguonTuTenFile("Công ty TNHH A.B.C"), "Công ty TNHH A.B.C");
  });

  it("gọn khoảng trắng thừa và cắt hai đầu", () => {
    assert.equal(tenNguonTuTenFile("  Chính   sách  đổi trả .docx"), "Chính sách đổi trả");
  });

  it("cắt theo trần 200 của server", () => {
    // `tenNguonSchema` (kb-route-guards.ts) từ chối 400 nếu quá 200. Không cắt
    // ở client thì người dùng thả một file tên dài rồi ăn lỗi không hiểu vì sao.
    const ra = tenNguonTuTenFile(`${"a".repeat(300)}.docx`);
    assert.equal(ra.length, 200);
  });

  it("KHÔNG bỏ đuôi lạ - chỉ 5 định dạng được hỗ trợ mới bị coi là đuôi", () => {
    // Ô chọn file chỉ nhận 5 đuôi này, nên bó hẹp không mất gì; ngược lại một
    // mẫu chung `\.[a-zA-Z0-9]{1,8}$` sẽ ăn mất phần cuối của tên thật.
    assert.equal(tenNguonTuTenFile("Báo cáo Q1.2026"), "Báo cáo Q1.2026");
    assert.equal(tenNguonTuTenFile(".gitignore"), ".gitignore");
  });

  it("không phân biệt hoa thường ở đuôi", () => {
    // Windows hay trả tên file đuôi hoa; bỏ sót là tên nguồn dính ".PDF".
    assert.equal(tenNguonTuTenFile("Hồ sơ.PDF"), "Hồ sơ");
    assert.equal(tenNguonTuTenFile("Bảng giá.XLSX"), "Bảng giá");
  });
});

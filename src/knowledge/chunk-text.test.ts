import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Module thuần (không import gì ngoài chính nó) - không chạm env/DB nên import tĩnh được
import { catThanhDoan } from "./chunk-text.js";

/**
 * Tách thành các "từ" (chuỗi liền không khoảng trắng) - dùng để đo TÍNH CHẤT
 * "không từ nào bị cắt đứt giữa chừng" thay vì dò một chuỗi con cụ thể như
 * "dà": dò chuỗi con cụ thể chỉ đúng khi ranh giới cắt cứng tình cờ rơi vào
 * đúng từ đó - đo được thật: với chuỗi test dưới đây, `coDoanToiDa: 30` cắt
 * cứng lại tình cờ rơi đúng khoảng trắng (không cắt từ nào), nên assertion cũ
 * không đỏ dù thuật toán bị thay bằng cắt cứng thật. So khớp danh sách từ sau
 * khi ghép lại các đoạn với danh sách từ của bản gốc thì không phụ thuộc vào
 * từ cụ thể nào - từ bị cắt đôi (vd "dài" -> "dà" + "i") luôn lộ ra thành 2
 * "từ" lạ không khớp bản gốc, bất kể nó rơi vào từ nào.
 */
function tuVung(text: string): string[] {
  return text.match(/\S+/gu) ?? [];
}

describe("catThanhDoan - ranh giới tự nhiên", () => {
  it("cắt ở ranh giới đoạn văn, KHÔNG cắt giữa từ", () => {
    const chu = "Câu một dài dài dài.\n\nCâu hai cũng dài dài dài.";
    const d = catThanhDoan(chu, { coDoanToiDa: 37, chongLan: 0 });
    const tuSauKhiCat = tuVung(d.map((x) => x.noiDung).join(" "));
    assert.deepEqual(tuSauKhiCat, tuVung(chu), "có từ bị cắt đứt giữa chừng khi ghép lại các đoạn");
  });

  it("mỗi đoạn mang tiêu đề markdown gần nhất phía trên", () => {
    const chu = "# Chính sách đổi trả\n\nTrong vòng 7 ngày.\n\n# Bảo hành\n\n12 tháng.";
    const d = catThanhDoan(chu, { coDoanToiDa: 40, chongLan: 0 });
    const doanBaoHanh = d.find((x) => x.noiDung.includes("12 tháng"))!;
    assert.equal(doanBaoHanh.tieuDe, "Bảo hành");
  });

  it("file CRLF (Windows) vẫn gắn đúng tiêu đề - '\\n{2,}' không khớp '\\r\\n\\r\\n'", () => {
    // Notepad/Word "Save as .txt" trên Windows ghi CRLF: dòng trống thành
    // "\r\n\r\n" (không có 2 "\n" liền nhau) - nếu quên chuẩn hóa xuống dòng,
    // toàn tài liệu rơi vào 1 đoạn duy nhất và chỉ dòng ĐẦU được dò heading.
    const chu = "# Chính sách đổi trả\n\nTrong vòng 7 ngày.\n\n# Bảo hành\n\n12 tháng.".replace(
      /\n/g,
      "\r\n",
    );
    const d = catThanhDoan(chu, { coDoanToiDa: 40, chongLan: 0 });
    const doanBaoHanh = d.find((x) => x.noiDung.includes("12 tháng"))!;
    assert.equal(doanBaoHanh.tieuDe, "Bảo hành");
  });

  it("đoạn dài hơn trần vẫn phải ra, không được nuốt mất", () => {
    const d = catThanhDoan("x".repeat(5000), { coDoanToiDa: 1000, chongLan: 0 });
    assert.equal(d.map((x) => x.noiDung).join("").length >= 5000 - d.length, true);
  });

  it("thứ tự đoạn liên tục từ 0", () => {
    const d = catThanhDoan("a\n\nb\n\nc", { coDoanToiDa: 3, chongLan: 0 });
    assert.deepEqual(d.map((x) => x.thuTu), d.map((_, i) => i));
  });

  it("tiêu đề không có đoạn thân theo sau (heading cuối văn bản) không sinh đoạn rỗng", () => {
    const d = catThanhDoan("Nội dung đầu.\n\n# Tiêu đề cụt", { coDoanToiDa: 40, chongLan: 0 });
    assert.equal(d.length, 1);
    assert.equal(d[0]!.noiDung, "Nội dung đầu.");
  });

  it("chuỗi rỗng ra mảng rỗng, không ném lỗi", () => {
    assert.deepEqual(catThanhDoan("", { coDoanToiDa: 100, chongLan: 0 }), []);
  });
});

describe("catThanhDoan - chồng lấn (chongLan)", () => {
  it("chongLan > 0 chèn đuôi đoạn trước vào đầu đoạn sau", () => {
    const d = catThanhDoan("x".repeat(50), { coDoanToiDa: 20, chongLan: 50 });
    assert.equal(d[0]!.noiDung, "x".repeat(20));
    assert.ok(d[1]!.noiDung.startsWith("x".repeat(10)), "đoạn 2 phải mang đuôi 10 ký tự cuối của đoạn 1");
  });

  it("chongLan = 0 thì các đoạn không chồng lấn nhau (tổng độ dài khớp nguyên văn)", () => {
    const d = catThanhDoan("x".repeat(50), { coDoanToiDa: 20, chongLan: 0 });
    assert.equal(
      d.map((x) => x.noiDung.length).reduce((a, b) => a + b, 0),
      50,
    );
  });

  it("chồng lấn KHÔNG bắc cầu qua ranh giới tiêu đề khác nhau", () => {
    const chu = `# Một\n\n${"a".repeat(30)}\n\n# Hai\n\n${"b".repeat(30)}`;
    const d = catThanhDoan(chu, { coDoanToiDa: 20, chongLan: 50 });
    const doanDauTieuDeHai = d.find((x) => x.tieuDe === "Hai")!;
    assert.ok(!doanDauTieuDeHai.noiDung.startsWith("a"), "không được mang chữ 'a' từ tiêu đề trước sang");
  });
});

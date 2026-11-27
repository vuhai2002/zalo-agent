import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boCauTuThuatDau } from "./cau-tu-thuat-dau-tra-loi.js";

// Mẫu diễn đạt lại theo đúng HÌNH DẠNG các ca thật trên prod (30 ngày, 17/94 lượt có
// tool): đoạn đầu nhận xét nguồn/dữ liệu rồi mới tới câu trả lời
const DINH = [
  "Đã đọc đủ 5 trang; tài liệu nói về Skill và cách chia Global/Project. Mình sẽ gom các ý trùng nhau.",
  "Đã đọc ba nguồn; mình chọn ba tin có mốc thời gian rõ ràng.",
  "Hai bài đã đủ dữ liệu để tóm tắt: một tin khoa học và một tin nông nghiệp.",
  "Ba nguồn đều ghi ngày 24/11, đủ để chọn ba tin; mình sẽ tóm tắt ngắn kèm nguồn.",
  "Các nội dung chính đã được đối chiếu với bài gốc; mình sẽ chọn bốn tin trong ngày.",
  "Hai bài đều đăng ngày 23/11 và có nội dung cụ thể; mình chọn hai tin này để giữ bản tin ngắn.",
  "Đủ hai tin từ hai nguồn chính thức; thông cáo thứ hai đăng hôm qua nên bản tin sẽ ghi rõ.",
];

// Câu mở đầu HỢP LỆ phải giữ nguyên - lấy theo hình dạng câu trả lời thật
const GIU = [
  "Dạ Julie, mình đã kiểm tra điều khoản trên website chính thức ngày 26/11:",
  "Hải ơi, đọc được tệp rồi nhé 😊 Chương trình có tổng cộng **28 buổi học**.",
  "Em đọc rồi chị Trang nhé. Khóa này phù hợp ở phần ứng dụng AI.",
  "## Bản tin AI thế giới & Việt Nam - 21/11/2026",
  "Bản tin VTV sáng 22/11/2026",
  "🔢 LUẬN SIM 0900.000.000",
  "**Có hợp nha Hằng** - màu nâu nối với cả hai món.",
  "Mai ơi, không có số nào đạt 5/5 trong 5 số tiếp theo:",
];

const PHAN_SAU = "\nHải ơi, tệp gồm **5 trang**:\n\n1. Ý thứ nhất\n2. Ý thứ hai";

describe("boCauTuThuatDau", () => {
  for (const dau of DINH) {
    it(`bỏ câu nhận xét dữ liệu ở đầu: ${dau.slice(0, 40)}`, () => {
      const kq = boCauTuThuatDau(dau + PHAN_SAU, { coGoiTool: true });
      assert.equal(kq.text, PHAN_SAU.trim());
      assert.equal(kq.daBo, true);
    });
  }

  for (const dau of GIU) {
    it(`giữ nguyên câu mở đầu hợp lệ: ${dau.slice(0, 40)}`, () => {
      const goc = dau + PHAN_SAU;
      assert.deepEqual(boCauTuThuatDau(goc, { coGoiTool: true }), { text: goc, daBo: false });
    });
  }

  it("lượt KHÔNG gọi tool thì không đụng gì (không có bước giữa nào để kể)", () => {
    const goc = DINH[0] + PHAN_SAU;
    assert.deepEqual(boCauTuThuatDau(goc, { coGoiTool: false }), { text: goc, daBo: false });
  });

  it("câu nhận xét là TOÀN BỘ câu trả lời (không có phần sau) thì giữ - cắt đi là gửi tin rỗng", () => {
    const goc = DINH[1];
    assert.deepEqual(boCauTuThuatDau(goc, { coGoiTool: true }), { text: goc, daBo: false });
  });

  it("đoạn đầu dài bất thường thì giữ - nhiều khả năng là nội dung thật", () => {
    const goc = `Đã đọc ba nguồn; ${"nội dung dài ".repeat(60)}${PHAN_SAU}`;
    assert.equal(boCauTuThuatDau(goc, { coGoiTool: true }).daBo, false);
  });

  it("chỉ bỏ MỘT đoạn đầu, không bỏ dây chuyền các đoạn sau", () => {
    const goc = `${DINH[1]}\n${DINH[2]}\nNội dung thật.`;
    assert.equal(boCauTuThuatDau(goc, { coGoiTool: true }).text, `${DINH[2]}\nNội dung thật.`);
  });
});

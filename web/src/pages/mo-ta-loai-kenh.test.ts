import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MO_TA_KENH_BOT, MO_TA_KENH_CA_NHAN } from "./mo-ta-loai-kenh.js";

/**
 * Canh câu mô tả loại kênh trên trang Accounts.
 *
 * Cùng khuôn với ca canh `LUAT_PERSONA_KENH_BOT` ở
 * `src/zalo-bot/lich-hen-tren-kenh-bot.test.ts`, và ra đời vì đúng lỗ mà ca đó
 * KHÔNG phủ: persona được canh, còn chuỗi dashboard thì không - nên khi lịch
 * hẹn nối xong ở V3.19, câu "không đặt lịch hẹn" nằm lại trên giao diện.
 *
 * Vì sao đáng một file test riêng: khối này chỉ hiện lúc TẠO account, ngay
 * trên dòng "Chốt lúc tạo, không đổi được sau đó". Nói sai ở đây đẩy người cần
 * lịch hẹn sang kênh CÁ NHÂN - kênh CÓ rủi ro bị Zalo khóa nick - và sửa lại
 * đòi xóa account, mà xóa account thì dọn luôn toàn bộ lịch hẹn của nó.
 */
describe("mô tả loại kênh trên trang Accounts", () => {
  it("mô tả kênh bot KHÔNG nói bot không đặt được lịch hẹn", () => {
    assert.doesNotMatch(MO_TA_KENH_BOT, /lịch|hẹn|schedule/i);
  });

  it("mô tả kênh bot vẫn nêu ĐÚNG những gì Bot API thật sự không làm được", () => {
    // Bỏ chữ "lịch hẹn" mà bỏ luôn cả phần đúng thì thành nói thiếu - người
    // vận hành chọn kênh bot rồi mới phát hiện không gửi được file.
    for (const phai of ["file", "ảnh tự vẽ", "thả cảm xúc", "tag thành viên"]) {
      assert.match(MO_TA_KENH_BOT, new RegExp(phai, "i"), `mô tả thiếu giới hạn "${phai}"`);
    }
    assert.match(MO_TA_KENH_BOT, /Zalo Bot API/, "không nói rõ đây là giới hạn của nền tảng");
    assert.match(MO_TA_KENH_BOT, /không có rủi ro bị khóa/i, "không nêu cái ĐƯỢC, người đọc chỉ thấy cái mất");
  });

  it("mô tả kênh cá nhân vẫn cảnh báo rủi ro khóa nick", () => {
    // Đây là cảnh báo an toàn, không phải chữ trang trí: repo chốt "chỉ dùng
    // nick phụ" vì zca-js là giao thức không chính thức.
    assert.match(MO_TA_KENH_CA_NHAN, /rủi ro/i);
    assert.match(MO_TA_KENH_CA_NHAN, /nick phụ/i);
  });
});

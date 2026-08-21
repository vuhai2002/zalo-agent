import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TOOL_KHONG_CHAY_TREN_BOT } from "../../../src/zalo-bot/nang-luc-kenh-bot.js";
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

  it("mô tả kênh bot nêu ĐỦ CẢ BẢY tool bị chặn, không sót cái nào", () => {
    // Bỏ chữ "lịch hẹn" mà bỏ luôn phần đúng thì thành nói THIẾU theo chiều
    // ngược lại - người vận hành chọn kênh bot rồi mới phát hiện không gửi
    // được file. Vòng rà soát 2 bắt được đúng ca đó: bản đầu sót
    // `get_group_info`, mà ca test thì tự nhận là "nêu ĐÚNG những gì Bot API
    // không làm được" trong khi chỉ đo 4 trong 7.
    //
    // Đối chiếu thẳng với BẢNG CHẶN thay vì gõ tay danh sách: gõ tay là danh
    // sách này và bảng kia trôi khỏi nhau ngay lần thêm/bớt tool tiếp theo.
    const chuCanCo: Record<string, RegExp> = {
      send_file: /gửi được file/i,
      create_word_document: /Word/i,
      create_excel_file: /Excel/i,
      create_image: /ảnh tự vẽ/i,
      add_reaction: /thả cảm xúc/i,
      tag_member: /tag thành viên/i,
      get_group_info: /thành viên nhóm/i,
    };

    assert.deepEqual(
      Object.keys(chuCanCo).sort(),
      Object.keys(TOOL_KHONG_CHAY_TREN_BOT).sort(),
      "bảng chặn đã đổi mà câu mô tả trên dashboard chưa theo - người vận hành đọc phải thông tin cũ",
    );

    // Mẫu phải PHÂN BIỆT NHAU. Bản đầu cho ba key `send_file` /
    // `create_word_document` / `create_excel_file` cùng ánh xạ `/file/i`, tức
    // bảy khẳng định thật ra chỉ là năm. Đo được bằng phép phá: thêm một tool
    // mới vào bảng chặn rồi ánh xạ nó về `/file/i` thì ca này XANH, dù câu mô
    // tả không hề nhắc tới tool đó - và đó chính là lối thoát rẻ nhất cho
    // người sửa lần sau khi `deepEqual` ở trên bắn đỏ.
    const mau = Object.values(chuCanCo).map((r) => r.source);
    assert.equal(
      new Set(mau).size,
      mau.length,
      "hai tool dùng chung một mẫu chữ - key sau đi ké khẳng định của key trước, phép đo mất răng",
    );

    for (const [key, m] of Object.entries(chuCanCo)) {
      assert.match(MO_TA_KENH_BOT, m, `mô tả không nhắc tới giới hạn của "${key}"`);
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

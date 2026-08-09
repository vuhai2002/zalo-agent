import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Module thuần (không env, không DB) - import tĩnh an toàn.
import { dongGoiTheoNganSach, KB_PACK_SEPARATOR } from "./kb-pack-result.js";

/**
 * Test đơn vị cho `dongGoiTheoNganSach` - module chưa có test trực tiếp nào
 * trước vòng rà soát lần 3 (chỉ được kiểm gián tiếp qua `kb-search-tool.test.ts`,
 * vốn không đủ để phủ hết 3 nhánh + biên).
 */

/** Đoạn dài đúng `doDai` ký tự, tiền tố số để phân biệt từng đoạn khi kiểm nội dung. */
function doanCoDo(i: number, doDai: number): string {
  const nhan = `D${i}_`;
  return nhan + "x".repeat(Math.max(0, doDai - nhan.length));
}

describe("dongGoiTheoNganSach - ba nhánh", () => {
  it("đủ chỗ cho TẤT CẢ đoạn: nối nguyên vẹn, không nhãn nào", () => {
    const doan = [doanCoDo(0, 50), doanCoDo(1, 50), doanCoDo(2, 50)];
    const kq = dongGoiTheoNganSach(doan, 10_000);
    assert.equal(kq, doan.join(KB_PACK_SEPARATOR));
  });

  it("bỏ đoạn: đủ chỗ cho MỘT PHẦN, phần còn lại bị bỏ hẳn kèm nhãn ĐÚNG SỐ", () => {
    // 5 đoạn 1000 ký tự - chọn trần để CHỈ 2 đoạn đầu vừa (2*1000+7=2007),
    // đoạn thứ 3 chắc chắn không vừa (2007+7+1000=3014). Biên 200 ký tự đủ để
    // hấp thụ phần ngân sách bị `dongGoiTheoNganSach` tự trừ trước cho câu báo
    // (luôn dưới 100 ký tự với 5 đoạn), không cần biết chính xác số đó.
    const doan = Array.from({ length: 5 }, (_, i) => doanCoDo(i, 1000));
    const kq = dongGoiTheoNganSach(doan, 2207);
    assert.ok(kq.includes(doan[0]!), "phải còn đoạn 0");
    assert.ok(kq.includes(doan[1]!), "phải còn đoạn 1");
    assert.ok(!kq.includes(doan[2]!), "đoạn 2 phải bị bỏ hẳn, không cắt cụt");
    assert.ok(!kq.includes(doan[3]!) && !kq.includes(doan[4]!), "đoạn 3, 4 cũng bị bỏ hẳn");
    assert.match(kq, /còn 3 đoạn nữa không đủ chỗ/, `phải báo ĐÚNG 3 đoạn còn lại, thực tế: ${JSON.stringify(kq)}`);
  });

  it("cắt đoạn đầu: ngay cả đoạn đầu cũng không vừa - cắt ở ranh giới khoảng trắng, không trả rỗng", () => {
    const doan = [doanCoDo(0, 5000)];
    const kq = dongGoiTheoNganSach(doan, 500);
    assert.ok(kq.length > 0, "không được trả rỗng");
    assert.match(kq, /đã rút gọn/, "phải ghi rõ đã rút gọn");
    assert.ok(!kq.includes(doan[0]!), "không được chứa nguyên văn đoạn gốc (phải bị cắt thật)");
  });

  it("cắt đoạn đầu VÀ còn đoạn khác phía sau: PHẢI báo cả hai (Important 1, vòng rà soát lần 3)", () => {
    // 3 đoạn đều rất dài (5000 ký tự) - ngay cả đoạn ĐẦU cũng không vừa trần
    // 500, nên nhánh "cắt đoạn đầu" chạy - nhưng còn 2 đoạn khác (đoạn 1, 2)
    // CHƯA TỪNG được xét vì vòng lặp `break` ngay sau đó. Trước bản vá, nhánh
    // này chỉ có "đã rút gọn" mà không hề nói còn đoạn khác - model tưởng đây
    // là toàn bộ kết quả.
    const doan = [doanCoDo(0, 5000), doanCoDo(1, 5000), doanCoDo(2, 5000)];
    const kq = dongGoiTheoNganSach(doan, 500);
    assert.match(kq, /đã rút gọn/, "đoạn đầu phải được ghi nhận đã cắt");
    assert.match(kq, /còn 2 đoạn nữa không đủ chỗ/, `phải báo còn ĐÚNG 2 đoạn (1 và 2), thực tế: ${JSON.stringify(kq)}`);
  });
});

describe("dongGoiTheoNganSach - chiều ÂM: đủ chỗ thì KHÔNG được có nhãn nào", () => {
  it("không nhãn 'còn N đoạn' khi mọi đoạn đều vừa", () => {
    const doan = [doanCoDo(0, 30), doanCoDo(1, 30)];
    const kq = dongGoiTheoNganSach(doan, 5000);
    assert.doesNotMatch(kq, /còn \d+ đoạn/);
  });

  it("không nhãn 'đã rút gọn' khi mọi đoạn đều vừa", () => {
    const doan = [doanCoDo(0, 30), doanCoDo(1, 30)];
    const kq = dongGoiTheoNganSach(doan, 5000);
    assert.doesNotMatch(kq, /đã rút gọn/);
  });
});

describe("dongGoiTheoNganSach - bất biến CỨNG: không bao giờ vượt ngân sách xin", () => {
  it("quét 31 cỡ đoạn x 201 mức trần (đúng quy mô người rà soát đã đo) - luôn kq.length <= nganSachNoiDung", () => {
    // Trần bắt đầu từ 300 - đủ cao hơn hẳn phần ngân sách hàm TỰ TRỪ TRƯỚC cho
    // câu báo (luôn dưới 100 ký tự với 6 đoạn), khớp dải trần THẬT bot dùng
    // (KB_MAX_RESULT_CHARS min 2000 trừ vỏ tối đa ~513 = sàn thật 1487, ở đây
    // quét rộng hơn cho chắc). KHÔNG quét xuống ca cực đoan trần < ~70 ký tự
    // (nhỏ hơn cả câu báo) - ca đó không tới được từ `.env`/dashboard vì
    // KB_MAX_RESULT_CHARS đã có sàn 2000 ở cả schema lẫn tuning-definitions.
    const soDoan = 6;
    let soToHop = 0;
    for (let doDaiDoan = 20; doDaiDoan <= 620; doDaiDoan += 20) {
      const doan = Array.from({ length: soDoan }, (_, i) => doanCoDo(i, doDaiDoan));
      for (let tran = 300; tran <= 2300; tran += 10) {
        const kq = dongGoiTheoNganSach(doan, tran);
        soToHop++;
        assert.ok(kq.length <= tran, `doDaiDoan=${doDaiDoan} tran=${tran} -> dài ${kq.length} (vượt ${kq.length - tran})`);
      }
    }
    assert.ok(soToHop > 6000, `phải quét đủ nhiều tổ hợp, thực tế ${soToHop}`);
  });
});

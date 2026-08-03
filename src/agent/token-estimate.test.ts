import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelMessage } from "ai";
import {
  KY_TU_MOI_TOKEN,
  TOKEN_MOI_ANH_THEO_CO,
  nganSachAnToan,
  soSanhUocLuong,
  uocLuongTokenTinNhan,
} from "./token-estimate.js";

/**
 * Module thuần - không cần setupTestEnv.
 *
 * File này TRƯỚC ĐÂY KHÔNG TỒN TẠI, và vòng rà soát toàn cục đo được hậu quả:
 * bỏ hẳn `HE_SO_AN_TOAN` (0,7 -> 1,0) thì 1140/1140 test vẫn xanh, cho nhánh
 * JSON fallback trả 0 cũng vậy. Hai thứ đó là lõi của ngân sách token - hệ số
 * an toàn chính là thứ commit "thống nhất ngân sách" sinh ra, còn nhánh fallback
 * thì chú thích tự gọi là "sai NGUY HIỂM" (kết quả tool 60.000 ký tự bị báo là
 * 4 token).
 */

const chu = (n: number) => "a".repeat(n);

describe("nganSachAnToan - biên 30%", () => {
  it("trừ đúng 30% trần thô", () => {
    // Bỏ hệ số này thì mọi phép cắt ngữ cảnh đều tính bằng trần THÔ, tức là
    // gửi đúng con số vừa làm provider trả 400
    assert.equal(nganSachAnToan(100_000), 70_000);
    assert.equal(nganSachAnToan(128_000), 89_600);
  });

  it("luôn NHỎ HƠN trần thô - bất biến của cả cơ chế", () => {
    for (const tran of [4_000, 32_000, 128_000, 1_000_000]) {
      assert.ok(nganSachAnToan(tran) < tran, `trần ${tran}`);
    }
  });

  it("trần 0 hoặc âm không cho ra số âm", () => {
    assert.ok(nganSachAnToan(0) <= 0);
    assert.ok(Number.isFinite(nganSachAnToan(0)));
  });
});

describe("uocLuongTokenTinNhan - phần KHÔNG phải chữ", () => {
  it("kết quả tool nặng KHÔNG được ước lượng thành số bé xíu", () => {
    // Nhánh fallback JSON: trả 0 ở đây là mù hoàn toàn với thứ nặng nhất trong
    // cả lượt - kết quả `web_fetch` có thể tới hàng chục nghìn ký tự
    const tin = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "web_fetch",
            output: { type: "text", value: chu(60_000) },
          },
        ],
      } as ModelMessage,
    ];
    const uoc = uocLuongTokenTinNhan(tin, TOKEN_MOI_ANH_THEO_CO.normal);
    assert.ok(uoc > 10_000, `mới ${uoc} token cho 60.000 ký tự - nhánh fallback đang mù`);
  });

  it("lệnh gọi tool cũng được tính, không bỏ qua", () => {
    const tin = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "c1", toolName: "create_word_document", input: { blocks: chu(20_000) } },
        ],
      } as ModelMessage,
    ];
    assert.ok(uocLuongTokenTinNhan(tin, TOKEN_MOI_ANH_THEO_CO.normal) > 3_000);
  });

  it("chữ thường quy đổi theo KY_TU_MOI_TOKEN", () => {
    const tin = [{ role: "user", content: chu(2_500) } as ModelMessage];
    const uoc = uocLuongTokenTinNhan(tin, TOKEN_MOI_ANH_THEO_CO.normal);
    // 2500 / 2.5 = 1000, cộng phần đầu mỗi tin nên chỉ so khoảng
    assert.ok(uoc >= 1_000 && uoc < 1_200, `nhận ${uoc}`);
    assert.equal(KY_TU_MOI_TOKEN, 2.5);
  });

  it("ảnh tính theo CỠ, ba cỡ khác nhau thật sự", () => {
    const co = TOKEN_MOI_ANH_THEO_CO;
    assert.ok(co.thumb < co.normal && co.normal < co.hd, JSON.stringify(co));
  });

  it("mảng rỗng ra 0, không ném", () => {
    assert.equal(uocLuongTokenTinNhan([], TOKEN_MOI_ANH_THEO_CO.normal), 0);
  });
});

describe("soSanhUocLuong - đường hiệu chỉnh", () => {
  it("có usage thật thì trả phần trăm lệch", () => {
    const r = soSanhUocLuong(1_000, 1_250);
    assert.ok(r);
    assert.equal(r.uocLuong, 1_000);
    assert.equal(r.that, 1_250);
    assert.equal(typeof r.lechPhanTram, "number");
  });

  it("thiếu usage thật (provider không trả) thì trả null, không đoán bừa", () => {
    assert.equal(soSanhUocLuong(1_000, undefined), null);
    assert.equal(soSanhUocLuong(1_000, 0), null);
  });
});

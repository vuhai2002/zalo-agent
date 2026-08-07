import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Module thuần - không chạm env/DB nên import tĩnh được
import { mocGuiCuaTinZalo } from "./zalo-message-timestamp.js";

const NHAN_LUC = new Date("2026-08-07T16:37:00.000Z");
const iso = (s: string) => new Date(s).toISOString();

describe("mocGuiCuaTinZalo - đơn vị của data.ts", () => {
  it("nhận MILLI (13 chữ số) - cách zalo-agent-cli và deplao-builder hiểu", () => {
    const milli = Date.parse("2026-08-07T16:30:00.000Z");
    assert.equal(mocGuiCuaTinZalo(String(milli), NHAN_LUC), iso("2026-08-07T16:30:00.000Z"));
    assert.equal(mocGuiCuaTinZalo(milli, NHAN_LUC), iso("2026-08-07T16:30:00.000Z"));
  });

  it("nhận GIÂY (10 chữ số) - cách zalo-personal hiểu", () => {
    const giay = Date.parse("2026-08-07T16:30:00.000Z") / 1000;
    assert.equal(mocGuiCuaTinZalo(String(giay), NHAN_LUC), iso("2026-08-07T16:30:00.000Z"));
  });

  it("hai đơn vị cho ra CÙNG một mốc - đây là cả lý do phân biệt bằng độ lớn", () => {
    const milli = Date.parse("2026-08-07T16:30:00.000Z");
    assert.equal(
      mocGuiCuaTinZalo(String(milli), NHAN_LUC),
      mocGuiCuaTinZalo(String(milli / 1000), NHAN_LUC),
      "các repo tham khảo hiểu khác nhau, nên phải đúng với cả hai",
    );
  });
});

describe("mocGuiCuaTinZalo - giá trị hỏng rơi về giờ nhận", () => {
  for (const [ten, raw] of [
    ["thiếu hẳn", undefined],
    ["null", null],
    ["chuỗi rỗng", ""],
    ["không phải số", "hôm qua"],
    ["số 0", 0],
    ["số âm", -1000],
    ["quá nhỏ (dưới ngưỡng năm 2001)", 123456],
    ["NaN", Number.NaN],
    ["object", { ts: 1 }],
  ] as const) {
    it(`${ten} -> dùng giờ nhận`, () => {
      assert.equal(mocGuiCuaTinZalo(raw, NHAN_LUC), NHAN_LUC.toISOString());
    });
  }
});

describe("mocGuiCuaTinZalo - kẹp quanh giờ nhận", () => {
  it("tin cũ trong 7 ngày GIỮ NGUYÊN giờ gửi thật - listener nối lại nhận cả loạt tin cũ", () => {
    const sauTiengTruoc = Date.parse("2026-08-07T14:37:00.000Z");
    assert.equal(mocGuiCuaTinZalo(String(sauTiengTruoc), NHAN_LUC), iso("2026-08-07T14:37:00.000Z"));

    const sauNgayTruoc = Date.parse("2026-08-01T16:37:00.000Z");
    assert.equal(
      mocGuiCuaTinZalo(String(sauNgayTruoc), NHAN_LUC),
      iso("2026-08-01T16:37:00.000Z"),
      "6 ngày trước vẫn trong khoảng chấp nhận",
    );
  });

  it("quá 7 ngày trước -> bỏ, dùng giờ nhận", () => {
    const quaCu = Date.parse("2026-07-01T16:37:00.000Z");
    assert.equal(mocGuiCuaTinZalo(String(quaCu), NHAN_LUC), NHAN_LUC.toISOString());
  });

  it("lệch đồng hồ nhẹ về tương lai (dưới 5 phút) vẫn nhận", () => {
    const som2Phut = NHAN_LUC.getTime() + 2 * 60 * 1000;
    assert.equal(mocGuiCuaTinZalo(String(som2Phut), NHAN_LUC), new Date(som2Phut).toISOString());
  });

  it("tương lai xa -> bỏ: không tin nào gửi được từ tương lai", () => {
    const namSau = Date.parse("2027-08-07T16:37:00.000Z");
    assert.equal(mocGuiCuaTinZalo(String(namSau), NHAN_LUC), NHAN_LUC.toISOString());
  });
});

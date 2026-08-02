import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  coCanHoiTruocKhiRoi,
  dangKyChuaLuu,
  xinPhepRoiTrang,
} from "./unsaved-changes-guard.js";

/**
 * Bất biến quan trọng nhất: HỦY đăng ký khi trang rời đi.
 *
 * Quên hủy thì chốt của trang cũ còn nằm đó, và mọi điều hướng sau đó - kể cả
 * của trang khác - đều bị hỏi oan bằng hộp thoại nói về một trang không còn mở.
 */

beforeEach(() => {
  dangKyChuaLuu(null);
});

describe("unsaved-changes-guard", () => {
  it("không đăng ký gì thì đi thẳng, không hỏi", async () => {
    assert.equal(coCanHoiTruocKhiRoi(), false);
    assert.equal(await xinPhepRoiTrang(), true);
  });

  it("đăng ký rồi thì phải hỏi, và trả đúng câu trả lời", async () => {
    dangKyChuaLuu(async () => false);
    assert.equal(coCanHoiTruocKhiRoi(), true);
    assert.equal(await xinPhepRoiTrang(), false, "người dùng bấm Ở lại thì không được đi");

    dangKyChuaLuu(async () => true);
    assert.equal(await xinPhepRoiTrang(), true, "bấm Rời đi thì được đi");
  });

  it("hủy đăng ký bằng null thì trở lại đi thẳng", async () => {
    dangKyChuaLuu(async () => false);
    dangKyChuaLuu(null);
    assert.equal(coCanHoiTruocKhiRoi(), false);
    assert.equal(await xinPhepRoiTrang(), true, "trang đã rời không được chặn trang khác");
  });

  it("đăng ký lần sau ghi đè lần trước - không chồng chốt", async () => {
    let soLanHoi = 0;
    dangKyChuaLuu(async () => {
      soLanHoi++;
      return true;
    });
    dangKyChuaLuu(async () => {
      soLanHoi++;
      return true;
    });
    await xinPhepRoiTrang();
    assert.equal(soLanHoi, 1, "chỉ chốt mới nhất được hỏi");
  });

  it("`coCanHoiTruocKhiRoi` là ĐỒNG BỘ - preventDefault không chờ promise được", () => {
    dangKyChuaLuu(async () => true);
    const kq = coCanHoiTruocKhiRoi();
    assert.equal(typeof kq, "boolean", "phải trả boolean ngay, không phải Promise");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeHtmlEntities } from "./html-entities.js";

describe("decodeHtmlEntities", () => {
  it("entity tên chữ thường - kiểu minhngoc.net.vn hay dùng", () => {
    assert.equal(decodeHtmlEntities("Ng&agrave;y quay: th&aacute;ng 7"), "Ngày quay: tháng 7");
  });

  it("entity tên viết hoa suy ra từ bảng chữ thường (CHUY&Ecirc;N -> CHUYÊN)", () => {
    assert.equal(decodeHtmlEntities("CHUY&Ecirc;N TRANG"), "CHUYÊN TRANG");
    assert.equal(decodeHtmlEntities("&Ocirc;ng &Agrave;"), "Ông À");
  });

  it("entity số thập phân và hex", () => {
    assert.equal(decodeHtmlEntities("Gi&#225; v&#224;ng"), "Giá vàng");
    assert.equal(decodeHtmlEntities("&#x1EA1;"), "ạ");
  });

  it("ký hiệu: nbsp, amp, trade, hellip", () => {
    assert.equal(decodeHtmlEntities("A&nbsp;&amp;&nbsp;B&hellip;"), "A & B...");
    assert.equal(decodeHtmlEntities("Minh Ngọc&trade;"), "Minh Ngọc(TM)");
  });

  it("entity không biết giữ nguyên, không throw", () => {
    assert.equal(decodeHtmlEntities("&khongbiet; &x;"), "&khongbiet; &x;");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { taoChotNen } from "./backdrop-close-guard.js";

const NEN = true;
const PANEL = false;

function chot() {
  let soLanDong = 0;
  const c = taoChotNen(() => soLanDong++);
  return { ...c, soLanDong: () => soLanDong };
}

describe("backdrop-close-guard", () => {
  it("bấm nền rồi thả trên nền thì đóng - đây là thao tác đóng modal thật", () => {
    const c = chot();
    c.bamXuong(NEN);
    c.tha(NEN);
    assert.equal(c.soLanDong(), 1);
  });

  it("bấm TRONG panel rồi kéo thả ra nền thì KHÔNG đóng - chính là lỗi đang sửa", () => {
    const c = chot();
    c.bamXuong(PANEL);
    c.tha(NEN);
    assert.equal(c.soLanDong(), 0);
  });

  it("bấm ngoài nền rồi kéo thả vào panel cũng KHÔNG đóng", () => {
    const c = chot();
    c.bamXuong(NEN);
    c.tha(PANEL);
    assert.equal(c.soLanDong(), 0);
  });

  it("bấm và thả đều trong panel thì không đóng", () => {
    const c = chot();
    c.bamXuong(PANEL);
    c.tha(PANEL);
    assert.equal(c.soLanDong(), 0);
  });

  it("click lạc không có lần bấm xuống nào đi trước thì không đóng", () => {
    const c = chot();
    c.tha(NEN);
    assert.equal(c.soLanDong(), 0);
  });

  it("cờ tự xóa sau mỗi lần thả: kéo hợp lệ xong, một click lạc sau đó không ăn theo", () => {
    const c = chot();
    c.bamXuong(NEN);
    c.tha(NEN);
    // Không có `bamXuong` nào ở giữa - cờ còn sót lại thì lần này đóng lần hai
    c.tha(NEN);
    assert.equal(c.soLanDong(), 1);
  });

  it("kéo hỏng không để lại cờ cho lần kéo sau", () => {
    const c = chot();
    c.bamXuong(PANEL);
    c.tha(NEN);
    c.tha(NEN);
    assert.equal(c.soLanDong(), 0);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OXlsx, SheetDaDoc } from "../knowledge/extract-xlsx-sheets.js";
import { thongKeSheet } from "./thong-ke-sheet.js";

const chu = (giaTri: string): OXlsx => ({ giaTri, laSo: false, laCongThuc: false });
const so = (giaTri: string, laCongThuc = false): OXlsx => ({ giaTri, laSo: true, laCongThuc });
const sheet = (hang: OXlsx[][]): SheetDaDoc => ({ ten: "S", hienThi: "hien", hang });

describe("thongKeSheet - máy chủ tự cộng, không để model cộng nhẩm", () => {
  it("cộng ô số của từng cột, bỏ ô công thức (dòng TỔNG) và ô chuỗi", () => {
    const tk = thongKeSheet(
      sheet([
        [chu("NGÀY"), chu("SỐ CÂY"), chu("GHI CHÚ")],
        [chu("3/4"), so("95"), chu("a")],
        [chu("3/7"), so("114"), chu("9.356")],
        [chu("3/10"), so("37.5"), chu("")],
        [chu("TỔNG"), so("246.5", true), chu("")],
      ]),
    );
    assert.equal(tk.soHangDuLieu, 4);
    assert.deepEqual(tk.cot, [{ cot: "SỐ CÂY", tong: 246.5, soO: 3 }]);
    assert.equal(tk.soOCongThuc, 1);
  });

  it("cột không có tiêu đề lấy tên cột Excel", () => {
    const tk = thongKeSheet(sheet([[chu("A")], [chu("x"), chu(""), so("2")], [chu("y"), chu(""), so("3")]]));
    assert.deepEqual(tk.cot, [{ cot: "C", tong: 5, soO: 2 }]);
  });

  it("dòng trống trên cùng không bị lấy làm tiêu đề; sheet rỗng ra 0", () => {
    const tk = thongKeSheet(sheet([[chu(""), chu("")], [chu("Tên"), chu("Số")], [chu("a"), so("1")]]));
    assert.equal(tk.soHangDuLieu, 1);
    assert.deepEqual(tk.cot, [{ cot: "Số", tong: 1, soO: 1 }]);
    assert.deepEqual(thongKeSheet(sheet([])), { soHangDuLieu: 0, cot: [], soOCongThuc: 0 });
  });

  it("dòng tựa đề phía trên (BÁO CÁO THÁNG 3) không bị lấy làm tiêu đề cột", () => {
    const tk = thongKeSheet(
      sheet([
        [chu("BÁO CÁO THÁNG 3")],
        [chu("Ngày"), chu("Số cây")],
        [chu("3/4"), so("95")],
        [chu("3/7"), so("5")],
      ]),
    );
    assert.equal(tk.soHangDuLieu, 2);
    assert.deepEqual(tk.cot, [{ cot: "Số cây", tong: 100, soO: 2 }]);
  });

  it("cộng số thực không trôi dấu phẩy động (0,1 + 0,2)", () => {
    const tk = thongKeSheet(sheet([[chu("x")], [so("0.1")], [so("0.2")]]));
    assert.equal(tk.cot[0]!.tong, 0.3);
  });
});

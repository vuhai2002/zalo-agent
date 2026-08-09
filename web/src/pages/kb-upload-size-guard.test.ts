import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  layNhanTranDungLuong,
  layTranDungLuongMB,
  layThongDiepVuotTran,
  vuotTranDungLuong,
} from "./kb-upload-size-guard";

describe("vuotTranDungLuong (I20 - chặn cỡ file ở client)", () => {
  it("đúng bằng trần thì KHÔNG bị chặn - khớp hono/body-limit dùng size > maxSize", () => {
    assert.equal(vuotTranDungLuong(7 * 1024 * 1024, 7), false);
  });

  it("vượt 1 byte thì bị chặn", () => {
    assert.equal(vuotTranDungLuong(7 * 1024 * 1024 + 1, 7), true);
  });

  it("file nhỏ hơn hẳn trần thì qua", () => {
    assert.equal(vuotTranDungLuong(1024, 20), false);
  });
});

describe("layTranDungLuongMB (đọc trần từ GET /api/tuning, không hard-code)", () => {
  it("đọc đúng giá trị KB_MAX_FILE_MB từ mảng values", () => {
    assert.equal(
      layTranDungLuongMB([
        { key: "OTHER_KEY", value: 999 },
        { key: "KB_MAX_FILE_MB", value: 7 },
      ]),
      7,
    );
  });

  it("chưa có trong mảng (chưa tải xong / API lỗi) -> null, KHÔNG đoán số", () => {
    assert.equal(layTranDungLuongMB([]), null);
  });

  it("giá trị không phải number (dữ liệu hỏng) -> null, không tin liều", () => {
    assert.equal(layTranDungLuongMB([{ key: "KB_MAX_FILE_MB", value: "20" }]), null);
  });
});

describe("layNhanTranDungLuong (chuỗi hiện trên modal)", () => {
  it("có trần thì hiện đúng số kèm MB", () => {
    assert.match(layNhanTranDungLuong(7), /7\s*MB/);
  });

  it("chưa có trần (null) thì rỗng - không hiện số bịa", () => {
    assert.equal(layNhanTranDungLuong(null), "");
  });
});

describe("layThongDiepVuotTran", () => {
  it("nói rõ vượt quá bao nhiêu MB", () => {
    assert.match(layThongDiepVuotTran("bao-cao.pdf", 20), /vượt quá/i);
    assert.match(layThongDiepVuotTran("bao-cao.pdf", 20), /20\s*MB/);
  });
});

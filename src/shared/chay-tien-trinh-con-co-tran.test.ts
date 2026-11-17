import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chayTienTrinhCon,
  LoiTienTrinhConBiNgat,
  LoiTuTienTrinhCon,
  urlScriptCon,
  type TranTienTrinhCon,
} from "./chay-tien-trinh-con-co-tran.js";

const SCRIPT = urlScriptCon("./fixtures/tien-trinh-con-thu-nghiem", import.meta.url);
const TRAN: TranTienTrinhCon = { hanMs: 20_000, tranRssMb: 400, tranHeapMb: 128 };

const MB = 1024 * 1024;

describe("chayTienTrinhCon", () => {
  it("trả về đúng giá trị con gửi, kể cả Buffer (IPC advanced)", async () => {
    const kq = await chayTienTrinhCon<unknown, { a: number; b: Buffer }>({
      script: SCRIPT,
      duLieu: { lenh: "tra-ve", giaTri: { a: 1, b: Buffer.from("xin chào") } },
      tran: TRAN,
    });
    assert.equal(kq.a, 1);
    assert.equal(Buffer.from(kq.b).toString("utf-8"), "xin chào");
  });

  it("vòng lặp đồng bộ vô hạn bị giết theo hanMs, lý do het-gio", async () => {
    const batDau = Date.now();
    await assert.rejects(
      chayTienTrinhCon({ script: SCRIPT, duLieu: { lenh: "lap-vo-han" }, tran: { ...TRAN, hanMs: 1500 } }),
      (err: unknown) => err instanceof LoiTienTrinhConBiNgat && err.lyDo === "het-gio",
    );
    assert.ok(Date.now() - batDau < 6000, "phải bị cắt gần mốc hanMs");
  });

  it("cấp phát NGOÀI heap vượt tranRssMb bị giết, lý do vuot-ram, tiến trình cha không phình", async () => {
    const rssTruoc = process.memoryUsage().rss;
    await assert.rejects(
      chayTienTrinhCon({
        script: SCRIPT,
        duLieu: { lenh: "cap-phat-ngoai-heap", mb: 400 },
        tran: { ...TRAN, tranRssMb: 160 },
      }),
      (err: unknown) => err instanceof LoiTienTrinhConBiNgat && err.lyDo === "vuot-ram",
    );
    assert.ok(process.memoryUsage().rss - rssTruoc < 50 * MB, "RSS của cha không được phình theo con");
  });

  it("số RSS đo từ ngoài (tiêm) vượt trần thì giết ngay, không cần chờ con tự báo", async () => {
    await assert.rejects(
      chayTienTrinhCon({
        script: SCRIPT,
        duLieu: { lenh: "lap-vo-han" },
        tran: TRAN,
        docRssMb: () => 9999,
      }),
      (err: unknown) => err instanceof LoiTienTrinhConBiNgat && err.lyDo === "vuot-ram",
    );
  });

  it("lỗi do chính con báo đi bằng LoiTuTienTrinhCon mang mã có kiểu, KHÔNG phải bị ngắt", async () => {
    await assert.rejects(
      chayTienTrinhCon({ script: SCRIPT, duLieu: { lenh: "nem-loi", ma: "mat-khau" }, tran: TRAN }),
      (err: unknown) =>
        err instanceof LoiTuTienTrinhCon && !(err instanceof LoiTienTrinhConBiNgat) && err.ma === "mat-khau",
    );
  });

  it("con thoát mà không trả gì -> chet-bat-thuong", async () => {
    await assert.rejects(
      chayTienTrinhCon({ script: SCRIPT, duLieu: { lenh: "thoat-im" }, tran: TRAN }),
      (err: unknown) => err instanceof LoiTienTrinhConBiNgat && err.lyDo === "chet-bat-thuong",
    );
  });

  it("urlScriptCon chọn đuôi theo đuôi của module gọi (dev .ts, dist .js)", () => {
    assert.ok(urlScriptCon("./x", "file:///a/b.ts").href.endsWith("/a/x.ts"));
    assert.ok(urlScriptCon("./x", "file:///a/b.js").href.endsWith("/a/x.js"));
  });
});

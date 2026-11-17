import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LoiTaiVe, type DownloadOptions, type RemoteFile } from "../shared/safe-remote-download.js";
import { HOST_TEP_ZALO, taiTepZalo } from "./tai-tep-zalo.js";

const tra = (data: Buffer, mediaType = "application/octet-stream") => async (): Promise<RemoteFile> => ({
  data,
  mediaType,
  fileName: "x",
});
const nem = (err: Error) => async (): Promise<RemoteFile> => {
  throw err;
};

describe("taiTepZalo", () => {
  it("gọi tải với allowlist host Zalo, chỉ https, có hạn chót tổng và trần byte", async () => {
    let opts: DownloadOptions | undefined;
    const kq = await taiTepZalo("https://file-stal-1.dlfl.vn/gr/a/b", 1000, async (_u, o) => {
      opts = o;
      return { data: Buffer.from("%PDF-1.4"), mediaType: "application/pdf", fileName: "b" };
    });
    assert.equal(kq.ok, true);
    assert.deepEqual(opts?.hostDuocPhep, HOST_TEP_ZALO);
    assert.equal(opts?.chiHttps, true);
    assert.equal(opts?.maxBytes, 1000);
    assert.ok((opts?.hanTongMs ?? 0) > 0);
  });

  it("403/404/410 -> het-han", async () => {
    for (const st of [403, 404, 410]) {
      const kq = await taiTepZalo("https://fg1.dlfl.vn/x", 1000, nem(new LoiTaiVe("http", `HTTP ${st}`, st)));
      assert.deepEqual(kq, { ok: false, ma: "het-han" }, `HTTP ${st}`);
    }
  });

  it('200 kèm JSON/chữ nhỏ "expired" hoặc "invalid signature" -> het-han; 200 rỗng -> het-han', async () => {
    assert.deepEqual(await taiTepZalo("https://fg1.dlfl.vn/x", 1000, tra(Buffer.from('{"error":"expired"}'), "application/json")), {
      ok: false,
      ma: "het-han",
    });
    assert.deepEqual(await taiTepZalo("https://fg1.dlfl.vn/x", 1000, tra(Buffer.from("Invalid signature"), "text/plain")), {
      ok: false,
      ma: "het-han",
    });
    assert.deepEqual(await taiTepZalo("https://fg1.dlfl.vn/x", 1000, nem(new LoiTaiVe("rong", "Nội dung rỗng"))), {
      ok: false,
      ma: "het-han",
    });
  });

  it("tệp chữ NHỎ thật (.txt/.csv/.json) có chữ 'expired' không bị nhầm là link hết hạn", async () => {
    for (const duoi of ["txt", "csv", "json", "md"]) {
      const kq = await taiTepZalo("https://fg1.dlfl.vn/x", 1000, tra(Buffer.from("ERROR: token expired at 10:31"), "text/plain"), duoi);
      assert.equal(kq.ok, true, duoi);
    }
  });

  it("tệp .txt thật có chữ 'expired' nhưng LỚN thì không bị nhầm là hết hạn", async () => {
    const kq = await taiTepZalo("https://fg1.dlfl.vn/x", 100_000, tra(Buffer.from(`expired ${"x".repeat(5000)}`), "text/plain"));
    assert.equal(kq.ok, true);
  });

  it("vượt trần -> qua-lon; host lạ -> host-la; lỗi mạng khác -> mang", async () => {
    assert.deepEqual(await taiTepZalo("https://fg1.dlfl.vn/x", 10, nem(new LoiTaiVe("qua-lon", "vượt"))), { ok: false, ma: "qua-lon" });
    assert.deepEqual(await taiTepZalo("https://fg1.dlfl.vn/x", 10, nem(new LoiTaiVe("host-la", "chặn"))), { ok: false, ma: "host-la" });
    assert.deepEqual(await taiTepZalo("https://fg1.dlfl.vn/x", 10, nem(new LoiTaiVe("http", "HTTP 500", 500))), { ok: false, ma: "mang" });
    assert.deepEqual(await taiTepZalo("https://fg1.dlfl.vn/x", 10, nem(new Error("ECONNRESET"))), { ok: false, ma: "mang" });
  });
});

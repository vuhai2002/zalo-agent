import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Lấy byte video vào RAM.
 *
 * Điều đáng canh nhất ở đây KHÔNG phải chuyện tải được hay không, mà là hai thứ
 * hỏng CÂM: (a) `-o -` viết sai thì yt-dlp ghi ra ĐĨA - đúng thứ người dùng nói
 * họ ngại (bào SSD, để lại rác); (b) bộ chọn format có nhánh ghép hình+tiếng
 * thì yt-dlp chọn xong mới chết vì thiếu ffmpeg, và lỗi hạ tầng đó rơi vào câu
 * chung "video có thể ở chế độ riêng tư".
 *
 * PHẢI `setupTestEnv()` trước rồi mới `await import()`: module này bắc cầu tới
 * `src/config/env.ts`, mà module đó `process.exit(1)` khi env không hợp lệ.
 */

let dataDir: string;
let mod: typeof import("./tai-video-vao-ram.js");

before(async () => {
  dataDir = setupTestEnv();
  mod = await import("./tai-video-vao-ram.js");
});

after(() => cleanupTestEnv(dataDir));

const TRAN = 50 * 1024 * 1024;

/* eslint-disable @typescript-eslint/no-explicit-any */
const phuThuoc = (p: Partial<import("./tai-video-vao-ram.js").PhuThuocTai>) =>
  ({
    taiUrl: async () => ({ data: Buffer.alloc(0), mediaType: "video/mp4", fileName: "v.mp4" }),
    chay: async () => ({ ok: true, stdout: "", stdoutNhiPhan: Buffer.alloc(0) }),
    ...p,
  }) as any;

describe("đối số yt-dlp - hai cờ hỏng câm", () => {
  it("`-o -` xuất ra stdout, KHÔNG ghi ra đĩa", () => {
    const d = mod.doiSoTaiYtDlp("https://x", TRAN);
    assert.equal(d[d.indexOf("-o") + 1], "-", "sai chỗ này là yt-dlp ghi file ra đĩa");
  });

  it("bộ chọn format KHÔNG có nhánh ghép hình+tiếng - image không cài ffmpeg", () => {
    const f = mod.doiSoTaiYtDlp("https://x", TRAN)[
      mod.doiSoTaiYtDlp("https://x", TRAN).indexOf("-f") + 1
    ] as string;
    assert.ok(!f.includes("+"), `nhánh ghép cần ffmpeg: ${f}`);
    assert.ok(f.includes("mp4"), "phải ưu tiên mp4 để Zalo phát được");
  });

  it("chở NGUYÊN bộ chọn chung (gồm -S ưu tiên h264) - hai đường yt-dlp phải khớp", async () => {
    // Đường tải và đường metadata là hai lời gọi yt-dlp RIÊNG. Lệch bộ chọn thì
    // bot khai kích thước của format này nhưng gửi byte format khác - đã làm
    // crash app Zalo trên điện thoại. Cả hai lấy đối số từ `argsChonFormat`.
    const chon = await import("./chon-format-video.js");
    const d = mod.doiSoTaiYtDlp("https://x", TRAN);
    assert.ok(
      d.join(" ").includes(chon.argsChonFormat().join(" ")),
      `thiếu bộ chọn chung: ${chon.argsChonFormat().join(" ")}`,
    );
  });

  it("chở trần dung lượng xuống yt-dlp để nó chặn TRƯỚC khi tải", () => {
    const d = mod.doiSoTaiYtDlp("https://x", 12_345);
    assert.equal(d[d.indexOf("--max-filesize") + 1], "12345");
  });

  it("URL đứng CUỐI, sau mọi cờ - đứng trước là nó ăn mất giá trị của cờ", () => {
    const d = mod.doiSoTaiYtDlp("https://vt.tiktok.com/ABC/", TRAN);
    assert.equal(d[d.length - 1], "https://vt.tiktok.com/ABC/");
  });
});

describe("yt-dlp tự tải", () => {
  it("xin stdout NHỊ PHÂN và trần buffer rộng hơn trần video", async () => {
    let tuyChon: any = null;
    await mod.taiBangYtDlpVaoRam(
      "https://x",
      TRAN,
      phuThuoc({
        chay: async (_d: string[], _t: number, tc: unknown) => {
          tuyChon = tc;
          return { ok: true, stdout: "", stdoutNhiPhan: Buffer.from([1, 2, 3]) };
        },
      }),
    );
    assert.equal(tuyChon.nhiPhan, true, "ép về chuỗi là hỏng file");
    assert.ok(tuyChon.tranStdout > TRAN, "trần buffer phải rộng hơn cả video");
  });

  it("trả về byte và ghi đúng ĐƯỜNG đã đi", async () => {
    const r = await mod.taiBangYtDlpVaoRam(
      "https://x",
      TRAN,
      phuThuoc({ chay: async () => ({ ok: true, stdout: "", stdoutNhiPhan: Buffer.alloc(99) }) }),
    );
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.byte.length, 99);
    assert.equal(r.ok && r.duong, "yt-dlp");
  });

  it("stdout RỖNG mà thoát mã 0 vẫn là HỎNG - đó là ca vượt --max-filesize", async () => {
    // yt-dlp không báo lỗi khi bỏ qua file quá cỡ, nó chỉ không xuất gì. Coi đó
    // là thành công thì ta upload một buffer rỗng lên Zalo.
    const r = await mod.taiBangYtDlpVaoRam(
      "https://x",
      TRAN,
      phuThuoc({ chay: async () => ({ ok: true, stdout: "", stdoutNhiPhan: Buffer.alloc(0) }) }),
    );
    assert.equal(r.ok, false);
  });

  it("thiếu hẳn stdoutNhiPhan cũng là hỏng, không ném", async () => {
    const r = await mod.taiBangYtDlpVaoRam(
      "https://x",
      TRAN,
      phuThuoc({ chay: async () => ({ ok: true, stdout: "" }) }),
    );
    assert.equal(r.ok, false);
  });

  it("buffer vượt trần thì CHẶN - `--max-filesize` vô hiệu khi nguồn không khai cỡ", async () => {
    const r = await mod.taiBangYtDlpVaoRam(
      "https://x",
      100,
      phuThuoc({ chay: async () => ({ ok: true, stdout: "", stdoutNhiPhan: Buffer.alloc(101) }) }),
    );
    assert.equal(r.ok, false);
  });

  it("chở cờ `loiCauHinh` lên nguyên vẹn - đây là lỗi người VẬN HÀNH phải sửa", async () => {
    // Mất cờ này thì "máy chủ chưa cài yt-dlp" bị nói thành "video ở chế độ
    // riêng tư", và người dùng thử lại vô ích.
    const r = await mod.taiBangYtDlpVaoRam(
      "https://x",
      TRAN,
      phuThuoc({ chay: async () => ({ ok: false, loi: "No module named yt_dlp", loiCauHinh: true }) }),
    );
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.loiCauHinh, true);
  });
});

describe("tải thẳng từ URL", () => {
  it("chở trần dung lượng xuống bộ tải có gác", async () => {
    let opt: any = null;
    await mod.taiTuUrlVaoRam(
      "https://cdn/x.mp4",
      777,
      phuThuoc({
        taiUrl: async (_u: string, o: unknown) => {
          opt = o;
          return { data: Buffer.alloc(10), mediaType: "video/mp4", fileName: "v.mp4" };
        },
      }),
    );
    assert.equal(opt.maxBytes, 777, "không chở trần xuống là tải hết rồi mới biết");
  });

  it("tải về rỗng là hỏng, không phải thành công", async () => {
    const r = await mod.taiTuUrlVaoRam("https://x", TRAN, phuThuoc({}));
    assert.equal(r.ok, false);
  });

  it("bộ tải NÉM thì trả kết quả hỏng, không để ngoại lệ thoát ra", async () => {
    const r = await mod.taiTuUrlVaoRam(
      "https://x",
      TRAN,
      phuThuoc({
        taiUrl: async () => {
          throw new Error("vượt trần dung lượng");
        },
      }),
    );
    assert.equal(r.ok, false);
    assert.match(r.ok === false ? r.loi : "", /vượt trần/);
  });
});

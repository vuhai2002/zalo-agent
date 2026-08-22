import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { KetQuaChayYtDlp } from "./chay-yt-dlp.js";

/**
 * Đường để yt-dlp TỰ TẢI file về. File này trước đây có **0 test**, và ba phép
 * phá đều xanh: bỏ cửa chặn thoát thư mục, bỏ trần dung lượng, bỏ cửa file rỗng.
 *
 * Cửa chặn thoát thư mục là cửa DUY NHẤT giữ `%(ext)s` - phần do extractor của
 * yt-dlp suy ra, tức dữ liệu chịu ảnh hưởng của bên ngoài - khỏi đẩy file ra
 * khỏi thư mục tạm rồi được gửi đi.
 *
 * Tiêm `chayYtDlp` từ ngoài thay vì chạy tiến trình thật: chạy thật thì test
 * phụ thuộc mạng, phụ thuộc video mẫu còn sống, và TikTok vốn chập chờn 3/7 -
 * đỏ vì lý do chẳng liên quan tới luật đang đo.
 */

let dataDir: string;
let mod: typeof import("./tai-bang-yt-dlp.js");

before(async () => {
  dataDir = setupTestEnv();
  mod = await import("./tai-bang-yt-dlp.js");
});

after(() => cleanupTestEnv(dataDir));

let thuMuc: string;
beforeEach(() => {
  thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), "tai-yt-"));
});

/** Giả lập yt-dlp: tạo file ở `noiTao` rồi in đường dẫn `inRa` ra stdout */
function chayGia(inRa: string, noiTao?: string, coByte = 1024): typeof import("./chay-yt-dlp.js").chayYtDlp {
  return async (): Promise<KetQuaChayYtDlp> => {
    const p = noiTao ?? inRa;
    if (p !== "") {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, Buffer.alloc(coByte));
    }
    return { ok: true, stdout: `${inRa}\n` };
  };
}

const TRAN = 10 * 1024 * 1024;

describe("chặn yt-dlp ghi file ra NGOÀI thư mục tạm", () => {
  it("file trong thư mục thì nhận", async () => {
    const p = path.join(thuMuc, "v.mp4");
    const r = await mod.taiVideoBangYtDlp("https://x", thuMuc, TRAN, chayGia(p));
    assert.ok(r.ok);
    assert.equal(r.duongDan, path.resolve(p));
  });

  it("yt-dlp in ra đường dẫn Ở THƯ MỤC CHA thì TỪ CHỐI", async () => {
    // `%(ext)s` do extractor suy ra. Cửa này là lớp cuối trước khi file được
    // GỬI ĐI - từ chối chứ không gửi bừa.
    const ngoai = path.join(path.dirname(thuMuc), "pwned.mp4");
    const r = await mod.taiVideoBangYtDlp("https://x", thuMuc, TRAN, chayGia(ngoai));
    fs.rmSync(ngoai, { force: true });

    assert.equal(r.ok, false);
    assert.match((r as { loi: string }).loi, /ngoài thư mục/i);
  });

  it("đường dẫn tuyệt đối ở nơi khác hẳn cũng TỪ CHỐI", async () => {
    const ngoai = path.join(os.tmpdir(), "khong-lien-quan.mp4");
    const r = await mod.taiVideoBangYtDlp("https://x", thuMuc, TRAN, chayGia(ngoai));
    fs.rmSync(ngoai, { force: true });
    assert.equal(r.ok, false);
  });

  it("thư mục CON của thư mục tạm cũng TỪ CHỐI - luật là ĐÚNG một cấp", async () => {
    const con = path.join(thuMuc, "sub", "v.mp4");
    const r = await mod.taiVideoBangYtDlp("https://x", thuMuc, TRAN, chayGia(con));
    assert.equal(r.ok, false);
  });
});

describe("đọc đường dẫn từ stdout", () => {
  it("stdout RỖNG nghĩa là không tạo được file - đây là ca vượt --max-filesize", async () => {
    // Vượt trần khai báo thì yt-dlp thoát mã 0 và KHÔNG in `after_move:filepath`
    // (nó bỏ cuộc trước khi có file để mà move).
    const r = await mod.taiVideoBangYtDlp("https://x", thuMuc, TRAN, async () => ({ ok: true, stdout: "  \n" }));
    assert.equal(r.ok, false);
    assert.match((r as { loi: string }).loi, /không tạo được file/i);
  });

  it("nhiều dòng thì lấy dòng CUỐI - `--print` in sau các dòng khác", async () => {
    const p = path.join(thuMuc, "v.mp4");
    fs.writeFileSync(p, Buffer.alloc(64));
    const r = await mod.taiVideoBangYtDlp("https://x", thuMuc, TRAN, async () => ({
      ok: true,
      stdout: `[download] Destination: ${p}\n${p}\n`,
    }));
    assert.ok(r.ok);
    assert.equal(r.duongDan, path.resolve(p));
  });

  it("yt-dlp báo xong nhưng file KHÔNG tồn tại thì hỏng, không ném", async () => {
    const p = path.join(thuMuc, "khong-co.mp4");
    const r = await mod.taiVideoBangYtDlp("https://x", thuMuc, TRAN, async () => ({ ok: true, stdout: `${p}\n` }));
    assert.equal(r.ok, false);
    assert.match((r as { loi: string }).loi, /không thấy file/i);
  });
});

describe("trần dung lượng - lưới đỡ cho --max-filesize", () => {
  it("file VƯỢT trần thì TỪ CHỐI, kể cả khi yt-dlp đã tải xong", async () => {
    // `--max-filesize` xét theo dung lượng KHAI BÁO. ĐO THẬT: nguồn không khai
    // `content-length` thì cờ đó vô hiệu và 41.944.076 byte xuống đĩa dù trần
    // là 1 MB. Cửa này là thứ duy nhất giữ file đó khỏi được GỬI ĐI.
    const p = path.join(thuMuc, "v.mp4");
    const r = await mod.taiVideoBangYtDlp("https://x", thuMuc, 1024, chayGia(p, undefined, 4096));
    assert.equal(r.ok, false);
    assert.match((r as { loi: string }).loi, /vượt giới hạn/i);
  });

  it("đúng bằng trần thì vẫn nhận", async () => {
    const p = path.join(thuMuc, "v.mp4");
    const r = await mod.taiVideoBangYtDlp("https://x", thuMuc, 1024, chayGia(p, undefined, 1024));
    assert.ok(r.ok);
    assert.equal(r.soByte, 1024);
  });

  it("file RỖNG là hỏng, không phải thành công cỡ 0", async () => {
    // File 0 byte gửi lên Zalo thành một video không mở được - người nhận không
    // biết là hỏng, tệ hơn hẳn một câu báo lỗi.
    const p = path.join(thuMuc, "v.mp4");
    const r = await mod.taiVideoBangYtDlp("https://x", thuMuc, TRAN, chayGia(p, undefined, 0));
    assert.equal(r.ok, false);
    assert.match((r as { loi: string }).loi, /rỗng/i);
  });
});

describe("chở cờ loiCauHinh lên trên", () => {
  it("thiếu công cụ thì cờ đi tới nơi, KHÔNG bị nuốt", async () => {
    // Thiếu cờ này là người vận hành nhận câu "gửi video thất bại" trong khi
    // bệnh nằm ở Dockerfile.
    const r = await mod.taiVideoBangYtDlp("https://x", thuMuc, TRAN, async () => ({
      ok: false,
      loi: "Máy chủ chưa cài yt-dlp...",
      loiCauHinh: true,
    }));
    assert.equal(r.ok, false);
    assert.equal((r as { loiCauHinh?: boolean }).loiCauHinh, true);
  });

  it("lỗi thường thì KHÔNG bật cờ - báo nhầm là bảo người ta đi cài thứ không cần cài", async () => {
    const r = await mod.taiVideoBangYtDlp("https://x", thuMuc, TRAN, async () => ({
      ok: false,
      loi: "ERROR: video riêng tư",
    }));
    assert.equal(r.ok, false);
    assert.ok(!(r as { loiCauHinh?: boolean }).loiCauHinh);
  });
});

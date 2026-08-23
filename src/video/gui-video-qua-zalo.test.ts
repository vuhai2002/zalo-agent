import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { ThongTinVideo } from "./thong-tin-video.js";

/**
 * Đường gửi video. Mọi luật ở đây đều đến từ một lượt gửi HỎNG THẬT tới điện
 * thoại người dùng, nên đừng nới cái nào mà không đo lại:
 *
 *   - `sendVideo` phải nhận URL CỦA ZALO. Đưa URL TikTok/Facebook thì máy tính
 *     xem được còn ĐIỆN THOẠI KHÔNG - đã đo bằng ba biến thể cùng một video.
 *   - Khung hình phải đọc từ CHÍNH BUFFER sắp gửi. Khai sai làm ứng dụng Zalo
 *     trên điện thoại CRASH; TikWM không trả kích thước, yt-dlp thì khai lệch.
 *   - Ảnh bìa phải là ảnh của Zalo. Host ngoài thì thẻ video hiện đen thui.
 */

let dataDir: string;
let mod: typeof import("./gui-video-qua-zalo.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  mod = await import("./gui-video-qua-zalo.js");
  database = await import("../conversation/database.js");
});

after(() => {
  // Module này kéo theo `runtime-tuning-settings` -> `database.js`, vốn mở
  // SQLite ở MODULE SCOPE. Còn handle mở thì `rmSync` trên Windows trả EPERM.
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

/**
 * Dựng một MP4 tối thiểu có `tkhd` khai đúng khung hình.
 *
 * Dùng buffer thật thay vì mock bộ đọc: điều cần canh là "khung hình đến từ
 * FILE chứ không từ metadata của nguồn", mà mock bộ đọc thì đúng chỗ đó bị che.
 */
function dungMp4(width: number, height: number): Buffer {
  const tkhd = Buffer.alloc(92);
  tkhd.writeUInt32BE(92, 0);
  tkhd.write("tkhd", 4, "latin1");
  const than = 8;
  // Ma trận đơn vị: phần tử a = 1.0 (16.16) ở đầu -> không xoay
  tkhd.writeUInt32BE(0x00010000, than + 40);
  tkhd.writeUInt32BE(Math.round(width * 65536), than + 76);
  tkhd.writeUInt32BE(Math.round(height * 65536), than + 80);

  const trak = Buffer.alloc(8);
  trak.writeUInt32BE(8 + tkhd.length, 0);
  trak.write("trak", 4, "latin1");

  const moov = Buffer.alloc(8);
  moov.writeUInt32BE(8 + trak.length + tkhd.length, 0);
  moov.write("moov", 4, "latin1");

  const ftyp = Buffer.alloc(16);
  ftyp.writeUInt32BE(16, 0);
  ftyp.write("ftypisom", 4, "latin1");

  return Buffer.concat([ftyp, moov, trak, tkhd]);
}

const VIDEO: ThongTinVideo = {
  videoUrl: "https://cdn.test/cdn-cua-nguon.mp4",
  thumbnailUrl: "https://cdn.test/anh-bia-cua-nguon.jpg",
  durationMs: 20_000,
  // CỐ Ý sai và CỐ Ý là DỌC: buffer bên dưới khai NGANG. Ca crash thật đúng
  // hình dạng này - nguồn nói dọc, file thật là ngang.
  width: 576,
  height: 1024,
  fileSize: 1_000_000,
  tacGia: "nguoidang",
  nguon: "tikwm",
  nenTang: "tiktok",
};
const URL_GOC = "https://vt.tiktok.com/ABC123/";
const TRAN = 100 * 1024 * 1024;
const URL_ZALO = "https://ot147.dlfl.vn/abc/123";
const ANH_BIA_ZALO = "https://photo-link-talk.zadn.vn/photolinkv2/720/zlv2abc";

type Viec =
  | { k: "do"; url: string }
  | { k: "taiUrl"; url: string }
  | { k: "taiYtDlp"; url: string }
  | { k: "anhBia"; url: string }
  | { k: "upload"; byte: number; ten: string }
  | { k: "sendVideo"; url: string; thumb: string; w: number; h: number };
let daLam: Viec[] = [];
let demCa = 0;

let ketDo: import("./kiem-url-video-truoc-khi-gui.js").KetQuaDo;
let byteTai: Buffer;
let loiTai: { loi: string; loiCauHinh?: boolean } | null;
let anhBiaZalo: string | null;
let ketUpload: unknown;

beforeEach(() => {
  daLam = [];
  ketDo = {
    ok: true,
    soByte: 5_000_000,
    kieuNoiDung: "video/mp4",
    urlCuoi: VIDEO.videoUrl,
  };
  byteTai = dungMp4(1002, 576); // NGANG - khác hẳn 576x1024 nguồn khai
  loiTai = null;
  anhBiaZalo = ANH_BIA_ZALO;
  ketUpload = [{ fileUrl: URL_ZALO }];
});

function dich() {
  return {
    api: {
      uploadAttachment: async (ds: { data: Buffer; filename: string }[]) => {
        daLam.push({ k: "upload", byte: ds[0]!.data.length, ten: ds[0]!.filename });
        return ketUpload;
      },
      sendVideo: async (o: { videoUrl: string; thumbnailUrl: string; width: number; height: number }) => {
        daLam.push({ k: "sendVideo", url: o.videoUrl, thumb: o.thumbnailUrl, w: o.width, h: o.height });
        return {};
      },
    } as never,
    threadKey: `acc:${++demCa}`,
    threadId: "t1",
    threadType: 0 as never,
  };
}

function phuThuoc(): import("./gui-video-qua-zalo.js").PhuThuocGuiVideo {
  return {
    kiemUrl: async (u: string) => {
      daLam.push({ k: "do", url: u });
      return ketDo;
    },
    taiUrl: async (u: string) => {
      daLam.push({ k: "taiUrl", url: u });
      if (loiTai) return { ok: false as const, ...loiTai };
      return { ok: true as const, byte: byteTai, duong: "url" as const };
    },
    taiYtDlp: async (u: string) => {
      daLam.push({ k: "taiYtDlp", url: u });
      if (loiTai) return { ok: false as const, ...loiTai };
      return { ok: true as const, byte: byteTai, duong: "yt-dlp" as const };
    },
    layAnhBia: async (_api, u: string) => {
      daLam.push({ k: "anhBia", url: u });
      return anhBiaZalo;
    },
  };
}

const chay = () => mod.guiVideoQuaZalo(dich(), VIDEO, URL_GOC, TRAN, phuThuoc());
const tinGui = () => daLam.find((v) => v.k === "sendVideo") as Extract<Viec, { k: "sendVideo" }>;

describe("sendVideo phải nhận URL CỦA ZALO", () => {
  it("gửi đúng URL Zalo trả về sau upload, không phải URL của nguồn", async () => {
    // Đây là cả lý do tồn tại của bước upload: đo bằng lượt gửi thật, URL của
    // TikTok/Facebook thì điện thoại KHÔNG xem được.
    await chay();
    assert.equal(tinGui().url, URL_ZALO);
    assert.notEqual(tinGui().url, VIDEO.videoUrl);
  });

  it("upload đúng số byte đã tải, tên file có đuôi .mp4", async () => {
    await chay();
    const up = daLam.find((v) => v.k === "upload") as Extract<Viec, { k: "upload" }>;
    assert.equal(up.byte, byteTai.length);
    assert.match(up.ten, /\.mp4$/, "sai đuôi thì Zalo không nhận là video");
  });

  it("upload KHÔNG trả về đường dẫn thì NÉM, không gửi tin nào", async () => {
    ketUpload = [{}];
    await assert.rejects(() => chay(), /không trả về đường dẫn/);
    assert.ok(!daLam.some((v) => v.k === "sendVideo"));
  });

  it("gửi đúng MỘT lần", async () => {
    await chay();
    assert.equal(daLam.filter((v) => v.k === "sendVideo").length, 1);
  });
});

describe("khung hình đọc từ CHÍNH buffer sắp gửi", () => {
  it("lấy số trong file, KHÔNG lấy số nguồn khai", async () => {
    // Nguồn khai 576x1024 (dọc), file thật 1002x576 (ngang). Khai theo nguồn là
    // đúng ca đã làm ứng dụng Zalo trên điện thoại crash.
    await chay();
    assert.deepEqual({ w: tinGui().w, h: tinGui().h }, { w: 1002, h: 576 });
  });

  it("video DỌC thì ra dọc - không phải cứ ngang là đúng", async () => {
    byteTai = dungMp4(720, 1280);
    await chay();
    assert.deepEqual({ w: tinGui().w, h: tinGui().h }, { w: 720, h: 1280 });
  });

  it("không đọc được thì lùi về số của nguồn chứ không bỏ cuộc", async () => {
    byteTai = Buffer.from("khong phai mp4 gi ca");
    await chay();
    assert.deepEqual({ w: tinGui().w, h: tinGui().h }, { w: VIDEO.width, h: VIDEO.height });
  });
});

describe("ảnh bìa", () => {
  it("ưu tiên ảnh của Zalo", async () => {
    await chay();
    assert.equal(tinGui().thumb, ANH_BIA_ZALO);
  });

  it("xin ảnh bìa bằng URL GỐC của người dùng, không phải URL CDN", async () => {
    // `parseLink` là API dựng thẻ xem trước cho link người dùng dán; đưa nó một
    // URL CDN thì không có gì để đọc.
    await chay();
    const a = daLam.find((v) => v.k === "anhBia") as Extract<Viec, { k: "anhBia" }>;
    assert.equal(a.url, URL_GOC);
  });

  it("không xin được thì dùng ảnh bìa https của nguồn", async () => {
    anhBiaZalo = null;
    await chay();
    assert.equal(tinGui().thumb, VIDEO.thumbnailUrl);
  });

  it("ảnh bìa nguồn không phải https thì bỏ hẳn, vẫn gửi", async () => {
    // Chuỗi này đi tới máy của MỌI người nhận trong nhóm.
    anhBiaZalo = null;
    const d = dich();
    const v = { ...VIDEO, thumbnailUrl: "javascript:alert(1)" };
    await mod.guiVideoQuaZalo(d, v, URL_GOC, TRAN, phuThuoc());
    assert.equal(tinGui().thumb, "");
  });
});

describe("chọn nguồn byte theo kết quả dò", () => {
  it("dò QUA thì tải thẳng URL đã xác thực", async () => {
    await chay();
    const t = daLam.find((v) => v.k === "taiUrl") as Extract<Viec, { k: "taiUrl" }>;
    assert.equal(t.url, VIDEO.videoUrl);
    assert.ok(!daLam.some((v) => v.k === "taiYtDlp"));
  });

  it("dò TRƯỢT thì để yt-dlp tự tải, từ URL GỐC", async () => {
    // URL của yt-dlp gắn với phiên của nó - đo thật, trả 403 ngay trên chính
    // máy vừa chạy yt-dlp. Tự tải URL đó cũng trượt; để nó tự tải thì được.
    ketDo = { ok: false, ly: "HTTP 403" };
    const r = await chay();
    const t = daLam.find((v) => v.k === "taiYtDlp") as Extract<Viec, { k: "taiYtDlp" }>;
    assert.equal(t.url, URL_GOC);
    assert.equal(r.duong, "yt-dlp");
    assert.ok(!daLam.some((v) => v.k === "taiUrl"));
  });

  it("cả hai đường đều hỏng thì NÉM, không gửi gì", async () => {
    ketDo = { ok: false, ly: "HTTP 404" };
    loiTai = { loi: "video riêng tư" };
    await assert.rejects(() => chay(), /riêng tư/);
    assert.ok(!daLam.some((v) => v.k === "sendVideo"));
  });

  it("thiếu công cụ thì chở cờ loiCauHinh lên trên", async () => {
    ketDo = { ok: false, ly: "HTTP 404" };
    loiTai = { loi: "chưa cài yt-dlp", loiCauHinh: true };
    await assert.rejects(
      () => chay(),
      (e: unknown) => e instanceof mod.LoiGuiVideo && e.loiCauHinh,
    );
  });
});

describe("trần dung lượng", () => {
  it("bước dò báo quá nặng thì NÉM TRƯỚC KHI tải - không kéo byte nào về", async () => {
    ketDo = { ...ketDo, soByte: TRAN + 1 } as typeof ketDo;
    await assert.rejects(
      () => chay(),
      (e: unknown) => e instanceof mod.LoiGuiVideo && e.quaNang && e.soByte === TRAN + 1,
    );
    assert.ok(!daLam.some((v) => v.k === "taiUrl"), "biết thừa là quá nặng mà vẫn tải là phí băng thông");
  });

  it("nguồn giấu dung lượng: tải xong mới biết vượt thì vẫn chặn", async () => {
    // `--max-filesize` của yt-dlp và `content-length` đều có thể vắng mặt hoặc
    // nói dối. Phép kiểm trên buffer là lưới cuối.
    ketDo = { ...ketDo, soByte: null } as typeof ketDo;
    byteTai = Buffer.alloc(TRAN + 1);
    await assert.rejects(
      () => chay(),
      (e: unknown) => e instanceof mod.LoiGuiVideo && e.quaNang,
    );
    assert.ok(!daLam.some((v) => v.k === "sendVideo"));
  });

  it("CDN không khai dung lượng nhưng file vừa vặn thì vẫn gửi", async () => {
    ketDo = { ...ketDo, soByte: null } as typeof ketDo;
    await chay();
    assert.equal(daLam.filter((v) => v.k === "sendVideo").length, 1);
  });
});

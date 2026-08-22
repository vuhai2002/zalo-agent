import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";

import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { ThongTinVideo } from "./thong-tin-video.js";

/**
 * Đường gửi video. File này trước đây có **0 test**, và cả ba lỗi nghiêm trọng
 * của vòng rà soát đều nằm đúng trong nó:
 *
 *   1. `sendVideo` KHÔNG ném khi URL trả 403/404 (zca-js `sendVideo.ts:69-77`
 *      chỉ `if (headResponse.ok)`), nên nhánh `catch` không bao giờ chạy: bot
 *      gửi một thẻ video chết rồi báo thành công.
 *   2. `Promise.race` không hủy được việc đã xếp hàng - việc bị bỏ vẫn chặn
 *      hàng đợi của thread, và mở cửa GỬI TRÙNG.
 *   3. `mediaType` bị vứt, nên `200 + text/html` được ghi ra `.mp4` rồi gửi đi.
 *
 * Luật xuyên suốt mọi ca dưới đây: **đúng MỘT lần gửi** ở mọi nhánh. Gửi hai
 * lần là rủi ro khóa nick, thứ mà cả trần theo giờ sinh ra để chống.
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
  // PHẢI đóng DB trước khi xóa thư mục: module này kéo theo
  // `runtime-tuning-settings` -> `database.js`, mà file đó mở SQLite ở MODULE
  // SCOPE. Còn handle mở thì `rmSync` trên Windows trả EPERM và cả file test
  // đỏ dù mọi ca đều xanh.
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

const VIDEO: ThongTinVideo = {
  videoUrl: "https://cdn.test/cdn-cua-nguon.mp4",
  thumbnailUrl: "https://cdn.test/t.jpg",
  durationMs: 20_000,
  width: 576,
  height: 1024,
  fileSize: 1_000_000,
  tacGia: "nguoidung123",
  nguon: "tikwm",
  nenTang: "tiktok",
};
const URL_GOC = "https://www.tiktok.com/@nguoidung123/video/123";
const TRAN = 100 * 1024 * 1024;

/** Mọi việc ra ngoài, theo ĐÚNG THỨ TỰ */
type Viec =
  | { k: "do"; url: string }
  | { k: "sendVideo"; url: string }
  | { k: "sendFile"; duongDan: string }
  | { k: "taiUrl"; url: string }
  | { k: "taiYtDlp"; url: string };
let daLam: Viec[] = [];
let demCa = 0;

/** Kịch bản cho mỗi ca - đặt lại trong beforeEach */
let ketDo: import("./kiem-url-video-truoc-khi-gui.js").KetQuaDo;
let loiSendVideo: Error | null;

/** Zalo TRẢ LỜI và từ chối: zca-js gắn `code` dạng SỐ. Chắc chắn chưa tin nào lọt qua. */
const loiZaloTuChoi = (msg = "Zalo từ chối") => Object.assign(new Error(msg), { code: 118 });
/** zca-js ném TRƯỚC khi POST khi chính HEAD của nó hỏng - không có mã số. */
const loiTruocKhiPost = () => new Error("Unable to get video content: fetch failed");
/** Đứt mạng sau khi đã POST: KHÔNG RÕ tin đã tới chưa. */
const loiKhongRo = () => new Error("socket hang up");
let kieuTaiVe: string;
let loiTaiUrl: Error | null;
let ketYtDlp: { ok: true; duongDan: string; soByte: number } | { ok: false; loi: string };

beforeEach(() => {
  daLam = [];
  ketDo = { ok: true, soByte: 5_000_000, kieuNoiDung: "video/mp4", urlCuoi: VIDEO.videoUrl, doiTenMien: false };
  loiSendVideo = null;
  kieuTaiVe = "video/mp4";
  loiTaiUrl = null;
  ketYtDlp = { ok: true, duongDan: "", soByte: 4_242 };
});

function dich() {
  return {
    api: {
      sendVideo: async (o: { videoUrl: string }) => {
        daLam.push({ k: "sendVideo", url: o.videoUrl });
        if (loiSendVideo) throw loiSendVideo;
        return {};
      },
      sendMessage: async (c: { attachments?: string[] }) => {
        daLam.push({ k: "sendFile", duongDan: c.attachments?.[0] ?? "" });
        return {};
      },
    } as never,
    // Khoá hàng đợi RIÊNG cho mỗi ca: `enqueueSend` nối tuần tự theo khoá và
    // giữ trạng thái ở cấp module, nên dùng chung một khoá là các ca xếp hàng
    // sau nhau và một ca hỏng kéo theo ca sau.
    threadKey: `acc-vid:${++demCa}`,
    threadId: "t1",
    threadType: 0 as never,
  };
}

function phuThuoc(): import("./gui-video-qua-zalo.js").PhuThuocGuiVideo {
  return {
    kiemUrl: async (u: string) => {
      daLam.push({ k: "do", url: u });
      return ketDo as never;
    },
    taiUrl: async (u: string, duongDan: string) => {
      daLam.push({ k: "taiUrl", url: u });
      if (loiTaiUrl) throw loiTaiUrl;
      fs.writeFileSync(duongDan, "noi dung gia");
      return { bytes: 1234, mediaType: kieuTaiVe };
    },
    taiYtDlp: async (u: string, thuMuc: string) => {
      daLam.push({ k: "taiYtDlp", url: u });
      if (!ketYtDlp.ok) return ketYtDlp;
      const p = `${thuMuc}/v.mp4`;
      fs.writeFileSync(p, "video gia");
      return { ok: true as const, duongDan: p, soByte: ketYtDlp.soByte };
    },
  };
}

const chay = () => mod.guiVideoQuaZalo(dich(), VIDEO, URL_GOC, TRAN, phuThuoc());
const soLanGui = () => daLam.filter((v) => v.k === "sendVideo" || v.k === "sendFile").length;

describe("dò TRƯỚC khi gửi", () => {
  it("dò xong mới gửi - đúng thứ tự đó", async () => {
    const r = await chay();
    assert.deepEqual(
      daLam.map((v) => v.k),
      ["do", "sendVideo"],
      "gửi trước rồi mới biết URL sống hay chết là gửi mù",
    );
    assert.equal(r.duong, "url");
  });

  it("dò đúng URL CỦA NGUỒN, không phải URL người dùng dán", async () => {
    await chay();
    const d = daLam.find((v) => v.k === "do");
    assert.ok(d && d.k === "do");
    assert.equal(d.url, VIDEO.videoUrl);
  });

  it("URL trả 403 thì TUYỆT ĐỐI không gọi sendVideo", async () => {
    // Đây là ca đã trả giá: `sendVideo` không ném với 403, nó vẫn gửi tin chứa
    // URL chết rồi bot báo thành công.
    ketDo = { ok: false, ly: "HTTP 403" } as never;
    await chay();

    assert.ok(
      !daLam.some((v) => v.k === "sendVideo"),
      "gọi sendVideo với URL 403 là gửi một thẻ video không mở được",
    );
    assert.ok(daLam.some((v) => v.k === "taiYtDlp"));
  });

  it("URL trả 200 nhưng text/html cũng KHÔNG được gửi", async () => {
    // Trang "link đã hết hạn" / trang chặn bot. Không ném, `bytes > 0`, nên mọi
    // lưới đỡ dựa vào ngoại lệ đều để lọt.
    ketDo = { ok: false, ly: "Kiểu nội dung không phải video: text/html" } as never;
    await chay();
    assert.ok(!daLam.some((v) => v.k === "sendVideo"));
  });

  it("URL trỏ địa chỉ nội bộ bị chặn ở bước dò, không gửi và không tự tải nó", async () => {
    // `videoUrl` là chuỗi của bên thứ ba. zca-js đi theo `location` ĐỆ QUY,
    // không đếm hop, không kiểm địa chỉ - nên nó không được nhận URL chưa gác.
    ketDo = { ok: false, ly: "Chặn địa chỉ nội bộ: 127.0.0.1" } as never;
    await chay();

    assert.ok(!daLam.some((v) => v.k === "sendVideo"));
    assert.ok(!daLam.some((v) => v.k === "taiUrl"), "cũng không được tự tải chính URL đó");
  });
});

describe("chỉ giao cho sendVideo thứ ĐÃ được kiểm", () => {
  /**
   * Bản trước dò trên `video.videoUrl` rồi VỨT kết quả đi, và đưa `sendVideo`
   * chính chuỗi gốc của bên thứ ba. zca-js đi theo `location` ĐỆ QUY, không đếm
   * hop, không kiểm địa chỉ - nên lớp gác kiểm một đằng, `sendVideo` lấy một
   * nẻo. Không cần đua: bộ dò dùng GET+Range còn zca-js dùng HEAD, máy chủ chỉ
   * cần trả lời khác theo method là xong.
   */
  it("sendVideo nhận URL CUỐI mà bộ dò xác thực, không phải chuỗi gốc", async () => {
    ketDo = {
      ok: true,
      soByte: 100,
      kieuNoiDung: "video/mp4",
      urlCuoi: "https://cdn.test/DA-XAC-THUC.mp4",
      doiTenMien: false,
    };
    await chay();
    const g = daLam.find((v) => v.k === "sendVideo");
    assert.ok(g && g.k === "sendVideo");
    assert.equal(g.url, "https://cdn.test/DA-XAC-THUC.mp4");
  });

  it("chuyển hướng ĐỔI TÊN MIỀN thì KHÔNG giao cho sendVideo, tự tải luôn", async () => {
    // Chuyển hướng nghĩa là bên kia quyết đích đến theo từng request, và
    // `sendVideo` sẽ tự đi lại chặng đó mà không qua lớp gác nào.
    ketDo = {
      ok: true,
      soByte: 100,
      kieuNoiDung: "video/mp4",
      urlCuoi: "https://cdn.test/sau-chuyen-huong.mp4",
      doiTenMien: true,
    };
    const r = await chay();

    assert.ok(!daLam.some((v) => v.k === "sendVideo"), "URL chuyển hướng không được giao cho zca-js");
    assert.equal(r.duong, "tai-ve");
    const t = daLam.find((v) => v.k === "taiUrl");
    assert.ok(t && t.k === "taiUrl");
    assert.equal(t.url, "https://cdn.test/sau-chuyen-huong.mp4", "tải đúng URL đã xác thực");
  });

  it("đường tự tải cũng dùng URL đã xác thực, không dùng chuỗi gốc", async () => {
    ketDo = {
      ok: true,
      soByte: 100,
      kieuNoiDung: "video/mp4",
      urlCuoi: "https://cdn.test/DA-XAC-THUC.mp4",
      doiTenMien: false,
    };
    loiSendVideo = loiZaloTuChoi();
    await chay();
    const t = daLam.find((v) => v.k === "taiUrl");
    assert.ok(t && t.k === "taiUrl");
    assert.equal(t.url, "https://cdn.test/DA-XAC-THUC.mp4");
  });
});

describe("đường dự phòng chọn đúng loại", () => {
  it("dò TRƯỢT thì để yt-dlp tự tải từ URL GỐC", async () => {
    // URL của yt-dlp gắn với phiên của nó: đo thật trả 403 ngay trên chính máy
    // vừa chạy yt-dlp. Nên tự tải URL đó cũng trượt; chỉ yt-dlp tải được.
    ketDo = { ok: false, ly: "HTTP 403" } as never;
    const r = await chay();

    const t = daLam.find((v) => v.k === "taiYtDlp");
    assert.ok(t && t.k === "taiYtDlp");
    assert.equal(t.url, URL_GOC, "giao URL CDN cho yt-dlp thì nó không phân tích được");
    assert.equal(r.duong, "yt-dlp");
    assert.equal(r.bytes, 4_242);
  });

  it("dò QUA nhưng sendVideo ném thì tự tải CHÍNH URL đó (đã biết là sống)", async () => {
    loiSendVideo = loiZaloTuChoi();
    const r = await chay();

    const t = daLam.find((v) => v.k === "taiUrl");
    assert.ok(t && t.k === "taiUrl");
    assert.equal(t.url, VIDEO.videoUrl);
    assert.equal(r.duong, "tai-ve");
    assert.ok(!daLam.some((v) => v.k === "taiYtDlp"), "URL còn sống thì không cần tới yt-dlp");
  });

  it("dò TRƯỢT và yt-dlp cũng hỏng thì NÉM - không im lặng báo thành công", async () => {
    ketDo = { ok: false, ly: "HTTP 404" } as never;
    ketYtDlp = { ok: false, loi: "video riêng tư" };
    await assert.rejects(() => chay(), /riêng tư/);
    assert.equal(soLanGui(), 0);
  });
});

describe("đúng MỘT lần gửi ở mọi nhánh", () => {
  it("đường 1", async () => {
    await chay();
    assert.equal(soLanGui(), 1);
  });

  it("đường 2 (sendVideo ném rồi tự tải)", async () => {
    loiSendVideo = loiZaloTuChoi();
    await chay();
    assert.equal(soLanGui(), 2, "một lần sendVideo hỏng + một lần gửi file");
    assert.equal(daLam.filter((v) => v.k === "sendFile").length, 1, "chỉ MỘT tin thật tới người nhận");
  });

  it("đường 3 (yt-dlp tự tải)", async () => {
    ketDo = { ok: false, ly: "HTTP 403" } as never;
    await chay();
    assert.equal(soLanGui(), 1);
  });
});

describe("chỉ lùi sang đường 2 khi CHẮC CHẮN chưa gửi", () => {
  /**
   * `sendVideo` ném ở hai thời điểm rất khác nhau: TRƯỚC khi POST (HEAD của nó
   * hỏng) và SAU khi đã POST (giải mã thân trả lời hỏng, đứt mạng). Ở ca thứ
   * hai tin CÓ THỂ đã tới người nhận, nên lùi sang đường 2 là gửi lần thứ hai.
   *
   * Hai video liên tiếp trong một thread đúng là tín hiệu spam mà cả trần
   * 15 video/giờ sinh ra để tránh.
   */
  it("Zalo TRẢ LỜI và từ chối (lỗi có mã số) thì LÙI - chắc chắn chưa gửi", async () => {
    loiSendVideo = loiZaloTuChoi();
    const r = await chay();
    assert.equal(r.duong, "tai-ve");
    assert.equal(daLam.filter((v) => v.k === "sendFile").length, 1);
  });

  it("zca-js ném TRƯỚC khi POST thì cũng LÙI", async () => {
    // "Unable to get video content" là câu zca-js ném khi chính HEAD của nó
    // hỏng - trước khi gửi gì cả. Không có mã số nên luật mã-số không thấy.
    loiSendVideo = loiTruocKhiPost();
    const r = await chay();
    assert.equal(r.duong, "tai-ve");
  });

  it("lỗi KHÔNG RÕ KẾT CỤC thì NÉM, tuyệt đối không gửi lần hai", async () => {
    loiSendVideo = loiKhongRo();
    await assert.rejects(() => chay(), /socket hang up/);

    assert.equal(
      daLam.filter((v) => v.k === "sendFile").length,
      0,
      "tin có thể đã tới rồi - gửi thêm là người dùng nhận hai video",
    );
    assert.ok(!daLam.some((v) => v.k === "taiUrl"), "cũng không được tải về");
  });

  it("lỗi không rõ: vẫn đúng MỘT lần chạm đường gửi", async () => {
    loiSendVideo = loiKhongRo();
    await assert.rejects(() => chay());
    assert.equal(soLanGui(), 1);
  });
});

describe("nội dung tải về vẫn bị kiểm lại", () => {
  it("tải về ra text/html thì NÉM chứ không gửi", async () => {
    // Dò và tải là HAI request khác nhau - CDN đổi ý giữa chừng là có thật.
    loiSendVideo = loiZaloTuChoi();
    kieuTaiVe = "text/html";
    await assert.rejects(() => chay(), /không phải video/);
    assert.equal(daLam.filter((v) => v.k === "sendFile").length, 0);
  });

  it("application/octet-stream vẫn nhận - đó là 'không biết', không phải 'biết là HTML'", async () => {
    loiSendVideo = loiZaloTuChoi();
    kieuTaiVe = "application/octet-stream";
    const r = await chay();
    assert.equal(r.duong, "tai-ve");
  });
});

describe("trần dung lượng đọc từ chính CDN sắp phục vụ file", () => {
  it("content-length vượt trần thì NÉM trước khi gửi", async () => {
    ketDo = { ok: true, soByte: TRAN + 1, kieuNoiDung: "video/mp4", urlCuoi: VIDEO.videoUrl, doiTenMien: false };
    await assert.rejects(() => chay(), /vượt giới hạn/);
    assert.equal(soLanGui(), 0);
  });

  it("CDN không khai content-length thì vẫn gửi, không chặn oan", async () => {
    ketDo = { ok: true, soByte: null, kieuNoiDung: "video/mp4", urlCuoi: VIDEO.videoUrl, doiTenMien: false };
    const r = await chay();
    assert.equal(r.duong, "url");
    assert.equal(r.bytes, null);
  });
});

describe("ảnh bìa đẩy tới máy người nhận", () => {
  // `thumbnailUrl` là chuỗi của bên thứ ba, không qua bước dò (ta không tải nó),
  // nhưng nó tới máy của MỌI người nhận trong nhóm.
  async function anhBiaDaGui(thumb: string): Promise<string> {
    let gui = "";
    const d = dich();
    d.api = {
      sendVideo: async (o: { thumbnailUrl: string }) => {
        gui = o.thumbnailUrl;
        return {};
      },
      sendMessage: async () => ({}),
    } as never;
    await mod.guiVideoQuaZalo(d, { ...VIDEO, thumbnailUrl: thumb }, URL_GOC, TRAN, phuThuoc());
    return gui;
  }

  it("https hợp lệ thì giữ nguyên", async () => {
    assert.equal(await anhBiaDaGui("https://cdn.test/t.jpg"), "https://cdn.test/t.jpg");
  });

  it("http trần bị bỏ", async () => {
    assert.equal(await anhBiaDaGui("http://cdn.test/t.jpg"), "");
  });

  it("scheme lạ và chuỗi rác bị bỏ", async () => {
    for (const x of ["javascript:alert(1)", "data:text/html,<script>", "khong-phai-url", "file:///etc/passwd"]) {
      assert.equal(await anhBiaDaGui(x), "", `phải bỏ: ${x}`);
    }
  });

  it("chuỗi rỗng vẫn gửi được - Facebook vốn không trả ảnh bìa nào", async () => {
    assert.equal(await anhBiaDaGui(""), "");
  });
});

describe("dọn file tạm", () => {
  it("đường 2 xóa file kể cả khi gửi NÉM", async () => {
    loiSendVideo = loiZaloTuChoi();
    let duongDan = "";
    const pt = phuThuoc();
    const taiGoc = pt.taiUrl;
    pt.taiUrl = async (u, p, o) => {
      duongDan = p;
      return taiGoc(u, p, o);
    };
    const d = dich();
    d.api = {
      sendVideo: async () => {
        throw loiSendVideo;
      },
      sendMessage: async () => {
        throw new Error("upload hỏng");
      },
    } as never;

    await assert.rejects(() => mod.guiVideoQuaZalo(d, VIDEO, URL_GOC, TRAN, pt), /upload hỏng/);
    assert.notEqual(duongDan, "");
    assert.equal(fs.existsSync(duongDan), false, "gửi hỏng mà giữ file lại là đầy đĩa VPS dần");
  });

  it("đường 3 xóa cả thư mục kể cả khi gửi NÉM", async () => {
    ketDo = { ok: false, ly: "HTTP 403" } as never;
    let thuMuc = "";
    const pt = phuThuoc();
    const goc = pt.taiYtDlp;
    pt.taiYtDlp = async (u, tm, tb) => {
      thuMuc = tm;
      return goc(u, tm, tb);
    };
    const d = dich();
    d.api = { sendVideo: async () => ({}), sendMessage: async () => { throw new Error("upload hỏng"); } } as never;

    await assert.rejects(() => mod.guiVideoQuaZalo(d, VIDEO, URL_GOC, TRAN, pt), /upload hỏng/);
    assert.notEqual(thuMuc, "");
    assert.equal(fs.existsSync(thuMuc), false, "yt-dlp để lại cả tệp phụ - phải xóa cả cụm");
  });
});

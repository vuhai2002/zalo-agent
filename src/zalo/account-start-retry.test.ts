import assert from "node:assert/strict";
import net from "node:net";
import { describe, it } from "node:test";
import { ZaloApiError } from "zca-js";
import { doiChoDenKhi } from "../shared/doi-cho-den-khi.js";
import { choTruocLanThu, HenKhoiDongLai, laLoiMangTamThoi } from "./account-start-retry.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Lỗi fetch THẬT của undici (cổng đóng) - đúng hình dạng zca-js ném lúc mất mạng.
 * KHÔNG dùng cổng 1: nó nằm trong danh sách "bad port" của chuẩn fetch nên undici
 * từ chối trước cả khi nối (`cause: Error("bad port")`) - tức không đo lỗi MẠNG
 * nào cả. Mở một cổng tạm rồi đóng lại để chắc chắn nó trống.
 */
async function loiFetchThat(): Promise<unknown> {
  const server = net.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((r) => server.close(() => r()));
  try {
    await fetch(`http://127.0.0.1:${port}/`);
  } catch (err) {
    return err;
  }
  throw new Error(`cổng ${port} vừa đóng lại trả lời - ca này không đo được`);
}

describe("laLoiMangTamThoi", () => {
  it("lỗi fetch thật của undici (cổng đóng, ECONNREFUSED) -> thử lại", async () => {
    const err = (await loiFetchThat()) as { cause?: { code?: unknown } };
    assert.equal(err.cause?.code, "ECONNREFUSED", "ca này không đi qua lỗi kết nối thật");
    assert.equal(laLoiMangTamThoi(err), true);
  });

  it("đúng hình dạng log prod: fetch failed bọc getaddrinfo EAI_AGAIN -> thử lại", () => {
    const cause = Object.assign(new Error("getaddrinfo EAI_AGAIN wpa.chat.zalo.me"), { code: "EAI_AGAIN" });
    assert.equal(laLoiMangTamThoi(new TypeError("fetch failed", { cause })), true);
  });

  it("ZaloApiError (phiên chết/cookie hỏng) -> KHÔNG thử, kể cả khi cause mang mã mạng", () => {
    assert.equal(laLoiMangTamThoi(new ZaloApiError("Đăng nhập thất bại")), false);
    const boc = new ZaloApiError("Đăng nhập thất bại");
    (boc as { cause?: unknown }).cause = { code: "ECONNRESET" };
    assert.equal(laLoiMangTamThoi(boc), false);
  });

  it("thiếu credential / lỗi thường / giá trị lạ -> KHÔNG thử", () => {
    assert.equal(laLoiMangTamThoi(new Error('Chưa có credentials cho account "x"')), false);
    assert.equal(laLoiMangTamThoi(new TypeError("Cannot read properties of undefined")), false);
    assert.equal(laLoiMangTamThoi(undefined), false);
    assert.equal(laLoiMangTamThoi("fetch failed"), false);
  });
});

describe("choTruocLanThu", () => {
  it("giãn đôi từ 30s, kẹp trần 5 phút", () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4, 10].map((lan) => choTruocLanThu(lan)),
      [30_000, 60_000, 120_000, 240_000, 300_000, 300_000],
    );
  });
});

describe("HenKhoiDongLai", () => {
  const loiMang = () => new TypeError("fetch failed", { cause: { code: "EAI_AGAIN" } });

  it("lỗi mạng thì thử tiếp, tới khi thành công thì thôi", async () => {
    let soLan = 0;
    const hen = new HenKhoiDongLai({
      coSoMs: 1,
      tranMs: 5,
      nenThu: () => true,
      thuKhoiDong: async () => {
        soLan += 1;
        if (soLan < 3) throw loiMang();
      },
    });
    hen.henThu("a");
    await doiChoDenKhi(() => soLan === 3, { moTa: "thử đủ 3 lần (2 hỏng mạng + 1 thành công)" });
    // Phủ định: thành công rồi thì không hẹn thêm. Neo vào trạng thái sổ hẹn
    // (henThu gọi ĐỒNG BỘ trong catch) rồi chừa thời gian gấp nhiều lần trần chờ.
    await sleep(30);
    assert.equal(soLan, 3);
    assert.equal(hen.dangHen("a"), false);
  });

  it("lỗi KHÔNG phải mạng thì dừng ngay sau lần thử đó", async () => {
    let soLan = 0;
    const hen = new HenKhoiDongLai({
      coSoMs: 1,
      tranMs: 1,
      nenThu: () => true,
      thuKhoiDong: async () => {
        soLan += 1;
        throw new ZaloApiError("Đăng nhập thất bại");
      },
    });
    hen.henThu("a");
    await doiChoDenKhi(() => soLan === 1, { moTa: "lần thử đầu chạy" });
    await sleep(30);
    assert.equal(soLan, 1, "vẫn thử tiếp dù phiên chết - chỉ thêm rủi ro bị Zalo gắn cờ");
    assert.equal(hen.dangHen("a"), false);
  });

  it("lúc timer nổ mà `nenThu` false (đã tắt/đã chạy) thì không gọi khởi động", async () => {
    let soLanHoi = 0;
    let soLanThu = 0;
    const hen = new HenKhoiDongLai({
      coSoMs: 1,
      nenThu: () => {
        soLanHoi += 1;
        return false;
      },
      thuKhoiDong: async () => {
        soLanThu += 1;
      },
    });
    hen.henThu("a");
    await doiChoDenKhi(() => soLanHoi === 1, { moTa: "timer nổ và hỏi nenThu" });
    assert.equal(soLanThu, 0);
  });

  it("`huy` / `huyHet` gỡ hẹn đang chờ - timer không bao giờ nổ", async () => {
    let soLanThu = 0;
    const hen = new HenKhoiDongLai({
      coSoMs: 10,
      nenThu: () => true,
      thuKhoiDong: async () => {
        soLanThu += 1;
      },
    });
    hen.henThu("a");
    hen.henThu("b");
    hen.huy("a");
    assert.equal(hen.dangHen("a"), false);
    assert.equal(hen.dangHen("b"), true);
    hen.huyHet();
    assert.equal(hen.dangHen("b"), false);
    await sleep(50);
    assert.equal(soLanThu, 0);
  });

  it("hẹn lại cùng account THAY hẹn cũ, không chồng hai timer", async () => {
    let soLanThu = 0;
    const hen = new HenKhoiDongLai({
      coSoMs: 5,
      nenThu: () => true,
      thuKhoiDong: async () => {
        soLanThu += 1;
      },
    });
    hen.henThu("a");
    hen.henThu("a");
    await doiChoDenKhi(() => soLanThu >= 1, { moTa: "hẹn còn lại nổ" });
    await sleep(40);
    assert.equal(soLanThu, 1);
  });
});

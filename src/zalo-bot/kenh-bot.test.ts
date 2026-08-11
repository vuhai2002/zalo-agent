import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { ZaloBotClient } from "./zalo-bot-api-client.js";

let dataDir: string;
let mod: typeof import("./kenh-bot.js");

before(async () => {
  dataDir = setupTestEnv();
  mod = await import("./kenh-bot.js");
});

after(async () => {
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

function clientGia() {
  const guiTin: { chatId: string; text: string; parseMode: unknown }[] = [];
  let soChatAction = 0;
  const client = {
    sendMessage: async (chatId: string, text: string, parseMode?: unknown) => {
      guiTin.push({ chatId, text, parseMode });
      return { message_id: "m1", date: 1 };
    },
    sendChatAction: async () => {
      soChatAction++;
      return {};
    },
  } as unknown as ZaloBotClient;
  return { client, guiTin, soChatAction: () => soChatAction };
}

const cho = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("kenhBot", () => {
  it("KHÔNG xin server dựng markdown - chữ tới đây đã hết markdown rồi", async () => {
    // `deliverChatReply` chạy `dinhDangNeuBat` trước, và `markdownSangStyleZalo`
    // BÓC dấu ra thành `Style[]` (đo: "**Bảng giá**" -> "Bảng giá" + 1 style).
    // Xin server dựng markdown ở đây chỉ có thể BỚT ký tự (`_` trong tên file,
    // `[` trong nhãn nguồn), không thêm được gì.
    const { client, guiTin } = clientGia();
    await mod.kenhBot(client).duongGui("c1", 0)({ text: "file bao_gia_2026.pdf" });
    assert.equal(guiTin[0]?.parseMode, null, "vẫn xin server dựng markdown");
    assert.equal(guiTin[0]?.text, "file bao_gia_2026.pdf", "chữ bị đổi trên đường gửi");
  });

  it("VỨT styles và quote - Bot API không hiểu hai trường đó", async () => {
    const { client, guiTin } = clientGia();
    await mod.kenhBot(client).duongGui("c1", 0)({
      text: "chào",
      styles: [{ start: 0, len: 4, st: "b" }] as never,
      quote: { msg: "trích" } as never,
    });
    assert.equal(guiTin.length, 1);
    assert.equal(guiTin[0]?.text, "chào");
  });

  it("khai trần 2000 ký tự của Bot API, không dùng chung trần zca-js", () => {
    // `ZALO_MAX_MESSAGE_CHARS` chỉnh được tới 4000 trên dashboard. Dùng chung
    // thì ai nới cho kênh cá nhân là kênh bot mất trọn câu trả lời (server chối
    // nguyên tin, đo thật: 2001 ký tự bị từ chối).
    assert.equal(mod.kenhBot(clientGia().client).tranKyTuMotTin, 2000);
  });

  it("KHÔNG có biên nhận và thả cảm xúc - để trống chứ không dựng stub ném lỗi", () => {
    const kenh = mod.kenhBot(clientGia().client);
    assert.equal(kenh.baoDaXem, undefined);
    assert.equal(kenh.tuThaCamXuc, undefined);
    assert.equal(kenh.api, null);
  });

  it("dấu 'đang nhập': bắn NGAY rồi lặp, và dung() thật sự dừng", async () => {
    const { client, soChatAction } = clientGia();
    const dung = mod.kenhBot(client).batDangNhap!("c1", 0);
    assert.equal(soChatAction(), 1, "không bắn ngay - người ta chờ cả nhịp đầu mới thấy dấu");
    await cho(30);
    dung();
    const sauKhiDung = soChatAction();
    await cho(60);
    assert.equal(soChatAction(), sauKhiDung, "vẫn bắn sau khi đã dừng - rò rỉ timer");
  });

  it("sendChatAction NÉM ĐỒNG BỘ cũng không làm vỡ vòng", async () => {
    // `.catch` chỉ đỡ được promise. Ném trước khi kịp trả promise thì lỗi thoát
    // khỏi callback của setInterval và thành uncaught.
    const client = {
      sendChatAction: () => {
        throw new Error("hỏng ngay");
      },
    } as unknown as ZaloBotClient;
    const dung = mod.kenhBot(client).batDangNhap!("c1", 0);
    await cho(20);
    dung();
    // Tới được đây là không có gì thoát ra
    assert.ok(true);
  });
});

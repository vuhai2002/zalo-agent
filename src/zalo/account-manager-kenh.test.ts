import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { AccountConfig } from "../config/account-store.js";
import type { ZaloBotClient } from "../zalo-bot/zalo-bot-api-client.js";

/**
 * Sổ `running` phải mô tả được CẢ HAI kênh, không riêng zca-js.
 *
 * Vì sao cần file này: trước đây `RunningAccount` giữ thẳng `api: API | null`,
 * nên caller chỉ cầm `accountId` (đường gửi chủ động của scheduler) không có
 * cách nào gửi cho tài khoản bot - dù `kenhBot.duongGui` vẫn chạy tốt mỗi ngày
 * ở luồng tin nhắn. Đó là lý do KỸ THUẬT duy nhất khiến lịch hẹn bị chặn trên
 * kênh bot, không phải giới hạn của Bot API (đo thật: 10 tin trong 416ms).
 *
 * Mỗi ca ở đây khoá một mắt xích của đường đó: kênh cá nhân vào sổ, kênh bot
 * vào sổ, `api` chỉ lấy được QUA KÊNH (lối tắt cũ đã xóa), dừng thì sạch, và
 * account bị tắt giữa lúc khởi động không để lại kênh mồ côi.
 */
let dataDir: string;
let manager: typeof import("./account-manager.js");
let accounts: typeof import("../config/account-store.js");
let runner: typeof import("../zalo-bot/bot-account-runner.js");
let database: typeof import("../conversation/database.js");

const CA_NHAN = "acc-kenh-ca-nhan";
const BOT = "acc-kenh-bot";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

before(async () => {
  dataDir = setupTestEnv();
  manager = await import("./account-manager.js");
  accounts = await import("../config/account-store.js");
  runner = await import("../zalo-bot/bot-account-runner.js");
  database = await import("../conversation/database.js");
});

after(() => {
  manager.stopAllAccounts();
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  manager.stopAllAccounts();
  database.db.exec("DELETE FROM accounts");
});

/** api zca-js GIẢ - `sendMessage` là hàm duy nhất chạm "mạng", listener no-op */
function apiGia(): { api: API; daGui: { threadId: string; msg: string }[] } {
  const daGui: { threadId: string; msg: string }[] = [];
  const api = {
    getOwnId: () => "self-1",
    listener: {
      on: () => {},
      onConnected: () => {},
      onError: () => {},
      onClosed: () => {},
      start: () => {},
      stop: () => {},
    },
    sendMessage: async (payload: { msg: string }, threadId: string) => {
      daGui.push({ threadId, msg: payload.msg });
      return {};
    },
  } as unknown as API;
  return { api, daGui };
}

type ClientBotGia = {
  client: ZaloBotClient;
  daGui: { chatId: string; text: string; parseMode: unknown }[];
  soLanPoll: () => number;
  /** Nhả lời gọi `getUpdates` đang treo, trả về `null` (poll rỗng) */
  nhaPoll: () => void;
  truocKhiKiemToken?: () => void;
};

/**
 * Client Bot API GIẢ.
 *
 * `getUpdates` TREO cho tới khi test gọi `nhaPoll()`. Bắt buộc phải treo:
 * vòng poll thật không có sàn nhịp (poll rỗng thì `continue` ngay), nên một
 * fake trả `null` tức thì sẽ quay CPU hết công suất suốt cả file test.
 */
function clientBotGia(truocKhiKiemToken?: () => void): ClientBotGia {
  const daGui: { chatId: string; text: string; parseMode: unknown }[] = [];
  let soLanPoll = 0;
  let nhaPollHienTai: (() => void) | undefined;

  const client = {
    getMe: async () => {
      truocKhiKiemToken?.();
      return { id: "bot-1", display_name: "Bot thử" };
    },
    getWebhookInfo: async () => ({}),
    deleteWebhook: async () => ({}),
    getUpdates: () => {
      soLanPoll += 1;
      return new Promise<null>((resolve) => {
        nhaPollHienTai = () => resolve(null);
      });
    },
    sendMessage: async (chatId: string, text: string, parseMode: unknown) => {
      daGui.push({ chatId, text, parseMode });
      return {};
    },
    sendPhoto: async () => ({}),
    sendChatAction: async () => ({}),
  } as unknown as ZaloBotClient;

  return { client, daGui, soLanPoll: () => soLanPoll, nhaPoll: () => nhaPollHienTai?.() };
}

/** Dựng account bot trong DB rồi khởi động qua ĐÚNG `startAccount` thật */
async function chayAccountBot(gia: ClientBotGia): Promise<() => void> {
  accounts.createAccount({ id: BOT, label: "Bot" });
  accounts.datLoaiKenh(BOT, "bot");
  accounts.datBotToken(BOT, "123:abcdefghijklmnop");
  const khoiPhuc = runner.tiemClientRunnerChoTest(() => gia.client);
  try {
    await manager.startAccount(BOT);
  } finally {
    khoiPhuc();
  }
  return khoiPhuc;
}

describe("sổ account đang chạy giữ KÊNH, không giữ riêng api zca-js", () => {
  it("kênh CÁ NHÂN vào sổ: `kenh.api` là api đã gắn, `duongGui` gọi đúng `api.sendMessage`", async () => {
    const { api, daGui } = apiGia();
    accounts.createAccount({ id: CA_NHAN, label: "Cá nhân" });
    manager.attachAccount(accounts.getAccount(CA_NHAN) as AccountConfig, api);

    const kenh = manager.getRunningAccountKenh(CA_NHAN);
    assert.ok(kenh, "account cá nhân đang chạy mà không lấy được kênh");
    assert.equal(kenh.api, api, "`kenh.api` phải LÀ api đã gắn, không phải bản sao khác");

    await kenh.duongGui("t1", 0)({ text: "xin chào" });
    assert.deepEqual(daGui, [{ threadId: "t1", msg: "xin chào" }]);
  });

  it("kênh BOT vào sổ: `api` null, trần 2000 ký tự, `duongGui` gọi `client.sendMessage`", async () => {
    const gia = clientBotGia();
    await chayAccountBot(gia);

    const kenh = manager.getRunningAccountKenh(BOT);
    assert.ok(kenh, "tài khoản bot đang chạy mà KHÔNG lấy được kênh - đúng lỗi đã chặn lịch hẹn");
    assert.equal(kenh.api, null, "kênh bot không có api zca-js");
    assert.equal(
      kenh.tranKyTuMotTin,
      2000,
      "trần ký tự của NỀN TẢNG phải đi theo kênh - thiếu là bộ cắt dùng trần chung rồi bị server chối nguyên tin",
    );

    await kenh.duongGui("chat-1", 0)({ text: "nhắc uống nước" });
    assert.deepEqual(gia.daGui, [{ chatId: "chat-1", text: "nhắc uống nước", parseMode: null }]);
  });

  it("`api` zca-js chỉ lấy được qua kênh - không còn lối tắt theo accountId", async () => {
    // `getRunningAccountApi` đã bị XÓA: mọi caller của nó đều đi tiếp một bước
    // giống hệt nhau (tự dựng `duongGuiZcaJs`), tức nó là cái bẫy có hình dạng
    // tiện lợi. Ca này khoá lại chuyện đó - còn export nào tên như vậy nghĩa
    // là lối tắt đã quay lại.
    assert.equal(
      (manager as Record<string, unknown>).getRunningAccountApi,
      undefined,
      "lối tắt `getRunningAccountApi` quay lại - dùng nó là khóa cứng caller vào kênh cá nhân",
    );

    const { api } = apiGia();
    accounts.createAccount({ id: CA_NHAN, label: "Cá nhân" });
    manager.attachAccount(accounts.getAccount(CA_NHAN) as AccountConfig, api);
    assert.equal(manager.getRunningAccountKenh(CA_NHAN)?.api, api);

    await chayAccountBot(clientBotGia());
    assert.equal(manager.getRunningAccountKenh(BOT)?.api, null);
  });

  it("`stopAccount` dọn luôn kênh - không để lại đường gửi cho account đã dừng", async () => {
    const { api } = apiGia();
    accounts.createAccount({ id: CA_NHAN, label: "Cá nhân" });
    manager.attachAccount(accounts.getAccount(CA_NHAN) as AccountConfig, api);
    assert.ok(manager.getRunningAccountKenh(CA_NHAN));

    manager.stopAccount(CA_NHAN);
    assert.equal(
      manager.getRunningAccountKenh(CA_NHAN),
      undefined,
      "còn kênh sau khi dừng nghĩa là scheduler vẫn gửi được cho account đã tắt",
    );
  });

  it("account bot bị TẮT giữa lúc khởi động: không vào sổ VÀ vòng poll đã dừng", async () => {
    // `chayTaiKhoanBot` mất hai vòng mạng (hạn 15 giây mỗi cái), đủ rộng để
    // người vận hành bấm TẮT trong lúc chờ. Lúc đó `stopAccount` của route là
    // no-op (chưa có gì trong `running`), nên nếu `startBotAccount` cứ cài vào
    // sổ thì công tắc an toàn hỏng CÂM.
    const gia = clientBotGia(() => {
      accounts.updateAccount(BOT, { enabled: false });
    });
    await chayAccountBot(gia);

    assert.equal(manager.getRunningAccountKenh(BOT), undefined, "account đã tắt mà vẫn có kênh trong sổ");
    assert.equal(manager.isAccountRunning(BOT), false);

    // Vòng poll phải DỪNG THẬT, không chỉ vắng mặt trong sổ: nó là một vòng
    // `while` sống độc lập, còn quay nghĩa là còn đọc tin của account đã tắt
    // (và `getUpdates` không có `offset` nên tin đó mất luôn).
    //
    // Khẳng định PHỦ ĐỊNH ("không có lần poll thứ hai") nên GIỮ `sleep`, không
    // dùng `doiChoDenKhi`: chờ-đến-khi ở đây đúng ngay lần thử đầu nên không
    // chứng minh gì. Neo vào một mốc xác định: nhả lời gọi đang treo, rồi cho
    // vòng lặp thừa thãi cơ hội quay tiếp.
    assert.equal(gia.soLanPoll(), 1, "chưa poll lần nào thì ca này đo rỗng");
    gia.nhaPoll();
    await sleep(50);
    assert.equal(gia.soLanPoll(), 1, "vòng poll vẫn quay sau khi account bị tắt - `dung()` không được gọi");
  });
});

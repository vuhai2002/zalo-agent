import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

/**
 * Đường lui cho caption gửi kèm file/ảnh.
 *
 * Khác lượt chat ở mức thiệt hại: tới đây thì file .docx/.xlsx đã dựng xong,
 * hoặc ảnh đã vẽ mất 60-135 giây. Để cả thứ đó rơi vì một dòng caption có định
 * dạng lạ là đắt nhất trong các cách hỏng.
 *
 * `tinKemFile` đọc cấu hình qua `getTuning` (chạm SQLite) nên phải
 * `setupTestEnv()` trước rồi mới import động.
 */

let dataDir: string;
let sender: typeof import("./send-attachment-with-caption.js");

before(async () => {
  dataDir = setupTestEnv();
  sender = await import("./send-attachment-with-caption.js");
});

after(async () => {
  (await import("../../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

type LanGui = { msg: string; styles?: unknown[]; attachments?: string[] };
let daGui: LanGui[] = [];
beforeEach(() => {
  daGui = [];
});

/** Lỗi máy chủ Zalo trả về - dấu hiệu là có `code` dạng số */
function loiMayChu(code: number): Error {
  return Object.assign(new Error("Lỗi không xác định"), { code });
}

function taoApi(tuChoi: (lan: number, co: LanGui) => void): API {
  return {
    sendMessage: async (payload: LanGui) => {
      daGui.push(payload);
      tuChoi(daGui.length, payload);
      return { msgId: `m-${daGui.length}` };
    },
  } as unknown as API;
}

const gui = (api: API, caption: string | undefined) =>
  sender.guiFileKemCaption(api, "acc:thread", "thread", 0 as never, "C:/tmp/bao-gia.docx", caption);

describe("guiFileKemCaption", () => {
  it("Zalo từ chối caption có định dạng: gửi lại chữ trơn, FILE VẪN ĐI KÈM", async () => {
    const api = taoApi((lan, co) => {
      if (lan === 1 && co.styles) throw loiMayChu(112);
    });

    await gui(api, "Báo giá **tháng 8** đây ạ");

    assert.equal(daGui.length, 2);
    assert.ok(daGui[0]!.styles, "lần đầu phải có định dạng");
    assert.equal(daGui[1]!.styles, undefined, "lần sau phải bỏ hẳn định dạng");
    assert.deepEqual(
      daGui[1]!.attachments,
      ["C:/tmp/bao-gia.docx"],
      "mất file đính kèm là hỏng nặng hơn cả lỗi ban đầu",
    );
    assert.equal(daGui[1]!.msg, "Báo giá tháng 8 đây ạ", "chữ caption phải y nguyên");
  });

  it("lỗi đứt mạng thì KHÔNG gửi lại - file có thể đã tới, gửi lại là hai file", async () => {
    const api = taoApi((lan) => {
      if (lan === 1) throw new Error("socket hang up");
    });

    await assert.rejects(() => gui(api, "Báo giá **tháng 8**"));
    assert.equal(daGui.length, 1);
  });

  it("caption trơn (không style) thì không gửi lại - lần hai y hệt lần đầu", async () => {
    const api = taoApi(() => {
      throw loiMayChu(112);
    });

    await assert.rejects(() => gui(api, "File anh cần đây ạ"));
    assert.equal(daGui.length, 1);
  });

  it("không có caption vẫn gửi được file", async () => {
    const api = taoApi(() => {});
    await gui(api, undefined);

    assert.equal(daGui.length, 1);
    assert.equal(daGui[0]!.msg, "");
    assert.deepEqual(daGui[0]!.attachments, ["C:/tmp/bao-gia.docx"]);
  });
});

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { ThreadType, type API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Khử trùng câu báo lỗi.
 *
 * Provider chết vài phút mà người ta nhắn 5 lần là 5 tin y hệt nhau đổ xuống -
 * vừa phiền vừa làm họ tưởng bot hỏng nặng hơn thực tế. Một lần đã nói đủ ý
 * "chờ rồi nhắn lại".
 *
 * Nhưng khử theo CẢ loại lỗi, không chỉ theo thread: "bot chưa cấu hình xong"
 * và "mạng chập" là hai chuyện khác nhau, mỗi chuyện đáng được nói một lần.
 */

let dataDir: string;
let sender: typeof import("./send-reply-in-parts.js");

before(async () => {
  dataDir = setupTestEnv();
  sender = await import("./send-reply-in-parts.js");
});

after(async () => {
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

let daGui: string[] = [];
beforeEach(() => {
  daGui = [];
  sender.resetKhuTrungBaoLoi();
});

const api = {
  sendMessage: async (payload: { msg: string }) => {
    daGui.push(payload.msg);
    return { msgId: `m-${daGui.length}` };
  },
} as unknown as API;

const muc = (threadKey: string) => ({
  api,
  threadKey,
  threadId: threadKey,
  threadType: ThreadType.User,
});

describe("notifyTechnicalError - khử trùng", () => {
  it("báo lần đầu", async () => {
    await sender.notifyTechnicalError(muc("k-lan-dau"), "transient");
    assert.equal(daGui.length, 1);
  });

  it("cùng thread + cùng loại lỗi thì chỉ báo MỘT lần", async () => {
    // Đúng ca đã xảy ra 2026-08-04: hai lượt liên tiếp cùng chết vì 524, người
    // nhắn nhận hai tin "trục trặc kỹ thuật" giống hệt nhau.
    for (let i = 0; i < 4; i++) {
      await sender.notifyTechnicalError(muc("k-trung"), "transient");
    }
    assert.equal(daGui.length, 1, `mong đúng 1 câu, nhận ${daGui.length}`);
  });

  it("LOẠI LỖI KHÁC vẫn được báo - hai chuyện khác nhau, không được nuốt", async () => {
    // Bất biến đối trọng: khử trùng chỉ theo thread sẽ giấu mất đúng thông tin
    // người ta cần. "Chờ rồi nhắn lại" và "bot chưa cài xong" dẫn tới hai hành
    // động hoàn toàn khác nhau.
    await sender.notifyTechnicalError(muc("k-khac-loai"), "transient");
    await sender.notifyTechnicalError(muc("k-khac-loai"), "cau_hinh");

    assert.equal(daGui.length, 2, "mỗi loại lỗi phải được nói một lần");
    assert.notEqual(daGui[0], daGui[1], "và phải là hai câu khác nhau");
  });

  it("THREAD KHÁC vẫn được báo - người này im không có nghĩa người kia cũng im", async () => {
    await sender.notifyTechnicalError(muc("k-thread-a"), "transient");
    await sender.notifyTechnicalError(muc("k-thread-b"), "transient");
    assert.equal(daGui.length, 2);
  });

  it("gửi hỏng vẫn nuốt lỗi - đây đã là đường cứu cánh, hỏng nốt thì chỉ còn log", async () => {
    const apiHong = {
      sendMessage: async () => {
        throw new Error("Zalo từ chối");
      },
    } as unknown as API;

    await sender.notifyTechnicalError(
      { api: apiHong, threadKey: "k-gui-hong", threadId: "k-gui-hong", threadType: ThreadType.User },
      "transient",
    );
    // Không ném ra ngoài là đủ - `xuLyLuot` gọi hàm này ở cuối nhánh catch,
    // ném thêm ở đây là lỗi thứ hai đè lên lỗi đang xử lý.
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

// media-store đọc dataDir từ env lúc import nên phải setupTestEnv trước, import động sau
let dataDir: string;
let store: typeof import("./media-store.js");
let database: typeof import("./database.js");
type PersistableMessage = import("./media-store.js").PersistableMessage;

// 1x1 PNG hợp lệ - đủ cho test lưu/đọc, không cần ảnh thật
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// Downloader giả: tiêm vào persistBatchImages nên test không chạm mạng thật
const downloadOk = (mediaType = "image/png") => async () => ({ data: PNG_BYTES, mediaType });
const downloadFail = async () => null;

before(async () => {
  dataDir = setupTestEnv({ MEDIA_RETENTION_DAYS: "7" });
  store = await import("./media-store.js");
  // media-store giờ kéo theo image-description-store (DB) - phải đóng DB trước
  // khi xóa thư mục tạm, Windows khóa file đang mở nên rmSync sẽ EPERM
  database = await import("./database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("media-store", () => {
  it("persist ảnh: lưu file đúng chỗ, gắn localPath, load lại được base64", async () => {
    const msg: PersistableMessage = { threadId: "t-1", msgId: "m-100", images: [{ url: "https://z.vn/a.png" }] };

    await store.persistBatchImages("acc-1", [msg], downloadOk());

    assert.equal(msg.images[0]!.localPath, "media/acc-1/t-1/m-100-0.png");
    assert.ok(fs.existsSync(path.join(dataDir, "media/acc-1/t-1/m-100-0.png")));

    const loaded = store.loadStoredImage(msg.images[0]!.localPath!);
    assert.ok(loaded);
    assert.equal(loaded.mediaType, "image/png");
    assert.equal(loaded.base64, PNG_BYTES.toString("base64"));
  });

  it("tải lỗi thì không gắn localPath và không throw", async () => {
    const msg: PersistableMessage = {
      threadId: "t-1",
      msgId: "m-404",
      images: [{ url: "https://z.vn/die.png" }],
    };

    await store.persistBatchImages("acc-1", [msg], downloadFail);

    assert.equal(msg.images[0]!.localPath, undefined);
    assert.deepEqual(store.imagePathsOf(msg.images), []);
  });

  it("id chứa ký tự lạ bị sanitize khỏi đường dẫn", async () => {
    const msg: PersistableMessage = {
      threadId: "../thoat",
      msgId: "a/b:c",
      images: [{ url: "https://z.vn/x.jpg" }],
    };

    await store.persistBatchImages("acc-1", [msg], downloadOk("image/jpeg"));

    assert.equal(msg.images[0]!.localPath, "media/acc-1/___thoat/a_b_c-0.jpg");
  });

  it("loadStoredImage chặn đường dẫn thoát khỏi data/media", () => {
    assert.equal(store.loadStoredImage("../zalo-agent.db"), null);
    assert.equal(store.loadStoredImage("media/../zalo-agent.db"), null);
  });

  it("file không tồn tại (đã bị dọn) trả null thay vì throw", () => {
    assert.equal(store.loadStoredImage("media/acc-1/t-1/khong-co-0.jpg"), null);
  });

  it("cleanup xóa file quá hạn, giữ file mới, gỡ thư mục rỗng", async () => {
    const oldMsg: PersistableMessage = {
      threadId: "t-old",
      msgId: "m-old",
      images: [{ url: "https://z.vn/o.png" }],
    };
    const newMsg: PersistableMessage = {
      threadId: "t-new",
      msgId: "m-new",
      images: [{ url: "https://z.vn/n.png" }],
    };
    await store.persistBatchImages("acc-2", [oldMsg, newMsg], downloadOk());

    // Giả lập file cũ 8 ngày (quá MEDIA_RETENTION_DAYS=7)
    const oldAbs = path.join(dataDir, oldMsg.images[0]!.localPath!);
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldAbs, eightDaysAgo, eightDaysAgo);

    const removed = store.cleanupExpiredMedia();

    assert.ok(removed >= 1);
    assert.ok(!fs.existsSync(oldAbs));
    assert.ok(!fs.existsSync(path.dirname(oldAbs)), "thư mục rỗng phải bị gỡ");
    assert.ok(fs.existsSync(path.join(dataDir, newMsg.images[0]!.localPath!)));
  });
});

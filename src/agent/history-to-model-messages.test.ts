import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Module thuần (chỉ import type) - không chạm env/DB nên import tĩnh được
import { collectImagesWithinBudget, historyToModelMessages } from "./history-to-model-messages.js";
import type { StoredMessage } from "../conversation/history-store.js";

/** Loader giả: trả base64 đánh dấu theo path để assert đúng ảnh nào được nạp */
const fakeLoader = (relPath: string) => ({ base64: `b64:${relPath}`, mediaType: "image/jpeg" });

function userMsg(content: string, images?: string[]): StoredMessage {
  return { role: "user", content, senderName: "Hải", images };
}

/** Content dạng mảng thì lọc ra danh sách base64 của các image part */
function imagePartsOf(message: { content: unknown }): string[] {
  if (!Array.isArray(message.content)) return [];
  return message.content
    .filter((p: { type: string }) => p.type === "file")
    .map((p: { data: string }) => p.data);
}

describe("history-to-model-messages", () => {
  it("tin user thường: text kèm timestamp + tên; assistant giữ nguyên", () => {
    const history: StoredMessage[] = [
      { role: "user", content: "chào", senderName: "Hải", createdAt: "2026-07-25T14:30:00.000Z" },
      { role: "assistant", content: "chào bạn" },
    ];
    const out = historyToModelMessages(history, 3, fakeLoader);

    assert.equal(out.length, 2);
    assert.match(String(out[0]!.content), /^\[\d{2}\/\d{2} \d{2}:\d{2}\] Hải: chào$/);
    assert.deepEqual(out[1], { role: "assistant", content: "chào bạn" });
  });

  it("ngân sách ảnh ưu tiên tin mới nhất, tin cũ hơn rơi về text", () => {
    const history = [
      userMsg("ảnh 1 [gửi kèm 1 ảnh]", ["media/a/t/1-0.jpg"]),
      userMsg("ảnh 2 [gửi kèm 1 ảnh]", ["media/a/t/2-0.jpg"]),
      userMsg("ảnh 3 [gửi kèm 1 ảnh]", ["media/a/t/3-0.jpg"]),
    ];
    const out = historyToModelMessages(history, 2, fakeLoader);

    assert.equal(typeof out[0]!.content, "string", "tin cũ nhất hết ngân sách -> text");
    assert.deepEqual(imagePartsOf(out[1]!), ["b64:media/a/t/2-0.jpg"]);
    assert.deepEqual(imagePartsOf(out[2]!), ["b64:media/a/t/3-0.jpg"]);
  });

  it("tin nhiều ảnh chỉ lấy đủ phần ngân sách còn lại", () => {
    const history = [
      userMsg("chùm ảnh", ["media/a/t/1-0.jpg", "media/a/t/1-1.jpg", "media/a/t/1-2.jpg"]),
    ];
    const out = historyToModelMessages(history, 2, fakeLoader);

    assert.deepEqual(imagePartsOf(out[0]!), ["b64:media/a/t/1-0.jpg", "b64:media/a/t/1-1.jpg"]);
  });

  it("limit 0 tắt hẳn: mọi tin đều là text", () => {
    const out = historyToModelMessages([userMsg("có ảnh", ["media/a/t/1-0.jpg"])], 0, fakeLoader);
    assert.equal(typeof out[0]!.content, "string");
  });

  it("file đã bị dọn (loader trả null) thì rơi về text thuần", () => {
    const out = historyToModelMessages(
      [userMsg("ảnh mất [gửi kèm 1 ảnh]", ["media/a/t/xoa-roi-0.jpg"])],
      3,
      () => null,
    );
    assert.equal(typeof out[0]!.content, "string");
    assert.match(String(out[0]!.content), /gửi kèm 1 ảnh/);
  });

  it("text trong tin kèm ảnh vẫn giữ timestamp + tên người gửi", () => {
    const history: StoredMessage[] = [
      {
        role: "user",
        content: "xem ảnh này [gửi kèm 1 ảnh]",
        senderName: "Hải",
        images: ["media/a/t/9-0.jpg"],
        createdAt: "2026-07-25T14:30:00.000Z",
      },
    ];
    const out = historyToModelMessages(history, 3, fakeLoader);
    const content = out[0]!.content as { type: string; text?: string }[];
    const textPart = content.find((p) => p.type === "text");
    assert.match(textPart!.text!, /Hải: xem ảnh này \[gửi kèm 1 ảnh\]$/);
  });

  it("chế độ describe (keepPixels=false): thay pixel bằng text mô tả, KHÔNG gọi loader ảnh", () => {
    let loaderCalls = 0;
    const out = historyToModelMessages(
      [userMsg("vé số [gửi kèm 1 ảnh]", ["media/a/t/ve-0.jpg"])],
      3,
      () => {
        loaderCalls++;
        return fakeLoader("x");
      },
      { describe: (relPath) => `vé số Đà Lạt, số 123456 (${relPath})`, keepPixels: false },
    );

    const content = out[0]!.content as { type: string; text?: string }[];
    assert.equal(loaderCalls, 0, "describe mode không được nạp pixel");
    assert.equal(content.filter((p) => p.type === "file").length, 0);
    assert.match(content[0]!.text!, /^\[Mô tả ảnh đính kèm: vé số Đà Lạt, số 123456/);
  });

  it("chế độ describe: ảnh chưa có mô tả rơi về text thuần sẵn có", () => {
    const out = historyToModelMessages(
      [userMsg("cũ [gửi kèm 1 ảnh]", ["media/a/t/cu-0.jpg"])],
      3,
      fakeLoader,
      { describe: () => null, keepPixels: false },
    );
    assert.equal(typeof out[0]!.content, "string");
    assert.match(String(out[0]!.content), /gửi kèm 1 ảnh/);
  });

  it("chế độ hybrid (keepPixels=true): CẢ pixel LẪN mô tả cùng vào content", () => {
    const out = historyToModelMessages(
      [userMsg("vé [gửi kèm 1 ảnh]", ["media/a/t/hy-0.jpg"])],
      3,
      fakeLoader,
      { describe: () => "vé số Đà Lạt 654321", keepPixels: true },
    );

    const content = out[0]!.content as { type: string; text?: string; data?: string }[];
    assert.deepEqual(imagePartsOf(out[0]!), ["b64:media/a/t/hy-0.jpg"], "pixel phải còn");
    assert.ok(
      content.some((p) => p.type === "text" && /Mô tả ảnh đính kèm: vé số Đà Lạt 654321/.test(p.text!)),
      "mô tả phải kèm theo",
    );
  });

  it("chế độ hybrid: chưa có mô tả thì vẫn còn pixel (thành viên vision không bị thiệt)", () => {
    const out = historyToModelMessages(
      [userMsg("vé [gửi kèm 1 ảnh]", ["media/a/t/hy-1.jpg"])],
      3,
      fakeLoader,
      { describe: () => null, keepPixels: true },
    );
    assert.deepEqual(imagePartsOf(out[0]!), ["b64:media/a/t/hy-1.jpg"]);
  });

  it("collectImagesWithinBudget trả đúng các ảnh sẽ vào context theo ngân sách", () => {
    const history = [
      userMsg("1", ["media/a/t/1-0.jpg"]),
      userMsg("2", ["media/a/t/2-0.jpg", "media/a/t/2-1.jpg"]),
      userMsg("3", ["media/a/t/3-0.jpg"]),
    ];
    const paths = collectImagesWithinBudget(history, 2);
    // Ưu tiên tin mới: ảnh của tin 3 + 1 ảnh đầu của tin 2
    assert.deepEqual(paths.sort(), ["media/a/t/2-0.jpg", "media/a/t/3-0.jpg"]);
    assert.deepEqual(collectImagesWithinBudget(history, 0), []);
  });
});

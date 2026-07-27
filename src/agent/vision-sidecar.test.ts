import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let sidecar: typeof import("./vision-sidecar.js");
let visionStore: typeof import("../config/runtime-vision-settings.js");
let descriptionStore: typeof import("../conversation/image-description-store.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  sidecar = await import("./vision-sidecar.js");
  visionStore = await import("../config/runtime-vision-settings.js");
  descriptionStore = await import("../conversation/image-description-store.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

const IMG = { base64: "abc", mediaType: "image/jpeg" };

function configureSidecar(): void {
  visionStore.updateVisionSettings({
    sidecarBaseUrl: "https://gemini.test/v1beta/openai",
    sidecarModel: "gemini-3.5-flash-lite",
    sidecarApiKey: "AIza-test",
  });
}

function unconfigureSidecar(): void {
  visionStore.updateVisionSettings({ sidecarBaseUrl: "", sidecarModel: "", sidecarApiKey: "" });
}

describe("vision-sidecar", () => {
  it("chưa cấu hình sidecar: trả null, KHÔNG gọi model", async () => {
    unconfigureSidecar();
    let calls = 0;
    const result = await sidecar.describeImage({ ...IMG, cacheKey: "media/a/t/x-0.jpg" }, async () => {
      calls++;
      return { text: "mô tả", truncated: false };
    });
    assert.equal(result, null);
    assert.equal(calls, 0);
  });

  it("mô tả thành công thì lưu cache; lần 2 đọc cache không gọi lại", async () => {
    configureSidecar();
    let calls = 0;
    const call = async () => {
      calls++;
      return { text: "vé số Đà Lạt 123456", truncated: false };
    };

    const first = await sidecar.describeImage({ ...IMG, cacheKey: "media/a/t/ve-0.jpg" }, call);
    assert.equal(first, "vé số Đà Lạt 123456");
    assert.equal(descriptionStore.getImageDescription("media/a/t/ve-0.jpg"), "vé số Đà Lạt 123456");

    const second = await sidecar.describeImage({ ...IMG, cacheKey: "media/a/t/ve-0.jpg" }, call);
    assert.equal(second, "vé số Đà Lạt 123456");
    assert.equal(calls, 1, "lần 2 phải trúng cache");
  });

  it("không có cacheKey (ảnh chưa persist) vẫn mô tả được, không ghi cache", async () => {
    configureSidecar();
    const result = await sidecar.describeImage(IMG, async () => ({ text: "ảnh chụp hóa đơn", truncated: false }));
    assert.equal(result, "ảnh chụp hóa đơn");
  });

  it("sidecar ném lỗi (hết quota, chết mạng): trả null, không throw", async () => {
    configureSidecar();
    const result = await sidecar.describeImage({ ...IMG, cacheKey: "media/a/t/err-0.jpg" }, async () => {
      throw new Error("429 quota exceeded");
    });
    assert.equal(result, null);
    assert.equal(descriptionStore.getImageDescription("media/a/t/err-0.jpg"), null);
  });

  it("ensureDescriptionsFor: bỏ qua ảnh đã có mô tả + ảnh mất file, mô tả phần còn lại", async () => {
    configureSidecar();
    descriptionStore.saveImageDescription("media/a/t/cached.jpg", "đã có sẵn", "test");
    const described: string[] = [];

    await sidecar.ensureDescriptionsFor(
      ["media/a/t/cached.jpg", "media/a/t/moi.jpg", "media/a/t/mat-file.jpg"],
      (relPath) => (relPath === "media/a/t/mat-file.jpg" ? null : IMG),
      async () => {
        described.push("call");
        return { text: "mô tả mới", truncated: false };
      },
    );

    assert.equal(described.length, 1, "chỉ ảnh chưa có mô tả + còn file mới được gọi");
    assert.equal(descriptionStore.getImageDescription("media/a/t/moi.jpg"), "mô tả mới");
    assert.equal(descriptionStore.getImageDescription("media/a/t/cached.jpg"), "đã có sẵn");
  });

  it("testSidecar: chưa cấu hình thì ném lỗi có hướng dẫn", async () => {
    unconfigureSidecar();
    await assert.rejects(() => sidecar.testSidecar(async () => ({ text: "ok", truncated: false })), /base URL \+ model \+ API key/);
  });

  it("askAboutImage: prompt chứa nguyên câu hỏi, KHÔNG cache (mỗi câu mỗi khác)", async () => {
    configureSidecar();
    const prompts: string[] = [];
    const call = async (_s: unknown, _i: unknown, prompt: string) => {
      prompts.push(prompt);
      return { text: "2 con cá vàng", truncated: false };
    };

    const first = await sidecar.askAboutImage(IMG, "Đếm số cá màu vàng", call);
    const second = await sidecar.askAboutImage(IMG, "Đếm số cá màu vàng", call);
    assert.equal(first, "2 con cá vàng");
    assert.equal(second, "2 con cá vàng");
    assert.equal(prompts.length, 2, "câu hỏi tùy biến không được cache");
    assert.match(prompts[0]!, /Đếm số cá màu vàng/);
    assert.match(prompts[0]!, /không suy diễn/);
  });

  it("askAboutImage: chưa cấu hình sidecar thì ném lỗi (tool tự diễn giải cho model)", async () => {
    unconfigureSidecar();
    await assert.rejects(
      () => sidecar.askAboutImage(IMG, "đếm cá", async () => ({ text: "x", truncated: false })),
      /base URL \+ model \+ API key/,
    );
  });

  it("describeImage truyền đúng prompt mô tả cố định (chép nguyên văn chữ + số)", async () => {
    configureSidecar();
    let receivedPrompt = "";
    await sidecar.describeImage({ ...IMG, cacheKey: "media/a/t/prompt-check.jpg" }, async (_s, _i, prompt) => {
      receivedPrompt = prompt;
      return { text: "mô tả", truncated: false };
    });
    assert.match(receivedPrompt, /NGUYÊN VĂN/);
  });

  it("mô tả BỊ CẮT: vẫn dùng cho lượt này nhưng TUYỆT ĐỐI không cache", async () => {
    configureSidecar();
    let calls = 0;
    const call = async () => {
      calls++;
      return { text: "vé số Đà Lạt 1234", truncated: true };
    };

    const first = await sidecar.describeImage({ ...IMG, cacheKey: "media/a/t/cut-0.jpg" }, call);
    assert.equal(first, "vé số Đà Lạt 1234", "mô tả cụt vẫn dùng được - có còn hơn không");
    assert.equal(
      descriptionStore.getImageDescription("media/a/t/cut-0.jpg"),
      null,
      "bản cụt mà cache thì nó sống vĩnh viễn, mọi lượt sau đọc phải nó",
    );

    // Lần sau gọi lại vì không có cache -> có cơ hội lấy được bản đầy đủ
    await sidecar.describeImage({ ...IMG, cacheKey: "media/a/t/cut-0.jpg" }, call);
    assert.equal(calls, 2, "không cache thì lượt sau phải gọi lại");
  });

  it("askAboutImage bị cắt: nói thật cho model biết phần sau còn thiếu", async () => {
    configureSidecar();
    const answer = await sidecar.askAboutImage(IMG, "liệt kê hết", async () => ({
      text: "Có 3 mục: A, B",
      truncated: true,
    }));
    assert.match(answer, /Có 3 mục: A, B/);
    assert.match(answer, /bị cắt vì quá dài/, "model phải biết dữ liệu chưa đủ để đừng kết luận chắc nịch");
  });

  it("pruneExpiredImageDescriptions xóa mô tả cũ, GIỮ mô tả mới", () => {
    // Lùi ngày bằng SQL thay vì dựa vào thời gian trôi: bản cũ gọi retention 0
    // rồi kỳ vọng "vài ms đã qua là đủ cũ", nhưng phép so là `created_at <
    // cutoff` CHẶT và cả hai mốc đều chính xác tới mili-giây - ghi với dọn rơi
    // vào cùng một mili-giây là row sống sót. Test đổ ~1/10 lần chạy vì thế.
    // Đây thuần túy là lỗi của test: chạy thật retention là 7 ngày.
    descriptionStore.saveImageDescription("media/a/t/cu.jpg", "mô tả cũ", "test");
    descriptionStore.saveImageDescription("media/a/t/moi.jpg", "mô tả mới", "test");

    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    database.db
      .prepare("UPDATE image_descriptions SET created_at = ? WHERE rel_path = ?")
      .run(tenDaysAgo, "media/a/t/cu.jpg");

    const removed = descriptionStore.pruneExpiredImageDescriptions(7);

    assert.equal(removed, 1, "chỉ được xóa đúng row quá hạn");
    assert.equal(descriptionStore.getImageDescription("media/a/t/cu.jpg"), null, "mô tả 10 ngày tuổi phải bị dọn");
    assert.equal(
      descriptionStore.getImageDescription("media/a/t/moi.jpg"),
      "mô tả mới",
      "mô tả còn hạn phải được GIỮ - vế này bản cũ hứa trong tên nhưng không hề kiểm",
    );
  });
});

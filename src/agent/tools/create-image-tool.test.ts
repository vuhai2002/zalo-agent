import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";
import type { ParsedMessage } from "../../zalo/zalo-message-parser.js";

let dataDir: string;
let toolModule: typeof import("./create-image-tool.js");
let rateLimit: typeof import("../../images/image-rate-limit.js");
let settings: typeof import("../../config/runtime-image-settings.js");
let database: typeof import("../../conversation/database.js");
type ToolContext = import("./tool-registry.js").ToolContext;

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAABAAAAAQCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

/** Mọi việc bot làm ra ngoài, ghi theo ĐÚNG THỨ TỰ để khẳng định trình tự */
type Event =
  | { kind: "text"; msg: string }
  | { kind: "file"; fileName: string; buffer: Buffer; caption: string }
  | { kind: "generate"; prompt: string; hasRef: boolean; transparent: boolean };
let events: Event[] = [];
let generateError: Error | null = null;

before(async () => {
  dataDir = setupTestEnv({ IMAGE_GEN_MAX_PER_HOUR: "2" });
  toolModule = await import("./create-image-tool.js");
  rateLimit = await import("../../images/image-rate-limit.js");
  settings = await import("../../config/runtime-image-settings.js");
  database = await import("../../conversation/database.js");
  settings.updateImageSettings({
    baseUrl: "https://router.test",
    model: "cx/gpt-5.5-image",
    apiKey: "sk-test",
  });
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  events = [];
  generateError = null;
  rateLimit.resetImageRateLimit();
});

/** Thay chỗ gọi provider thật - không chạm mạng, không tốn tiền */
const fakeGenerate: typeof import("../../images/image-generation-client.js").generateImage = async (params) => {
  events.push({
    kind: "generate",
    prompt: params.prompt,
    hasRef: Boolean(params.refImage),
    transparent: Boolean(params.transparentBackground),
  });
  if (generateError) throw generateError;
  return { data: JPEG_BYTES, ext: "jpg" };
};

function writeMediaFile(relPath: string): string {
  const abs = path.join(dataDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, PNG_BYTES);
  return relPath;
}

function batchMsg(images: { url: string; localPath?: string }[]): ParsedMessage {
  return {
    accountId: "acc-img",
    threadId: "t-img",
    threadType: 0,
    isGroup: false,
    senderId: "u1",
    senderName: "Hải",
    text: "vẽ giúp",
    images,
    msgId: "m1",
    cliMsgId: "c1",
    isSelf: false,
    mentionsMe: false,
    rawData: {},
  };
}

function makeCtx(batch: ParsedMessage[] = [batchMsg([])]): ToolContext {
  return {
    api: {
      sendMessage: async (content: { msg: string; attachments?: string[] }) => {
        const attachment = content.attachments?.[0];
        if (attachment) {
          events.push({
            kind: "file",
            fileName: path.basename(attachment),
            buffer: fs.readFileSync(attachment),
            caption: content.msg,
          });
        } else {
          events.push({ kind: "text", msg: content.msg });
        }
        return {};
      },
    } as never,
    account: { id: "acc-img", disabledTools: [] } as never,
    message: batch[batch.length - 1]!,
    batch,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const run = (ctx: ToolContext, input: unknown): Promise<string> =>
  (toolModule.createImageTool(ctx, fakeGenerate) as any).execute(input, {});

describe("create_image - vẽ mới", () => {
  it("báo trước RỒI mới vẽ RỒI mới gửi ảnh - đúng thứ tự đó", async () => {
    await run(makeCtx(), { prompt: "một con mèo đội mũ" });

    assert.deepEqual(
      events.map((e) => e.kind),
      ["text", "generate", "file"],
      "vẽ mất ~70 giây, báo sau khi vẽ xong thì báo để làm gì",
    );
  });

  it("câu báo trước nói rõ là đang vẽ và sẽ mất thời gian", async () => {
    await run(makeCtx(), { prompt: "con mèo" });
    const notice = events.find((e) => e.kind === "text");
    assert.ok(notice && notice.kind === "text");
    assert.match(notice.msg, /vẽ|tạo ảnh/i);
  });

  it("gửi ảnh với đuôi .jpg đúng như provider trả về, kèm caption", async () => {
    await run(makeCtx(), { prompt: "con mèo", caption: "Ảnh đây ạ" });

    const file = events.find((e) => e.kind === "file");
    assert.ok(file && file.kind === "file");
    assert.match(file.fileName, /\.jpg$/, "sai đuôi thì Zalo gửi thành file chứ không thành ẢNH");
    assert.equal(file.caption, "Ảnh đây ạ");
    assert.deepEqual(file.buffer, JPEG_BYTES);
  });

  it("DẶN model đừng gửi lại - không dặn thì người dùng nhận ảnh 2 lần", async () => {
    const result = await run(makeCtx(), { prompt: "con mèo" });
    assert.match(result, /KHÔNG gọi send_file/);
  });

  it("nền trong suốt truyền xuống client", async () => {
    await run(makeCtx(), { prompt: "logo hình tròn", transparentBackground: true });
    const gen = events.find((e) => e.kind === "generate");
    assert.ok(gen && gen.kind === "generate" && gen.transparent);
  });
});

describe("create_image - sửa ảnh có sẵn", () => {
  it("imageIndex 1 lấy ảnh mới nhất của lượt làm ảnh gốc", async () => {
    const ctx = makeCtx([batchMsg([{ url: "u", localPath: writeMediaFile("media/acc-img/t-img/m1-0.png") }])]);
    await run(ctx, { prompt: "đổi mũ thành beret đỏ", imageIndex: 1 });

    const gen = events.find((e) => e.kind === "generate");
    assert.ok(gen && gen.kind === "generate" && gen.hasRef, "thiếu ảnh gốc là thành VẼ MỚI chứ không phải sửa");
  });

  it("không truyền imageIndex thì vẽ mới, không tự lôi ảnh cũ vào", async () => {
    const ctx = makeCtx([batchMsg([{ url: "u", localPath: writeMediaFile("media/acc-img/t-img/m2-0.png") }])]);
    await run(ctx, { prompt: "vẽ cảnh hoàng hôn" });

    const gen = events.find((e) => e.kind === "generate");
    assert.ok(gen && gen.kind === "generate" && !gen.hasRef);
  });

  it("model lỡ xin imageIndex mà hội thoại CHƯA TỪNG có ảnh -> vẫn vẽ mới, không từ chối", async () => {
    // Không ai bảo "sửa ảnh" khi chưa gửi ảnh bao giờ - đây chắc chắn là model
    // điền thừa tham số. Từ chối thì nó loay hoay sửa prompt rồi bỏ cuộc (đã
    // dính thật: 5 lần gọi, 68k token, người dùng không nhận được ảnh nào).
    const result = await run(makeCtx(), { prompt: "vẽ trang e-magazine dọc", imageIndex: 1 });

    const gen = events.find((e) => e.kind === "generate");
    assert.ok(gen && gen.kind === "generate", "phải vẽ chứ không được từ chối");
    assert.equal(gen.hasRef, false, "không có ảnh gốc nên phải vẽ mới");
    assert.equal(events.filter((e) => e.kind === "file").length, 1, "và phải gửi ảnh cho người dùng");
    assert.match(result, /KHÔNG gọi send_file/);
  });

  it("hội thoại CÓ ảnh nhưng imageIndex vượt quá -> báo cho model, KHÔNG đốt tiền gọi API", async () => {
    // Khác hẳn trường hợp trên: đã có ảnh nghĩa là người dùng thật sự nhắc tới
    // một tấm ảnh, vẽ mới là làm sai ý họ
    const ctx = makeCtx([batchMsg([{ url: "u", localPath: writeMediaFile("media/acc-img/t-img/m9-0.png") }])]);
    const result = await run(ctx, { prompt: "sửa ảnh thứ 5", imageIndex: 5 });

    assert.equal(events.filter((e) => e.kind === "generate").length, 0);
    assert.match(result, /chỉ còn 1 ảnh/i);
  });

  it("ảnh đã bị dọn khỏi đĩa -> báo rõ, không gọi API", async () => {
    const ctx = makeCtx([batchMsg([{ url: "u", localPath: "media/acc-img/t-img/da-bi-xoa.png" }])]);
    const result = await run(ctx, { prompt: "sửa", imageIndex: 1 });

    assert.equal(events.filter((e) => e.kind === "generate").length, 0);
    assert.match(result, /không đọc được|đã bị dọn/i);
  });
});

describe("create_image - schema đầu vào (đi qua inputSchema thật, không gọi thẳng execute)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const parse = (input: unknown) =>
    (toolModule.createImageTool(makeCtx(), fakeGenerate) as any).inputSchema.safeParse(input);

  it("bỏ trống imageIndex ra đúng undefined, KHÔNG phải NaN", () => {
    // NaN thì "imageIndex !== undefined" là true và tool đi nhầm nhánh sửa ảnh
    const parsed = parse({ prompt: "vẽ con mèo" });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.imageIndex, undefined);
    assert.equal(Number.isNaN(parsed.data.imageIndex), false);
  });

  it("prompt rỗng bị chặn ngay ở schema", () => {
    assert.equal(parse({ prompt: "" }).success, false);
  });

  it("imageIndex dạng chuỗi số vẫn nhận (model hay trả chuỗi)", () => {
    const parsed = parse({ prompt: "sửa", imageIndex: "2" });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.imageIndex, 2);
  });
});

describe("create_image - chặn và lỗi", () => {
  it("chạm trần thì KHÔNG gọi API và KHÔNG nhắn báo trước", async () => {
    await run(makeCtx(), { prompt: "1" });
    await run(makeCtx(), { prompt: "2" });
    events = [];

    const result = await run(makeCtx(), { prompt: "3" });
    assert.deepEqual(events, [], "chạm trần mà vẫn nhắn 'đang vẽ' là hứa lèo");
    assert.match(result, /trần 2/);
  });

  it("provider lỗi -> trả câu cho model đọc, KHÔNG throw ra agent loop", async () => {
    generateError = new Error("API key required for remote API access");
    const result = await run(makeCtx(), { prompt: "con mèo" });

    assert.match(result, /API key required/);
    assert.equal(events.filter((e) => e.kind === "file").length, 0, "lỗi thì không được gửi file rác");
  });

  it("provider lỗi vẫn tính vào trần - không cho spam retry đốt quota", async () => {
    generateError = new Error("quá tải");
    await run(makeCtx(), { prompt: "1" });
    await run(makeCtx(), { prompt: "2" });
    generateError = null;

    const result = await run(makeCtx(), { prompt: "3" });
    assert.match(result, /trần 2/);
  });

  it("chưa cấu hình đủ thì báo lỗi thay vì gọi API với key rỗng", async () => {
    settings.clearImageSettings();
    const result = await run(makeCtx(), { prompt: "con mèo" });
    settings.updateImageSettings({
      baseUrl: "https://router.test",
      model: "cx/gpt-5.5-image",
      apiKey: "sk-test",
    });

    assert.equal(events.filter((e) => e.kind === "generate").length, 0);
    assert.match(result, /chưa cấu hình/i);
  });
});

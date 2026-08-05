import assert from "node:assert/strict";
import { loiCuaTool } from "./tool-failure-result-test-helper.js";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fakeAgentProfile } from "../../shared/fake-agent-profile.js";
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
/** Kịch bản nhiều lần gọi liên tiếp, dùng cho ca thử lại. Rỗng = dùng `generateError` */
let generateErrorQueue: (Error | null)[] = [];

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
  generateErrorQueue = [];
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
  if (generateErrorQueue.length > 0) {
    const loi = generateErrorQueue.shift();
    if (loi) throw loi;
  } else if (generateError) throw generateError;
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
    agent: fakeAgentProfile(),
    message: batch[batch.length - 1]!,
    batch,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const run = (ctx: ToolContext, input: unknown): Promise<string> =>
  (toolModule.createImageTool(ctx, fakeGenerate) as any).execute(input, {});

describe("create_image - vẽ mới", () => {
  it("báo trước RỒI mới vẽ RỒI mới gửi ảnh - đúng thứ tự đó", async () => {
    await run(makeCtx(), { mode: "ve_moi", prompt: "một con mèo đội mũ" });

    assert.deepEqual(
      events.map((e) => e.kind),
      ["text", "generate", "file"],
      "vẽ mất ~70 giây, báo sau khi vẽ xong thì báo để làm gì",
    );
  });

  it("câu báo trước nói rõ là đang vẽ và sẽ mất thời gian", async () => {
    await run(makeCtx(), { mode: "ve_moi", prompt: "con mèo" });
    const notice = events.find((e) => e.kind === "text");
    assert.ok(notice && notice.kind === "text");
    assert.match(notice.msg, /vẽ|tạo ảnh/i);
  });

  it("gửi ảnh với đuôi .jpg đúng như provider trả về, kèm caption", async () => {
    await run(makeCtx(), { mode: "ve_moi", prompt: "con mèo", caption: "Ảnh đây ạ" });

    const file = events.find((e) => e.kind === "file");
    assert.ok(file && file.kind === "file");
    assert.match(file.fileName, /\.jpg$/, "sai đuôi thì Zalo gửi thành file chứ không thành ẢNH");
    assert.equal(file.caption, "Ảnh đây ạ");
    assert.deepEqual(file.buffer, JPEG_BYTES);
  });

  it("DẶN model đừng gửi lại - không dặn thì người dùng nhận ảnh 2 lần", async () => {
    const result = await run(makeCtx(), { mode: "ve_moi", prompt: "con mèo" });
    assert.match(result, /KHÔNG gọi send_file/);
  });

  it("nền trong suốt truyền xuống client", async () => {
    await run(makeCtx(), { mode: "ve_moi", prompt: "logo hình tròn", transparentBackground: true });
    const gen = events.find((e) => e.kind === "generate");
    assert.ok(gen && gen.kind === "generate" && gen.transparent);
  });
});

describe("create_image - sửa ảnh có sẵn", () => {
  const withImage = (name: string) =>
    makeCtx([batchMsg([{ url: "u", localPath: writeMediaFile(`media/acc-img/t-img/${name}.png`) }])]);

  it("mode sua_anh_da_gui lấy ảnh mới nhất làm ảnh gốc", async () => {
    await run(withImage("m1-0"), { mode: "sua_anh_da_gui", prompt: "đổi mũ thành beret đỏ" });

    const gen = events.find((e) => e.kind === "generate");
    assert.ok(gen && gen.kind === "generate" && gen.hasRef, "thiếu ảnh gốc là thành VẼ MỚI chứ không phải sửa");
  });

  it("mode ve_moi thì KHÔNG lôi ảnh cũ vào, dù hội thoại đang có ảnh", async () => {
    await run(withImage("m2-0"), { mode: "ve_moi", prompt: "vẽ cảnh hoàng hôn" });

    const gen = events.find((e) => e.kind === "generate");
    assert.ok(gen && gen.kind === "generate" && !gen.hasRef);
  });

  it("mode ve_moi kèm imageIndex thừa vẫn vẽ MỚI - đây là lá chắn chính", async () => {
    // Model có thói quen điền đủ mọi tham số (đã bắt được trên Zalo thật:
    // args {imageIndex: 1} cho một yêu cầu vẽ e-magazine mới). Nếu imageIndex
    // vẫn có quyền quyết định thì nó sẽ đi SỬA tấm ảnh cũ trong hội thoại và
    // người dùng nhận về ảnh lạ mà không có gì báo sai.
    await run(withImage("m3-0"), { mode: "ve_moi", prompt: "vẽ con mèo", imageIndex: 1 });

    const gen = events.find((e) => e.kind === "generate");
    assert.ok(gen && gen.kind === "generate", "phải vẽ");
    assert.equal(gen.hasRef, false, "mode quyết định, imageIndex thừa bị bỏ qua");
  });

  it("xin sửa ảnh mà hội thoại CHƯA TỪNG có ảnh -> vẫn vẽ mới, không từ chối", async () => {
    // Không ai bảo "sửa ảnh" khi chưa gửi ảnh bao giờ. Từ chối thì model loay
    // hoay sửa prompt rồi bỏ cuộc (đã dính thật: 5 lần gọi, 68k token, người
    // dùng không nhận được ảnh nào).
    const result = await run(makeCtx(), { mode: "sua_anh_da_gui", prompt: "vẽ trang e-magazine dọc" });

    const gen = events.find((e) => e.kind === "generate");
    assert.ok(gen && gen.kind === "generate", "phải vẽ chứ không được từ chối");
    assert.equal(gen.hasRef, false, "không có ảnh gốc nên phải vẽ mới");
    assert.equal(events.filter((e) => e.kind === "file").length, 1, "và phải gửi ảnh cho người dùng");
    assert.match(result, /KHÔNG gọi send_file/);
  });

  it("hội thoại CÓ ảnh nhưng imageIndex vượt quá -> báo cho model, KHÔNG đốt tiền gọi API", async () => {
    // Khác hẳn trường hợp trên: đã có ảnh nghĩa là người dùng thật sự nhắc tới
    // một tấm ảnh, vẽ mới là làm sai ý họ
    const result = await run(withImage("m9-0"), {
      mode: "sua_anh_da_gui",
      prompt: "sửa ảnh thứ 5",
      imageIndex: 5,
    });

    assert.equal(events.filter((e) => e.kind === "generate").length, 0);
    assert.match(loiCuaTool(result), /chỉ còn 1 ảnh/i);
  });

  it("ảnh đã bị dọn khỏi đĩa -> báo rõ, không gọi API", async () => {
    const ctx = makeCtx([batchMsg([{ url: "u", localPath: "media/acc-img/t-img/da-bi-xoa.png" }])]);
    const result = await run(ctx, { mode: "sua_anh_da_gui", prompt: "sửa" });

    assert.equal(events.filter((e) => e.kind === "generate").length, 0);
    assert.match(loiCuaTool(result), /không đọc được|đã bị dọn/i);
  });
});

describe("create_image - schema đầu vào (đi qua inputSchema thật, không gọi thẳng execute)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const parse = (input: unknown) =>
    (toolModule.createImageTool(makeCtx(), fakeGenerate) as any).inputSchema.safeParse(input);

  it("mode là BẮT BUỘC - thiếu thì schema chặn, model phải chọn có ý thức", () => {
    // Tham số tùy chọn thì model điền theo quán tính; bắt buộc thì nó phải nghĩ
    assert.equal(parse({ prompt: "vẽ con mèo" }).success, false);
  });

  it("mode lạ bị chặn, chỉ nhận đúng 2 giá trị", () => {
    assert.equal(parse({ mode: "edit", prompt: "x" }).success, false);
    assert.equal(parse({ mode: "ve_moi", prompt: "x" }).success, true);
    assert.equal(parse({ mode: "sua_anh_da_gui", prompt: "x" }).success, true);
  });

  it("bỏ trống imageIndex ra đúng undefined, KHÔNG phải NaN", () => {
    // NaN thì mọi phép so với undefined đều sai và tool đi nhầm nhánh
    const parsed = parse({ mode: "ve_moi", prompt: "vẽ con mèo" });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.imageIndex, undefined);
    assert.equal(Number.isNaN(parsed.data.imageIndex), false);
  });

  it("prompt rỗng bị chặn ngay ở schema", () => {
    assert.equal(parse({ mode: "ve_moi", prompt: "" }).success, false);
  });

  it("imageIndex dạng chuỗi số vẫn nhận (model hay trả chuỗi)", () => {
    const parsed = parse({ mode: "sua_anh_da_gui", prompt: "sửa", imageIndex: "2" });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.imageIndex, 2);
  });
});

describe("create_image - chặn và lỗi", () => {
  it("chạm trần thì KHÔNG gọi API và KHÔNG nhắn báo trước", async () => {
    await run(makeCtx(), { mode: "ve_moi", prompt: "1" });
    await run(makeCtx(), { mode: "ve_moi", prompt: "2" });
    events = [];

    const result = await run(makeCtx(), { mode: "ve_moi", prompt: "3" });
    assert.deepEqual(events, [], "chạm trần mà vẫn nhắn 'đang vẽ' là hứa lèo");
    assert.match(loiCuaTool(result), /trần 2/);
  });

  it("provider lỗi -> trả câu cho model đọc, KHÔNG throw ra agent loop", async () => {
    generateError = new Error("API key required for remote API access");
    const result = await run(makeCtx(), { mode: "ve_moi", prompt: "con mèo" });

    assert.match(loiCuaTool(result), /API key required/);
    assert.equal(events.filter((e) => e.kind === "file").length, 0, "lỗi thì không được gửi file rác");
  });

  it("provider lỗi vẫn tính vào trần - không cho spam retry đốt quota", async () => {
    generateError = new Error("quá tải");
    await run(makeCtx(), { mode: "ve_moi", prompt: "1" });
    await run(makeCtx(), { mode: "ve_moi", prompt: "2" });
    generateError = null;

    const result = await run(makeCtx(), { mode: "ve_moi", prompt: "3" });
    assert.match(loiCuaTool(result), /trần 2/);
  });

  it("chưa cấu hình đủ thì báo lỗi thay vì gọi API với key rỗng", async () => {
    settings.clearImageSettings();
    const result = await run(makeCtx(), { mode: "ve_moi", prompt: "con mèo" });
    settings.updateImageSettings({
      baseUrl: "https://router.test",
      model: "cx/gpt-5.5-image",
      apiKey: "sk-test",
    });

    assert.equal(events.filter((e) => e.kind === "generate").length, 0);
    assert.match(loiCuaTool(result), /chưa cấu hình/i);
  });
});

/**
 * Ca thật ngày 2026-08-05 (log turnId 166): provider chạy 129,9 giây rồi báo
 * "Codex did not return an image", người dùng nhận đúng một lời hứa rồi im.
 * Gọi lại ngay sau đó thì 9/9 lần ra ảnh.
 */
describe("create_image - hụt ảnh thì vẽ lại một lần", () => {
  const HUT_ANH = () =>
    new Error("Codex did not return an image. Account may not be entitled (Plus/Pro required).");

  it("hụt lần đầu -> nhắn báo rồi vẽ lại rồi GỬI ẢNH, người dùng vẫn nhận được ảnh", async () => {
    generateErrorQueue = [HUT_ANH()];

    const result = await run(makeCtx(), { mode: "ve_moi", prompt: "infographic tiếng Việt" });

    assert.deepEqual(
      events.map((e) => e.kind),
      ["text", "generate", "text", "generate", "file"],
      "thứ tự phải là: báo trước - vẽ hụt - báo thử lại - vẽ lại - gửi ảnh",
    );
    assert.match(result, /Đã vẽ và GỬI ảnh/);
  });

  it("câu báo thử lại nói THẲNG là lần đầu chưa ra, kèm mốc thời gian mới", async () => {
    generateErrorQueue = [HUT_ANH()];
    await run(makeCtx(), { mode: "ve_moi", prompt: "poster" });

    const texts = events.filter((e): e is { kind: "text"; msg: string } => e.kind === "text");
    assert.equal(texts.length, 2);
    assert.match(texts[1]!.msg, /chưa ra ảnh/i, "ậm ừ 'vẫn đang xử lý' thì lần chờ thứ hai không có lý do");
    assert.match(texts[1]!.msg, /\d/, "lời hứa 1-3 phút ở đầu lượt đã hết hạn, phải cho mốc mới");
  });

  it("câu báo thử lại VÀO history - thiếu thì dashboard và trí nhớ bot đều mất tin đã gửi", async () => {
    generateErrorQueue = [HUT_ANH()];
    const daGhi: string[] = [];
    const ctx = { ...makeCtx(), ghiNhanDaGui: (note: string) => void daGhi.push(note) } as ToolContext;

    await run(ctx, { mode: "ve_moi", prompt: "poster" });

    assert.equal(daGhi.length, 3, "báo trước + báo thử lại + ảnh");
    assert.ok(
      daGhi.some((n) => /chưa ra ảnh/i.test(n)),
      "câu báo thử lại là tin THẬT người ta đọc được, không phải log nội bộ",
    );
  });

  it("vẽ lại KHÔNG trừ thêm suất - phạt người dùng vì lỗi provider là sai", async () => {
    // Trần trong test là 2. Hai lượt, mỗi lượt hụt một lần rồi vẽ lại được:
    // tính đúng thì tiêu 2 suất, tính theo lần gọi API thì đã tiêu 4 và lượt
    // thứ hai đã bị chặn từ trước.
    generateErrorQueue = [HUT_ANH()];
    const dau = await run(makeCtx(), { mode: "ve_moi", prompt: "1" });
    assert.match(dau, /Đã vẽ và GỬI ảnh/);

    generateErrorQueue = [HUT_ANH()];
    const sau = await run(makeCtx(), { mode: "ve_moi", prompt: "2" });
    assert.match(sau, /Đã vẽ và GỬI ảnh/, "lượt thứ hai vẫn phải vẽ được");
  });

  it("hụt CẢ HAI lần -> nói thật với model, không gửi file rác", async () => {
    generateErrorQueue = [HUT_ANH(), HUT_ANH()];

    const result = await run(makeCtx(), { mode: "ve_moi", prompt: "poster" });

    assert.equal(events.filter((e) => e.kind === "generate").length, 2, "không được thử tới lần ba");
    assert.equal(events.filter((e) => e.kind === "file").length, 0);
    assert.match(loiCuaTool(result), /did not return an image/);
  });

  it("lỗi KHÁC lớp (sai key) thì KHÔNG vẽ lại và KHÔNG nhắn thử lại", async () => {
    generateError = new Error("API key required for remote API access");

    await run(makeCtx(), { mode: "ve_moi", prompt: "poster" });

    assert.equal(events.filter((e) => e.kind === "generate").length, 1);
    assert.equal(
      events.filter((e) => e.kind === "text").length,
      1,
      "chỉ còn câu báo trước - hứa 'đang thử lại' khi không thử lại là nói dối",
    );
  });
});

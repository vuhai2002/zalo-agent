import assert from "node:assert/strict";
import { loiCuaTool } from "./tool-failure-result-test-helper.js";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

let dataDir: string;
let tools: typeof import("./create-document-tools.js");
let rateLimit: typeof import("../../documents/document-rate-limit.js");
let zip: typeof import("../../shared/read-zip-entry.js");

/** Bắt lại mọi lần gọi sendMessage để kiểm tên file + nội dung thật đã gửi */
type SentFile = { fileName: string; buffer: Buffer; caption: string; threadId: string };
let sent: SentFile[] = [];
let sendShouldFail = false;

before(async () => {
  dataDir = setupTestEnv({ DOCUMENT_MAX_PER_HOUR: "5", DOCUMENT_MAX_ROWS: "10" });
  tools = await import("./create-document-tools.js");
  rateLimit = await import("../../documents/document-rate-limit.js");
  zip = await import("../../shared/read-zip-entry.js");
});

after(async () => {
  // Đọc cấu hình chỉnh-nóng nên module này mở SQLite - không đóng thì
  // Windows chặn xóa thư mục tạm (EPERM)
  (await import("../../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  sent = [];
  sendShouldFail = false;
  rateLimit.resetDocumentRateLimit();
});

function makeCtx() {
  return {
    api: {
      sendMessage: async (
        content: { msg: string; attachments: string[] },
        threadId: string,
      ) => {
        if (sendShouldFail) throw new Error("Zalo từ chối");
        const filePath = content.attachments[0]!;
        sent.push({
          fileName: path.basename(filePath),
          buffer: fs.readFileSync(filePath),
          caption: content.msg,
          threadId,
        });
        return {};
      },
    },
    account: { id: "acc-doc", disabledTools: [] },
    message: { threadId: "t-doc", threadType: 0 },
  } as never;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const run = (toolInstance: unknown, input: unknown): Promise<string> =>
  (toolInstance as any).execute(input, {});

describe("create_word_document", () => {
  it("tạo file, gửi đúng thread, tên file sạch, và DẶN model đừng gửi lại", async () => {
    const result = await run(tools.createWordDocumentTool(makeCtx()), {
      fileName: "Báo giá tháng 7",
      title: "Báo giá dịch vụ",
      blocks: [{ type: "paragraph", text: "Kính gửi Quý khách" }],
      caption: "File báo giá đây ạ",
    });

    assert.equal(sent.length, 1, "phải gửi đúng 1 file");
    assert.equal(sent[0]!.fileName, "Báo giá tháng 7.docx", "tên file không được dính prefix random");
    assert.equal(sent[0]!.caption, "File báo giá đây ạ");
    assert.equal(sent[0]!.threadId, "t-doc");
    assert.equal(sent[0]!.buffer.subarray(0, 2).toString(), "PK");

    const xml = zip.readZipEntryText(sent[0]!.buffer, "word/document.xml");
    assert.ok(xml.includes("Báo giá dịch vụ") && xml.includes("Kính gửi Quý khách"));
    // Pattern GoClaw: không dặn thì model rất dễ gọi tiếp send_file -> gửi 2 lần
    assert.match(result, /KHÔNG gọi send_file/);
  });

  it("xóa file tạm sau khi gửi xong - data/tmp không được để lại rác", async () => {
    await run(tools.createWordDocumentTool(makeCtx()), {
      fileName: "x",
      blocks: [{ type: "paragraph", text: "abc" }],
    });
    const tmpDir = path.join(dataDir, "tmp");
    const leftovers = fs.existsSync(tmpDir) ? fs.readdirSync(tmpDir) : [];
    assert.deepEqual(leftovers, [], "còn sót file/thư mục tạm");
  });

  it("vượt giới hạn nội dung -> trả thông báo, KHÔNG gửi file", async () => {
    const result = await run(tools.createWordDocumentTool(makeCtx()), {
      fileName: "to",
      blocks: [
        { type: "table", headers: ["A"], rows: Array.from({ length: 11 }, () => ["x"]) },
      ],
    });
    assert.equal(sent.length, 0);
    assert.match(loiCuaTool(result), /11 dòng.*trần 10/);
  });

  it("gửi lỗi -> trả câu cho model, không ném ra agent loop", async () => {
    sendShouldFail = true;
    const result = await run(tools.createWordDocumentTool(makeCtx()), {
      fileName: "x",
      blocks: [{ type: "paragraph", text: "abc" }],
    });
    assert.match(loiCuaTool(result), /Không tạo được file.*Zalo từ chối/);
    assert.match(loiCuaTool(result), /Nói thật với người dùng/);
  });

  it("hết suất trong giờ -> chặn, không gửi thêm", async () => {
    const ctx = makeCtx();
    const input = { fileName: "x", blocks: [{ type: "paragraph", text: "abc" }] };
    for (let i = 0; i < 5; i++) await run(tools.createWordDocumentTool(ctx), input);
    assert.equal(sent.length, 5);

    const blocked = await run(tools.createWordDocumentTool(ctx), input);
    assert.equal(sent.length, 5, "không được gửi file thứ 6");
    assert.match(loiCuaTool(blocked), /trần 5/);
  });
});

describe("create_excel_file", () => {
  it("payload TỰ NHIÊN của model (chuỗi/số/công thức chuỗi) qua được inputSchema rồi tạo file - hồi quy vụ chết trên Zalo", async () => {
    const toolInstance = tools.createExcelFileTool(makeCtx());
    // Đi qua ĐÚNG tầng validate như AI SDK làm - trước đây test bỏ qua tầng
    // này nên schema hỏng (Duplicate discriminator) mà test vẫn xanh
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const inputSchema = (toolInstance as any).inputSchema;
    const payload = {
      fileName: "tong-hop-drama",
      sheets: [
        {
          name: "Tổng quan",
          headers: ["Vụ việc", "Thiệt hại (tỷ)", "Ghi chú"],
          rows: [
            ["Vụ kim cương A", 5.5, "đang xét xử"],
            ["Vụ B", 2, ""],
            ["Tổng", "=SUM(B2:B3)", ""],
          ],
        },
      ],
    };

    const parsed = inputSchema.safeParse(payload);
    assert.equal(parsed.success, true, JSON.stringify(parsed.success ? "" : parsed.error?.issues));

    const result = await run(toolInstance, parsed.data);
    assert.equal(sent.length, 1, "phải gửi được file");
    const sheet = zip.readZipEntryText(sent[0]!.buffer, "xl/worksheets/sheet1.xml");
    assert.ok(sheet.includes("<f>SUM(B2:B3)</f>"), "công thức chuỗi phải thành công thức thật");
    assert.ok(sheet.includes("<v>7.5</v>"), "phải kèm giá trị cache 5.5 + 2 = 7.5");
    assert.match(result, /KHÔNG gọi send_file/);
  });

  it("tạo file có công thức KÈM giá trị cache rồi gửi", async () => {
    const result = await run(tools.createExcelFileTool(makeCtx()), {
      fileName: "bang-gia",
      sheets: [
        {
          name: "Báo giá",
          headers: ["Mặt hàng", "SL", "Đơn giá", "Thành tiền"],
          rows: [
            [
              { kind: "text", value: "Bàn phím" },
              { kind: "number", value: 2, format: "plain" },
              { kind: "number", value: 1500000, format: "money" },
              { kind: "formula", op: "multiply", columns: ["B", "C"] },
            ],
          ],
        },
      ],
    });

    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.fileName, "bang-gia.xlsx");
    const sheet = zip.readZipEntryText(sent[0]!.buffer, "xl/worksheets/sheet1.xml");
    assert.ok(sheet.includes("<f>B2*C2</f>"), "phải có công thức");
    assert.ok(sheet.includes("<v>3000000</v>"), "phải có giá trị cache để preview hiện số");
    assert.match(result, /KHÔNG gọi send_file/);
  });

  it("đuôi file nguy hiểm bị ép về .xlsx", async () => {
    await run(tools.createExcelFileTool(makeCtx()), {
      fileName: "../../hack.exe",
      sheets: [{ name: "S", headers: ["A"], rows: [[{ kind: "text", value: "x" }]] }],
    });
    assert.equal(sent.length, 1);
    assert.ok(sent[0]!.fileName.endsWith(".xlsx"), `tên thật: ${sent[0]!.fileName}`);
    assert.ok(!sent[0]!.fileName.includes(".."), `còn .. trong ${sent[0]!.fileName}`);
  });

  it("dòng lệch số cột -> chặn kèm tên sheet, không gửi", async () => {
    const result = await run(tools.createExcelFileTool(makeCtx()), {
      fileName: "lech",
      sheets: [
        { name: "Sai cột", headers: ["A", "B"], rows: [[{ kind: "text", value: "x" }]] },
      ],
    });
    assert.equal(sent.length, 0);
    assert.match(loiCuaTool(result), /Sai cột.*dòng 1/);
  });
});

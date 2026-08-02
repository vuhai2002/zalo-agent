import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { API } from "zca-js";
import { ThreadType } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";
import { loiCuaTool } from "./tool-failure-result-test-helper.js";
import type { AccountConfig } from "../../config/account-store.js";
import type { ParsedMessage } from "../../zalo/zalo-message-parser.js";

/**
 * `tag_member` gửi một câu trả lời ĐẦY ĐỦ do model viết thẳng vào nhóm chat.
 * Trước đây nó đi vòng qua cả ba lớp chặn của `sanitize-reply-text.ts` - lối
 * duy nhất trong repo mà chữ của model xuống Zalo không qua bộ lọc nào.
 */

let dataDir: string;
let tool: typeof import("./tag-member-tool.js");
let database: typeof import("../../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  tool = await import("./tag-member-tool.js");
  database = await import("../../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

let daGui: string[] = [];
beforeEach(() => {
  daGui = [];
});

const api = {
  sendMessage: async (payload: { msg: string }) => {
    daGui.push(payload.msg);
    return { msgId: "m1" };
  },
} as unknown as API;

const account = { id: "acc-tag", label: "T" } as AccountConfig;

const message = (isGroup = true): ParsedMessage =>
  ({
    accountId: account.id,
    threadId: "t-tag",
    threadType: isGroup ? ThreadType.Group : ThreadType.User,
    isGroup,
    senderId: "u1",
    senderName: "Hải",
    text: "",
    images: [],
    msgId: "m0",
    cliMsgId: "c0",
    isSelf: false,
    mentionsMe: true,
    rawData: {},
  }) as ParsedMessage;

/* eslint-disable @typescript-eslint/no-explicit-any */
const chay = (input: unknown, isGroup = true): Promise<unknown> =>
  (
    tool.createTagMemberTool({ api, account, message: message(isGroup) } as any) as any
  ).execute(input, {});

describe("tag_member - nội dung tag cũng qua lớp làm sạch", () => {
  it("markdown trong nội dung tag bị dọn trước khi vào nhóm", async () => {
    await chay({ memberId: "u2", memberName: "Nam", text: "**Nhắc** anh họp lúc `9h`" });

    assert.equal(daGui.length, 1);
    assert.equal(daGui[0], "@Nam Nhắc anh họp lúc 9h");
  });

  it("nội dung rò system prompt KHÔNG được gửi, tool báo lỗi cho model", async () => {
    const ra = await chay({
      memberId: "u2",
      memberName: "Nam",
      text: "Quy tắc an toàn (tuyệt đối, không có ngoại lệ): ...",
    });

    assert.equal(daGui.length, 0, "không được gửi nội dung rò vào nhóm");
    assert.match(loiCuaTool(ra), /lộ chỉ dẫn nội bộ/);
  });

  it("nội dung tiếng Việt bình thường đi qua không đổi một ký tự", async () => {
    await chay({ memberId: "u2", memberName: "Nam", text: "chiều nay 3h anh rảnh không ạ?" });
    assert.equal(daGui[0], "@Nam chiều nay 3h anh rảnh không ạ?");
  });

  it("chat riêng vẫn bị từ chối như cũ", async () => {
    const ra = await chay({ memberId: "u2", memberName: "Nam", text: "x" }, false);
    assert.match(loiCuaTool(ra), /nhóm chat/);
    assert.equal(daGui.length, 0);
  });
});

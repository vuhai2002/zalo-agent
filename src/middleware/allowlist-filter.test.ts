import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ThreadType } from "zca-js";
import type { AccountConfig } from "../config/accounts.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { shouldRespond } from "./allowlist-filter.js";

// allowlist-filter không chạm src/config/env.ts nên import tĩnh được bình thường

function makeAccount(overrides: Partial<AccountConfig> = {}): AccountConfig {
  return {
    id: "acc-test",
    label: "Test",
    enabled: true,
    persona: "",
    allowlist: { mode: "all", userIds: [] },
    groupRequireMention: true,
    respondToGroups: true,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    accountId: "acc-test",
    threadId: "thread-1",
    threadType: ThreadType.User,
    isGroup: false,
    senderId: "user-1",
    senderName: "Người dùng",
    text: "chào bot",
    images: [],
    msgId: "m1",
    cliMsgId: "c1",
    isSelf: false,
    mentionsMe: false,
    rawData: {},
    ...overrides,
  };
}

describe("shouldRespond", () => {
  it("bỏ qua tin do chính bot gửi", () => {
    const decision = shouldRespond(makeAccount(), makeMessage({ isSelf: true }));
    assert.equal(decision.respond, false);
  });

  it("bỏ qua tin không có text lẫn ảnh (sticker, voice...)", () => {
    const decision = shouldRespond(makeAccount(), makeMessage({ text: "   " }));
    assert.equal(decision.respond, false);
  });

  it("nhận tin chỉ có ảnh, không có chữ", () => {
    const msg = makeMessage({ text: "", images: [{ url: "https://example.com/a.jpg" }] });
    assert.equal(shouldRespond(makeAccount(), msg).respond, true);
  });

  it("bỏ qua group khi account tắt trả lời group", () => {
    const account = makeAccount({ respondToGroups: false });
    const msg = makeMessage({ isGroup: true, threadType: ThreadType.Group, mentionsMe: true });
    assert.equal(shouldRespond(account, msg).respond, false);
  });

  it("bỏ qua group khi bắt buộc @mention mà tin không mention bot", () => {
    const msg = makeMessage({ isGroup: true, threadType: ThreadType.Group, mentionsMe: false });
    assert.equal(shouldRespond(makeAccount(), msg).respond, false);
  });

  it("trả lời trong group khi có @mention bot", () => {
    const msg = makeMessage({ isGroup: true, threadType: ThreadType.Group, mentionsMe: true });
    assert.equal(shouldRespond(makeAccount(), msg).respond, true);
  });

  it("trả lời trong group không cần mention khi groupRequireMention=false", () => {
    const account = makeAccount({ groupRequireMention: false });
    const msg = makeMessage({ isGroup: true, threadType: ThreadType.Group, mentionsMe: false });
    assert.equal(shouldRespond(account, msg).respond, true);
  });

  it("chặn sender ngoài allowlist khi mode=list", () => {
    const account = makeAccount({ allowlist: { mode: "list", userIds: ["user-9"] } });
    const decision = shouldRespond(account, makeMessage({ senderId: "user-1" }));
    assert.equal(decision.respond, false);
    assert.match(decision.reason, /allowlist/);
  });

  it("cho qua sender nằm trong allowlist khi mode=list", () => {
    const account = makeAccount({ allowlist: { mode: "list", userIds: ["user-1"] } });
    assert.equal(shouldRespond(account, makeMessage({ senderId: "user-1" })).respond, true);
  });

  it("mode=all thì không lọc theo userIds", () => {
    const account = makeAccount({ allowlist: { mode: "all", userIds: ["user-9"] } });
    assert.equal(shouldRespond(account, makeMessage({ senderId: "user-1" })).respond, true);
  });
});

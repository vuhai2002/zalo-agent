import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ThreadType } from "zca-js";
import type { AccountConfig } from "../config/account-store.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { shouldRespond } from "./allowlist-filter.js";

// allowlist-filter không chạm src/config/env.ts nên import tĩnh được bình thường

function makeAccount(overrides: Partial<AccountConfig> = {}): AccountConfig {
  return {
    id: "acc-test",
    label: "Test",
    enabled: true,
    agentId: "agent-test",
    allowlist: { mode: "all", userIds: [] },
    groupRequireMention: true,
    respondToGroups: true,
    groupPassiveListen: true,
    autoReactEnabled: true,
    autoReactIcon: "heart",
    typingIndicatorEnabled: true,
    disabledTools: [],
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

  it("group không @mention + passive listen: không trả lời nhưng ghi history", () => {
    const msg = makeMessage({ isGroup: true, threadType: ThreadType.Group, mentionsMe: false });
    const decision = shouldRespond(makeAccount(), msg);
    assert.equal(decision.respond, false);
    assert.equal(decision.record, true);
  });

  it("group không @mention + tắt passive listen: bỏ qua hẳn", () => {
    const account = makeAccount({ groupPassiveListen: false });
    const msg = makeMessage({ isGroup: true, threadType: ThreadType.Group, mentionsMe: false });
    const decision = shouldRespond(account, msg);
    assert.equal(decision.respond, false);
    assert.equal(decision.record, false);
  });

  it("thread tắt bot: không trả lời nhưng vẫn ghi history", () => {
    const decision = shouldRespond(makeAccount(), makeMessage(), false);
    assert.equal(decision.respond, false);
    assert.equal(decision.record, true);
  });

  it("ngoài allowlist thì không ghi gì kể cả khi thread tắt bot", () => {
    const account = makeAccount({ allowlist: { mode: "list", userIds: ["user-9"] } });
    const decision = shouldRespond(account, makeMessage({ senderId: "user-1" }), false);
    assert.equal(decision.record, false);
  });

  it("tin của chính bot không bao giờ được ghi passive", () => {
    const decision = shouldRespond(makeAccount(), makeMessage({ isSelf: true }));
    assert.equal(decision.record, false);
  });

  it("tin được trả lời thì cũng được ghi history", () => {
    const decision = shouldRespond(makeAccount(), makeMessage());
    assert.equal(decision.respond, true);
    assert.equal(decision.record, true);
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

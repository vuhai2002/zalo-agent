import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

const MAX_FACTS = 5;

let dataDir: string;
let memory: typeof import("./memory-store.js");
let database: typeof import("./database.js");

before(async () => {
  dataDir = setupTestEnv({ MEMORY_MAX_FACTS_PER_SUBJECT: String(MAX_FACTS) });
  memory = await import("./memory-store.js");
  database = await import("./database.js");

  // Fact về user A: 1 học ở DM, 1 học ở group G1
  memory.saveMemoryFact({
    accountId: "acc-1",
    subjectId: "user-a",
    content: "A lương 50 triệu (bí mật DM)",
    learnedInThreadId: "user-a",
    learnedInGroup: false,
  });
  memory.saveMemoryFact({
    accountId: "acc-1",
    subjectId: "user-a",
    content: "A thích đá bóng (nói trong nhóm)",
    learnedInThreadId: "group-1",
    learnedInGroup: true,
  });
  // Fact về group G1
  memory.saveMemoryFact({
    accountId: "acc-1",
    subjectId: "group-1",
    content: "Nhóm chốt đi Đà Lạt tháng 8",
    learnedInThreadId: "group-1",
    learnedInGroup: true,
  });
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("memory-store - quy tắc inject bất đối xứng", () => {
  it("chat riêng với A: thấy MỌI fact về A, kể cả fact học trong nhóm", () => {
    const facts = memory.getMemoriesForContext({
      accountId: "acc-1",
      threadId: "user-a",
      senderId: "user-a",
      isGroup: false,
    });
    const contents = facts.map((f) => f.content);
    assert.ok(contents.includes("A lương 50 triệu (bí mật DM)"));
    assert.ok(contents.includes("A thích đá bóng (nói trong nhóm)"));
  });

  it("trong group, A nói: fact DM của A TUYỆT ĐỐI không xuất hiện", () => {
    const facts = memory.getMemoriesForContext({
      accountId: "acc-1",
      threadId: "group-1",
      senderId: "user-a",
      isGroup: true,
    });
    const contents = facts.map((f) => f.content);
    assert.ok(!contents.some((c) => c.includes("lương 50 triệu")), "fact DM bị lộ ra group!");
    assert.ok(contents.includes("A thích đá bóng (nói trong nhóm)"));
    assert.ok(contents.includes("Nhóm chốt đi Đà Lạt tháng 8"));
  });

  it("trong group, người KHÁC nói: chỉ thấy fact của group, không thấy fact của A", () => {
    const facts = memory.getMemoriesForContext({
      accountId: "acc-1",
      threadId: "group-1",
      senderId: "user-b",
      isGroup: true,
    });
    assert.deepEqual(facts.map((f) => f.content), ["Nhóm chốt đi Đà Lạt tháng 8"]);
  });

  it("chat riêng với người lạ chưa có fact: rỗng", () => {
    const facts = memory.getMemoriesForContext({
      accountId: "acc-1",
      threadId: "user-z",
      senderId: "user-z",
      isGroup: false,
    });
    assert.equal(facts.length, 0);
  });
});

describe("memory-store - chặn ghi trùng khít", () => {
  const ghi = (content: string, subjectId = "user-trung") =>
    memory.saveMemoryFact({
      accountId: "acc-1",
      subjectId,
      content,
      learnedInThreadId: subjectId,
      learnedInGroup: false,
    });

  it("ghi lần đầu thì nhận, ghi y hệt lần hai thì từ chối", () => {
    assert.deepEqual(ghi("B thích trà sữa ít đường"), { ghi: true });
    assert.deepEqual(ghi("B thích trà sữa ít đường"), { ghi: false, lyDo: "trung" });
  });

  it("từ chối rồi thì KHÔNG có bản thứ hai trong kho", () => {
    ghi("B nuôi một con mèo tên Mun");
    ghi("B nuôi một con mèo tên Mun");
    const facts = memory.getMemoriesForContext({
      accountId: "acc-1",
      threadId: "user-trung",
      senderId: "user-trung",
      isGroup: false,
    });
    assert.equal(facts.filter((f) => f.content === "B nuôi một con mèo tên Mun").length, 1);
  });

  it("khác khoảng trắng hai đầu vẫn là trùng - model xuống dòng thừa là chuyện thường", () => {
    ghi("B làm ca đêm");
    assert.deepEqual(ghi("  B làm ca đêm\n"), { ghi: false, lyDo: "trung" });
  });

  it("chỉ khác DẤU là hai điều khác nhau, phải ghi cả hai", () => {
    // Cố ý không hạ chữ thường / bỏ dấu khi so: "mắt" với "mất" là hai nghĩa,
    // chặn nhầm ở đây nghĩa là bot im lặng không nhớ điều người dùng vừa dặn
    assert.deepEqual(ghi("B hay đau mắt"), { ghi: true });
    assert.deepEqual(ghi("B hay đau mất"), { ghi: true });
  });

  it("cùng nội dung nhưng KHÁC người thì vẫn ghi - trùng xét theo từng subject", () => {
    assert.deepEqual(ghi("Thích ăn cay", "user-trung-1"), { ghi: true });
    assert.deepEqual(ghi("Thích ăn cay", "user-trung-2"), { ghi: true });
  });
});

describe("memory-store - cap và xóa", () => {
  it("vượt cap thì fact cũ nhất bị thay", () => {
    for (let i = 1; i <= MAX_FACTS + 3; i++) {
      memory.saveMemoryFact({
        accountId: "acc-1",
        subjectId: "user-cap",
        content: `fact-${i}`,
        learnedInThreadId: "user-cap",
        learnedInGroup: false,
      });
    }
    const facts = memory.getMemoriesForContext({
      accountId: "acc-1",
      threadId: "user-cap",
      senderId: "user-cap",
      isGroup: false,
    });
    assert.equal(facts.length, MAX_FACTS);
    assert.equal(facts[0]!.content, `fact-4`); // 1..3 bị xóa
  });

  it("xóa fact qua dashboard", () => {
    const listed = memory.listMemories({ accountId: "acc-1", query: "Đà Lạt" });
    assert.equal(listed.length, 1);
    assert.equal(memory.deleteMemoryFact("acc-1", listed[0]!.id), true);
    assert.equal(memory.listMemories({ accountId: "acc-1", query: "Đà Lạt" }).length, 0);
  });

  it("xóa fact của account khác không được", () => {
    assert.equal(memory.deleteMemoryFact("acc-khac", 99999), false);
  });
});

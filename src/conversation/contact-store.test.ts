import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let contacts: typeof import("./contact-store.js");
let database: typeof import("./database.js");

before(async () => {
  dataDir = setupTestEnv();
  contacts = await import("./contact-store.js");
  database = await import("./database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("contact-store", () => {
  it("upsert tạo contact mới, các lần sau tăng count + cập nhật last_seen", () => {
    contacts.recordContactActivity("acc-1", "u-dem", "Hải");
    contacts.recordContactActivity("acc-1", "u-dem", "Hải");

    const rows = contacts.listContacts({ accountId: "acc-1", query: "u-dem" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.messageCount, 2);
    assert.ok(rows[0]!.lastSeen >= rows[0]!.firstSeen);
  });

  it("tên mới không rỗng thì cập nhật, rỗng thì giữ tên cũ", () => {
    contacts.recordContactActivity("acc-1", "u-ten", "Tên Cũ");
    contacts.recordContactActivity("acc-1", "u-ten", "");
    let rows = contacts.listContacts({ accountId: "acc-1", query: "u-ten" });
    assert.equal(rows[0]!.displayName, "Tên Cũ");

    contacts.recordContactActivity("acc-1", "u-ten", "Tên Mới");
    rows = contacts.listContacts({ accountId: "acc-1", query: "u-ten" });
    assert.equal(rows[0]!.displayName, "Tên Mới");
  });

  it("userId rỗng bị bỏ qua (payload thiếu uidFrom)", () => {
    contacts.recordContactActivity("acc-1", "", "Ai Đó");
    const rows = contacts.listContacts({ accountId: "acc-1", query: "Ai Đó" });
    assert.equal(rows.length, 0);
  });

  it("cùng user_id ở account khác được tính riêng", () => {
    contacts.recordContactActivity("acc-1", "u-chung", "A");
    contacts.recordContactActivity("acc-2", "u-chung", "A");
    contacts.recordContactActivity("acc-2", "u-chung", "A");

    assert.equal(contacts.listContacts({ accountId: "acc-1", query: "u-chung" })[0]!.messageCount, 1);
    assert.equal(contacts.listContacts({ accountId: "acc-2", query: "u-chung" })[0]!.messageCount, 2);
  });

  it("search theo tên hiển thị hoạt động", () => {
    contacts.recordContactActivity("acc-1", "u-search", "Nguyễn Văn Tìm");
    const rows = contacts.listContacts({ accountId: "acc-1", query: "Văn Tìm" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.userId, "u-search");
  });

  it("xoaContact bỏ ĐÚNG một dòng, theo cả account_id", () => {
    contacts.recordContactActivity("acc-x", "u-xoa", "Xóa Tôi");
    contacts.recordContactActivity("acc-y", "u-xoa", "Cùng id khác account");

    const ok = contacts.xoaContact("acc-x", "u-xoa");
    assert.equal(ok, true);
    assert.equal(contacts.listContacts({ accountId: "acc-x", query: "u-xoa" }).length, 0);
    // Cùng user_id ở account khác PHẢI còn - thiếu account_id trong WHERE là xóa oan
    assert.equal(contacts.listContacts({ accountId: "acc-y", query: "u-xoa" }).length, 1);
  });

  it("xóa xong người đó nhắn lại thì danh bạ tự hiện lại (auto-collected)", () => {
    contacts.recordContactActivity("acc-1", "u-lai", "Hải");
    contacts.xoaContact("acc-1", "u-lai");
    assert.equal(contacts.listContacts({ accountId: "acc-1", query: "u-lai" }).length, 0);

    contacts.recordContactActivity("acc-1", "u-lai", "Hải");
    const rows = contacts.listContacts({ accountId: "acc-1", query: "u-lai" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.messageCount, 1, "đếm lại từ đầu sau khi xóa");
  });

  it("xóa cái không tồn tại trả false, không ném", () => {
    assert.equal(contacts.xoaContact("acc-1", "u-khong-co"), false);
  });
});

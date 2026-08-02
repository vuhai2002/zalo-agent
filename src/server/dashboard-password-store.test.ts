import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Đổi mật khẩu dashboard từ web. Đây là code bảo mật nên mấy bất biến dưới đây
 * phải được canh: mật khẩu không được lưu bản rõ, đổi xong phiên cũ phải chết,
 * và env vẫn là công tắc bật/tắt dashboard.
 */

const ENV_PASSWORD = "mat-khau-trong-env-123";

let dataDir: string;
let store: typeof import("./dashboard-password-store.js");
let auth: typeof import("./dashboard-auth.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: ENV_PASSWORD });
  store = await import("./dashboard-password-store.js");
  auth = await import("./dashboard-auth.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  database.db.exec("DELETE FROM runtime_settings WHERE key = 'dashboard_password';");
  database.db.exec("DELETE FROM dashboard_sessions;");
});

describe("dashboard-password-store", () => {
  it("chưa đổi lần nào thì mật khẩu trong .env vẫn đúng", () => {
    assert.equal(store.hasStoredPassword(), false);
    assert.equal(store.verifyPassword(ENV_PASSWORD), true);
    assert.equal(store.verifyPassword("sai"), false);
  });

  it("đổi xong thì mật khẩu MỚI đúng, mật khẩu trong .env hết tác dụng", () => {
    store.setStoredPassword("mat-khau-moi-456");

    assert.equal(store.verifyPassword("mat-khau-moi-456"), true);
    assert.equal(
      store.verifyPassword(ENV_PASSWORD),
      false,
      "mật khẩu cũ trong .env còn dùng được thì đổi mật khẩu là vô nghĩa",
    );
  });

  it("KHÔNG lưu bản rõ - đọc được file DB cũng không thấy mật khẩu", () => {
    store.setStoredPassword("mat-khau-rat-bi-mat-789");
    const row = database.db
      .prepare("SELECT value FROM runtime_settings WHERE key = 'dashboard_password'")
      .get() as { value: string };

    assert.doesNotMatch(row.value, /mat-khau-rat-bi-mat-789/, "mật khẩu bản rõ nằm thẳng trong DB");
    assert.match(row.value, /^[0-9a-f]+:[0-9a-f]+$/, "phải là dạng salt:hash");
  });

  it("mỗi lần đặt dùng salt KHÁC nhau - cùng mật khẩu ra hai bản ghi khác nhau", () => {
    store.setStoredPassword("trung-mat-khau");
    const lan1 = (
      database.db.prepare("SELECT value FROM runtime_settings WHERE key = 'dashboard_password'").get() as {
        value: string;
      }
    ).value;
    store.setStoredPassword("trung-mat-khau");
    const lan2 = (
      database.db.prepare("SELECT value FROM runtime_settings WHERE key = 'dashboard_password'").get() as {
        value: string;
      }
    ).value;

    assert.notEqual(lan1, lan2, "salt dùng lại thì hai tài khoản cùng mật khẩu lộ ra là giống nhau");
    assert.equal(store.verifyPassword("trung-mat-khau"), true, "vẫn phải verify được sau khi đổi salt");
  });

  it("bản ghi hỏng KHÔNG rơi về .env - xoá/sửa liều không hạ được mật khẩu về cũ", () => {
    store.setStoredPassword("mat-khau-moi-456");
    database.db
      .prepare("UPDATE runtime_settings SET value = 'rac-khong-dung-dinh-dang' WHERE key = 'dashboard_password'")
      .run();

    assert.equal(store.verifyPassword(ENV_PASSWORD), false, "không được rơi về mật khẩu .env");
    assert.equal(store.verifyPassword("mat-khau-moi-456"), false);
  });
});

describe("đổi mật khẩu + phiên đăng nhập", () => {
  it("đổi mật khẩu là mọi phiên cũ hết hiệu lực NGAY", () => {
    const token = auth.createSessionToken();
    assert.equal(auth.verifySessionToken(token), true, "phiên vừa tạo phải dùng được");

    store.setStoredPassword("mat-khau-moi-456");

    assert.equal(
      auth.verifySessionToken(token),
      false,
      "cookie cũ còn dùng được sau khi đổi mật khẩu = đổi mật khẩu không cứu được tài khoản bị lộ",
    );
  });

  it("phiên tạo SAU khi đổi thì dùng bình thường", () => {
    store.setStoredPassword("mat-khau-moi-456");
    assert.equal(auth.verifySessionToken(auth.createSessionToken()), true);
  });

  it("checkPassword đi qua đúng mật khẩu đang hiệu lực", () => {
    assert.equal(auth.checkPassword(ENV_PASSWORD), true);
    store.setStoredPassword("mat-khau-moi-456");
    assert.equal(auth.checkPassword("mat-khau-moi-456"), true);
    assert.equal(auth.checkPassword(ENV_PASSWORD), false);
  });
});

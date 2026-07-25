import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let clientIp: typeof import("./client-ip.js");

before(async () => {
  dataDir = setupTestEnv();
  clientIp = await import("./client-ip.js");
});

after(() => cleanupTestEnv(dataDir));

describe("rightmostForwardedFor", () => {
  it("lấy entry phải nhất - đó là entry do proxy ghi, không phải client bịa", () => {
    // Caddy/Nginx APPEND ip client vào cuối chuỗi có sẵn
    assert.equal(clientIp.rightmostForwardedFor("1.1.1.1, 203.0.113.9"), "203.0.113.9");
    // Client tự gửi XFF giả để né rate limit -> phần giả nằm bên trái, bị bỏ
    assert.equal(clientIp.rightmostForwardedFor("ip-bia-ra, 8.8.8.8, 203.0.113.9"), "203.0.113.9");
  });

  it("một entry duy nhất thì lấy chính nó", () => {
    assert.equal(clientIp.rightmostForwardedFor("203.0.113.9"), "203.0.113.9");
  });

  it("header rỗng/thiếu/toàn dấu phẩy trả undefined để rơi về IP socket", () => {
    assert.equal(clientIp.rightmostForwardedFor(undefined), undefined);
    assert.equal(clientIp.rightmostForwardedFor(""), undefined);
    assert.equal(clientIp.rightmostForwardedFor(" , , "), undefined);
  });

  it("bỏ khoảng trắng quanh entry", () => {
    assert.equal(clientIp.rightmostForwardedFor("1.1.1.1,   203.0.113.9   "), "203.0.113.9");
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * `DASHBOARD_HOST` là chỗ dễ sai theo HAI hướng ngược nhau, và cả hai đều hỏng
 * câm - không lỗi, không log, chỉ là không ai vào được hoặc ai cũng vào được:
 *
 *   - Mặc định thành `0.0.0.0`: mọi bản cài chạy thẳng trên máy chủ (không
 *     Docker) lập tức phơi dashboard ra internet. Đây là kiểu "sửa cho Docker
 *     chạy" rất dễ bị làm, vì nó khiến `docker run` trần hoạt động ngay.
 *   - Trong container để `127.0.0.1`: đó là loopback CỦA CONTAINER, Docker
 *     không chuyển tiếp cổng vào đó được nên reverse proxy chỉ nhận connection
 *     refused. Bot chạy bình thường, log không một dòng lỗi.
 *
 * Hai khẳng định dưới đây khóa cả hai đầu. Chúng đọc file thật (schema env và
 * Dockerfile) vì bất biến này nằm ở CHỖ GIAO giữa code và cách đóng gói - không
 * file nào một mình giữ được.
 */

const goc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const doc = (p: string) => fs.readFileSync(path.join(goc, p), "utf8");

describe("DASHBOARD_HOST - hai đầu phải ngược nhau", () => {
  it("mặc định trong schema là loopback, KHÔNG phải 0.0.0.0", async () => {
    const { env } = await import("./env.js");
    assert.equal(
      env.DASHBOARD_HOST,
      "127.0.0.1",
      "đổi mặc định thành 0.0.0.0 là phơi dashboard của mọi bản cài chạy thẳng trên máy chủ",
    );
  });

  it("Dockerfile ĐẶT 0.0.0.0 - thiếu dòng này thì container không ai vào được", () => {
    const dockerfile = doc("Dockerfile");
    assert.match(
      dockerfile,
      /^ENV DASHBOARD_HOST=0\.0\.0\.0$/m,
      "container phải nghe trên mọi interface; chặn phơi ra ngoài là việc của publish port phía host",
    );
  });

  it("server nối DÂY tới biến, không bind cứng", () => {
    // Ba khẳng định kia đúng hết mà ai đó bind cứng lại trong code thì vẫn hỏng
    // câm - phá code đã chứng minh chúng không bắt được nhánh này.
    const src = doc("src/server/dashboard-server.ts");
    assert.match(
      src,
      /hostname:\s*env\.DASHBOARD_HOST/,
      "bind cứng ở đây là mọi cấu hình DASHBOARD_HOST thành vô nghĩa",
    );
  });

  it("compose publish cổng CHỈ trên 127.0.0.1 của host", () => {
    // Đây mới là chỗ chặn phơi ra internet. Docker ghi thẳng iptables nên bind
    // 0.0.0.0 ở đây là lộ ra ngoài bất kể UFW cấu hình thế nào.
    const compose = doc("docker-compose.prod.yml");
    const dongPort = compose.split("\n").filter((d) => /:3900"/.test(d));

    assert.ok(dongPort.length > 0, "không tìm thấy dòng publish cổng - phép đo này đang rỗng");
    for (const d of dongPort) {
      assert.match(d, /"127\.0\.0\.1:/, `dòng publish phải neo vào 127.0.0.1: ${d.trim()}`);
    }
  });
});

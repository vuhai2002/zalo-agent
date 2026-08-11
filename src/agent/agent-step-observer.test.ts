import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import { ketQuaLoi } from "./tools/tool-failure-result.js";
import type { StepTrace } from "./agent-step-trace.js";

/**
 * `agent-step-observer` đọc `getTuning`, mà `runtime-tuning-settings.ts` dòng
 * ĐẦU TIÊN là `import { db } from "../conversation/database.js"` - tức nó CÓ
 * chạm DB, và `database.ts` mở SQLite + chạy migration ở MODULE SCOPE.
 *
 * Chú thích cũ ở đây khẳng định ngược lại ("chỉ đọc env/bộ nhớ, không chạm
 * DB") và vì thế file này import TĨNH, tức mở `data/zalo-agent.db` THẬT mỗi
 * lần chạy `pnpm test`. Migration hiện idempotent nên chưa mất gì, nhưng một
 * migration có backfill/ALTER sau này sẽ chạy lên dữ liệu thật.
 *
 * Nạp động sau `setupTestEnv()` - xem CLAUDE.md mục "Bẫy khi viết test".
 */

let dataDir: string;
let modQuanSat: typeof import("./agent-step-observer.js");
let modGuard: typeof import("./tool-loop-guard.js");

before(async () => {
  dataDir = setupTestEnv();
  modQuanSat = await import("./agent-step-observer.js");
  modGuard = await import("./tool-loop-guard.js");
});

after(async () => {
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

const NGUONG = { chanLoiGiongHet: 5, chanCungToolLoi: 8, chanKhongTienTrien: 5 };
const laToolChiDoc = (t: string) => t === "web_fetch";

describe("forLog - nhánh hỏng hiện CÂU, không hiện vỏ JSON", () => {
  it("kết quả đánh dấu hỏng ra câu tiếng Việt đọc được", () => {
    const ra = modQuanSat.forLog(ketQuaLoi('Không có file "bao-gia.pdf" trong kho shared-files'), 300);
    // Vỏ JSON escape ngoặc kép hai lần và ăn mất ~20 ký tự của trần - mà phần bị
    // cắt lại chính là phần nói vì sao hỏng
    assert.ok(!ra.includes('\\"'), `không được escape ngoặc kép: ${ra}`);
    assert.ok(!ra.includes('{"ok"'), `không được lộ vỏ JSON: ${ra}`);
    assert.match(ra, /Không có file "bao-gia\.pdf"/);
  });

  it("chuỗi trần và object thường vẫn như cũ", () => {
    assert.equal(modQuanSat.forLog("nội dung trang", 300), "nội dung trang");
    assert.equal(modQuanSat.forLog({ url: "https://a.test" }, 300), '{"url":"https://a.test"}');
    assert.equal(modQuanSat.forLog(undefined, 300), "undefined");
  });

  it("vẫn cắt theo trần", () => {
    const ra = modQuanSat.forLog(ketQuaLoi("x".repeat(500)), 50);
    assert.ok(ra.length <= 53, `phải cắt: ${ra.length} ký tự`);
    assert.ok(ra.endsWith("..."));
  });
});

describe("taoQuanSatStep - lỗi bên trong KHÔNG được thoát ra", () => {
  /**
   * Bất biến sống còn. `notify()` của ai@7.0.37 gọi callback trong
   * `try {...} catch (e) {}` RỖNG, nên nếu observer ném thì SDK nuốt sạch: guard
   * ngừng đếm, trace ngừng ghi, log không có gì. Ta phải tự bắt để còn lại một
   * dòng ERROR - và để `runAgentTurn` không phụ thuộc vào việc SDK có nuốt hay
   * không (phiên bản sau đổi hành vi là cả lượt chết).
   */
  it("guard ném thì handler nuốt lại, không ném ra ngoài", () => {
    const guardHong = {
      ghiNhan() {
        throw new Error("guard vỡ");
      },
    } as unknown as import("./tool-loop-guard.js").ToolLoopGuard;

    const quanSat = modQuanSat.taoQuanSatStep({ guard: guardHong, trace: [], layLanChay: () => 1 });
    assert.doesNotThrow(() => quanSat({ toolResults: [], content: [] }));
  });

  it("step có hình dạng lạ cũng không ném", () => {
    const guard = new modGuard.ToolLoopGuard(NGUONG, laToolChiDoc);
    const quanSat = modQuanSat.taoQuanSatStep({ guard, trace: [], layLanChay: () => 1 });
    for (const step of [{}, { toolResults: undefined }, { content: undefined }]) {
      assert.doesNotThrow(() => quanSat(step));
    }
  });

  it("lượt chạy được thì vẫn đếm cho guard và đẩy trace ra mảng của caller", () => {
    // Đối chứng cho hai ca trên: bọc try/catch không được nuốt luôn phần việc thật
    const guard = new modGuard.ToolLoopGuard({ ...NGUONG, chanLoiGiongHet: 2 }, laToolChiDoc);
    const trace: StepTrace[] = [];
    const quanSat = modQuanSat.taoQuanSatStep({ guard, trace, layLanChay: () => 1 });

    const step = {
      toolResults: [{ toolName: "web_fetch", input: { url: "x" }, output: ketQuaLoi("hỏng") }],
      content: [],
    };
    quanSat(step);
    assert.equal(guard.daChan(), false, "mới một lần");
    quanSat(step);
    assert.equal(guard.daChan(), true, "lần hai chạm ngưỡng - guard vẫn được nuôi");
    assert.equal(trace.length, 2, "trace phải ra mảng của caller");
  });
});

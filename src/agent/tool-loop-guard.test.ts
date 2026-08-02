import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  canhBaoTu,
  chuKyLenhGoi,
  ToolLoopGuard,
  type BuocDaChay,
  type NguongGuard,
} from "./tool-loop-guard.js";

/**
 * Module thuần nên test không cần setupTestEnv, không cần import động - ngoại
 * lệ hợp lệ của bẫy "database.ts chạy migration ở module scope".
 */

const NGUONG: NguongGuard = { chanLoiGiongHet: 5, chanCungToolLoi: 8, chanKhongTienTrien: 5 };

/** Chỉ `web_search` và `web_fetch` là tool đọc trong các test dưới đây */
const laToolChiDoc = (t: string) => t === "web_search" || t === "web_fetch";

let guard: ToolLoopGuard;
beforeEach(() => {
  guard = new ToolLoopGuard(NGUONG, laToolChiDoc);
});

/** Step chỉ có tool LỖI - lỗi nằm ở `content`, KHÔNG nằm ở `toolResults` */
const buocLoi = (toolName: string, input: unknown): BuocDaChay => ({
  content: [{ type: "tool-error", toolName, input }],
  toolResults: [],
});

/** Step có tool chạy XONG, trả kết quả */
const buocXong = (toolName: string, input: unknown, output: unknown): BuocDaChay => ({
  content: [{ type: "text" }],
  toolResults: [{ toolName, input, output }],
});

describe("chuKyLenhGoi", () => {
  it("cùng tham số nhưng khác THỨ TỰ khóa vẫn ra một chữ ký", () => {
    assert.equal(
      chuKyLenhGoi("web_fetch", { url: "https://a.test", timeout: 5 }),
      chuKyLenhGoi("web_fetch", { timeout: 5, url: "https://a.test" }),
    );
  });

  it("sắp khóa ở MỌI cấp, không chỉ cấp ngoài cùng", () => {
    assert.equal(
      chuKyLenhGoi("t", { a: { x: 1, y: 2 } }),
      chuKyLenhGoi("t", { a: { y: 2, x: 1 } }),
    );
  });

  it("khác tham số thì khác chữ ký; khác tool cũng khác", () => {
    assert.notEqual(chuKyLenhGoi("t", { url: "a" }), chuKyLenhGoi("t", { url: "b" }));
    assert.notEqual(chuKyLenhGoi("t1", { url: "a" }), chuKyLenhGoi("t2", { url: "a" }));
  });

  it("KHÔNG giữ tham số thô - chữ ký không chứa nội dung người dùng", () => {
    const ck = chuKyLenhGoi("web_fetch", { url: "https://bi-mat.test/tai-lieu-rieng" });
    assert.ok(!ck.includes("bi-mat"), `chữ ký lộ tham số: ${ck}`);
    assert.ok(!ck.includes("tai-lieu-rieng"));
  });

  it("tham số rỗng / undefined / không phải object không làm vỡ", () => {
    assert.equal(chuKyLenhGoi("t", undefined), chuKyLenhGoi("t", {}));
    assert.ok(chuKyLenhGoi("t", "chuoi").length > 0);
    assert.ok(chuKyLenhGoi("t", 123).length > 0);
    assert.ok(chuKyLenhGoi("t", null).length > 0);
  });
});

describe("ToolLoopGuard - lỗi giống hệt", () => {
  it("4 lần lỗi giống hệt thì chưa chặn, lần 5 mới chặn", () => {
    const b = buocLoi("web_fetch", { url: "https://hong.test" });
    for (let i = 1; i <= 4; i++) {
      assert.notEqual(guard.ghiNhan(b).muc, "chan", `lần ${i} không được chặn`);
      assert.equal(guard.daChan(), false);
    }
    const q = guard.ghiNhan(b);
    assert.equal(q.muc, "chan");
    assert.equal(q.ma, "loi-giong-het");
    assert.equal(q.soLan, 5);
    assert.equal(guard.daChan(), true);
  });

  it("cảnh báo từ lần thứ 2, trước khi chặn", () => {
    const b = buocLoi("web_fetch", { url: "x" });
    assert.equal(guard.ghiNhan(b).muc, "cho-qua", "lần đầu lỗi là chuyện thường");
    assert.equal(guard.ghiNhan(b).muc, "canh-bao");
  });

  it("quyết định chặn là DÍNH - step sau vẫn báo đã chặn", () => {
    const b = buocLoi("web_fetch", { url: "x" });
    for (let i = 0; i < 5; i++) guard.ghiNhan(b);
    assert.equal(guard.daChan(), true);
    guard.ghiNhan(buocXong("get_datetime", {}, "ok"));
    assert.equal(guard.daChan(), true, "một step thành công không gỡ được lệnh chặn");
  });

  it("lỗi với THAM SỐ KHÁC nhau không dồn vào bộ đếm giống hệt", () => {
    for (let i = 0; i < 5; i++) {
      guard.ghiNhan(buocLoi("web_fetch", { url: `https://khac-${i}.test` }));
    }
    const ly = guard.lyDoChan();
    assert.notEqual(ly?.ma, "loi-giong-het", "5 URL khác nhau không phải lặp y hệt");
  });
});

describe("ToolLoopGuard - cùng tool lỗi nhiều lần", () => {
  it("8 lần lỗi cùng tool khác tham số thì chặn", () => {
    for (let i = 1; i <= 7; i++) {
      guard.ghiNhan(buocLoi("web_fetch", { url: `https://k${i}.test` }));
    }
    assert.equal(guard.daChan(), false, "7 lần chưa chặn");
    const q = guard.ghiNhan(buocLoi("web_fetch", { url: "https://k8.test" }));
    assert.equal(q.muc, "chan");
    assert.equal(q.ma, "cung-tool-loi");
  });

  it("hai tool khác nhau đếm riêng, không cộng dồn", () => {
    for (let i = 0; i < 7; i++) {
      guard.ghiNhan(buocLoi("web_fetch", { url: `a${i}` }));
      guard.ghiNhan(buocLoi("web_search", { q: `b${i}` }));
    }
    assert.equal(guard.daChan(), false, "mỗi tool mới 7 lần, chưa tool nào chạm 8");
  });
});

describe("ToolLoopGuard - tool đọc không tiến triển", () => {
  it("tool ĐỌC trả cùng kết quả 5 lần thì chặn", () => {
    const b = buocXong("web_search", { q: "giá vàng" }, "kết quả y hệt");
    for (let i = 1; i <= 4; i++) assert.notEqual(guard.ghiNhan(b).muc, "chan");
    const q = guard.ghiNhan(b);
    assert.equal(q.muc, "chan");
    assert.equal(q.ma, "khong-tien-trien");
  });

  it("tool GHI trả cùng kết quả 5 lần thì KHÔNG chặn - ghi lặp là hợp lệ", () => {
    const b = buocXong("send_file", { path: "a.pdf" }, "đã gửi");
    for (let i = 0; i < 6; i++) guard.ghiNhan(b);
    assert.equal(guard.daChan(), false, "gửi 2 file giống nhau là chuyện bình thường");
  });

  it("kết quả ĐỔI thì đếm về 1, không tích lũy", () => {
    const args = { q: "tin mới" };
    for (let i = 0; i < 4; i++) guard.ghiNhan(buocXong("web_search", args, "kết quả cũ"));
    guard.ghiNhan(buocXong("web_search", args, "KẾT QUẢ MỚI"));
    assert.equal(guard.daChan(), false, "có tiến triển thì đếm phải reset");
    for (let i = 0; i < 3; i++) guard.ghiNhan(buocXong("web_search", args, "KẾT QUẢ MỚI"));
    assert.equal(guard.daChan(), false, "mới 4 lần với kết quả mới");
  });

  it("cùng tool nhưng tham số khác thì đếm riêng", () => {
    for (let i = 0; i < 4; i++) guard.ghiNhan(buocXong("web_search", { q: "a" }, "kq"));
    for (let i = 0; i < 4; i++) guard.ghiNhan(buocXong("web_search", { q: "b" }, "kq"));
    assert.equal(guard.daChan(), false);
  });
});

describe("ToolLoopGuard - nguồn dữ liệu và vòng đời", () => {
  it("lỗi nằm ở content[tool-error] vẫn được đếm dù toolResults RỖNG", () => {
    // Đây là ca dễ bỏ sót nhất: tool ném exception không bao giờ lọt vào
    // toolResults. Chỉ đọc toolResults thì guard mù hoàn toàn với lỗi thật.
    const b: BuocDaChay = { toolResults: [], content: [{ type: "tool-error", toolName: "web_fetch", input: { url: "x" } }] };
    for (let i = 0; i < 5; i++) guard.ghiNhan(b);
    assert.equal(guard.daChan(), true);
  });

  it("step không có tool nào không làm vỡ", () => {
    assert.equal(guard.ghiNhan({}).muc, "cho-qua");
    assert.equal(guard.ghiNhan({ content: [{ type: "text" }], toolResults: [] }).muc, "cho-qua");
  });

  it("datLai xóa sạch cả bộ đếm lẫn lệnh chặn", () => {
    const b = buocLoi("web_fetch", { url: "x" });
    for (let i = 0; i < 5; i++) guard.ghiNhan(b);
    assert.equal(guard.daChan(), true);

    guard.datLai();
    assert.equal(guard.daChan(), false);
    assert.equal(guard.lyDoChan(), null);
    assert.equal(guard.ghiNhan(b).muc, "cho-qua", "đếm phải về 0, không phải tiếp tục từ 5");
  });

  it("lượt bình thường (mỗi tool một lần, không lỗi) không bao giờ dính", () => {
    guard.ghiNhan(buocXong("get_datetime", {}, "2026-08-02"));
    guard.ghiNhan(buocXong("web_search", { q: "giá vàng" }, "kq A"));
    guard.ghiNhan(buocXong("web_fetch", { url: "https://a.test" }, "nội dung A"));
    guard.ghiNhan(buocXong("web_fetch", { url: "https://b.test" }, "nội dung B"));
    assert.equal(guard.daChan(), false);
  });

  it("một step có NHIỀU tool thì trả quyết định nghiêm trọng nhất", () => {
    const g = new ToolLoopGuard({ ...NGUONG, chanLoiGiongHet: 1 }, laToolChiDoc);
    const q = g.ghiNhan({
      content: [{ type: "tool-error", toolName: "web_fetch", input: { url: "x" } }],
      toolResults: [{ toolName: "get_datetime", input: {}, output: "ok" }],
    });
    assert.equal(q.muc, "chan");
  });
});

describe("canhBaoTu", () => {
  it("bằng nửa ngưỡng chặn", () => {
    assert.equal(canhBaoTu(8), 4);
    assert.equal(canhBaoTu(5), 2);
  });

  it("không bao giờ nhỏ hơn 2 - lỗi MỘT lần chưa phải vòng lặp", () => {
    assert.equal(canhBaoTu(1), 2);
    assert.equal(canhBaoTu(2), 2);
    assert.equal(canhBaoTu(3), 2);
  });
});

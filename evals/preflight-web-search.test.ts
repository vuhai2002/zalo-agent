import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EvalCase } from "./eval-case-type.js";
import { canTraCuuWeb, kiemTraTienDeTraCuu } from "./preflight-web-search.js";

/**
 * Bộ kiểm tra tiền đề sinh ra từ một giờ đi lạc ngày 06/08/2026: DuckDuckGo trả
 * 0 kết quả, case nghiên cứu đỏ với lý do "không gọi web_fetch", và suýt kết
 * luận nhầm rằng luật persona vừa sửa làm model tệ đi.
 */

function caseVoi(mongDoi: EvalCase["mongDoi"]): EvalCase {
  return { ten: "x", lyDo: "x", tinNhan: "x", mongDoi };
}

describe("canTraCuuWeb", () => {
  it("nhận ra case phụ thuộc tra cứu qua goiTool", () => {
    assert.equal(canTraCuuWeb(caseVoi({ goiTool: ["web_search"] })), true);
    assert.equal(canTraCuuWeb(caseVoi({ goiTool: ["web_fetch"] })), true);
  });

  it("nhận ra cả khi chỉ khai ở goiToolItNhat - bỏ sót là tiền đề không chạy", () => {
    assert.equal(canTraCuuWeb(caseVoi({ goiToolItNhat: { web_fetch: 2 } })), true);
  });

  it("case KHÔNG dùng tra cứu thì không bắt chờ tiền đề", () => {
    assert.equal(canTraCuuWeb(caseVoi({ goiTool: ["get_datetime"] })), false);
    assert.equal(canTraCuuWeb(caseVoi({ khongGoiTool: ["web_search"] })), false);
  });
});

describe("kiemTraTienDeTraCuu", () => {
  it("có kết quả thì cho chạy tiếp", async () => {
    const r = await kiemTraTienDeTraCuu(async () => 5, "brave");
    assert.equal(r.ok, true);
  });

  it("MỘT truy vấn rỗng chưa đủ kết luận - truy vấn xấu là chuyện thường", async () => {
    let lan = 0;
    const r = await kiemTraTienDeTraCuu(async () => (++lan === 1 ? 0 : 3), "brave");
    assert.equal(r.ok, true, "một lần rỗng mà đã dừng cả bộ eval là quá tay");
  });

  it("MỌI truy vấn rỗng -> dừng, và câu lỗi phải chỉ đúng bệnh", async () => {
    const r = await kiemTraTienDeTraCuu(async () => 0, "duckduckgo");
    assert.equal(r.ok, false);
    const loi = r.ok ? "" : r.loi;
    assert.match(loi, /duckduckgo/, "phải nói rõ nhà cung cấp nào đang hỏng");
    assert.match(loi, /web_fetch/, "phải cảnh báo trước cái chẩn đoán sai mà người đọc sắp mắc");
  });

  it("hàm tìm kiếm NÉM cũng tính là rỗng - lỗi mạng không được làm sập cả runner", async () => {
    const r = await kiemTraTienDeTraCuu(async () => {
      throw new Error("ECONNRESET");
    }, "brave");
    assert.equal(r.ok, false);
  });
});

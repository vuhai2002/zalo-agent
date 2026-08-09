import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
// Module THUẦN (không đụng env/DB) - import tĩnh an toàn, không cần chờ setupTestEnv()
import { catThanhDoan } from "./chunk-text.js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Test chất lượng tra cứu phase 04 đi qua ĐƯỜNG NẠP THẬT (`catThanhDoan` ->
 * `luuDoan`, đúng cách `kb-ingest-worker.ts` làm với nguồn `loai: "text"`) -
 * TÁCH RIÊNG khỏi `kb-search.test.ts` (vòng rà soát lần 2, băn khoăn 2): hai
 * describe block I1/I3 mới đẩy file gốc từ 143 lên 228 dòng, vượt trần 200.
 * `napNguon` (fixture tắt, KHÔNG qua `catThanhDoan`) ở lại `kb-search.test.ts`;
 * `napQuaWorker` (đường thật) chuyển hẳn sang đây.
 */

let dataDir: string;
let store: typeof import("./kb-source-store.js");
let chunkStore: typeof import("./kb-chunk-store.js");
let binding: typeof import("./kb-agent-binding.js");
let search: typeof import("./kb-search.js");
let database: typeof import("../conversation/database.js");

const AGENT = "agent-a";

before(async () => {
  dataDir = setupTestEnv();
  store = await import("./kb-source-store.js");
  chunkStore = await import("./kb-chunk-store.js");
  binding = await import("./kb-agent-binding.js");
  search = await import("./kb-search.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  for (const t of ["kb_sources", "kb_chunks", "kb_chunks_fts", "agent_kb_sources"]) {
    database.db.exec(`DELETE FROM ${t}`);
  }
});

const THAM_SO_CAT_MAC_DINH = { coDoanToiDa: 2000, chongLan: 0 };

/**
 * Nạp qua ĐÚNG đường nạp THẬT (`catThanhDoan` -> `luuDoan`, đúng cách
 * `kb-ingest-worker.ts` làm với nguồn `loai: "text"`) - KHÔNG dựng fixture
 * bằng `luuDoan` trực tiếp. Đường nối phase 02 <-> phase 03 (chunk-text.ts ->
 * kb-chunk-store.ts) chưa có test nào phủ trước phase này, và đó là lý do I1
 * (tra đúng TÊN TÀI LIỆU ra rỗng) lọt qua hai vòng rà soát trước - test dựng
 * fixture tắt bằng `luuDoan({tieuDe: "", ...})` không bao giờ chạm nhánh
 * heading của `catThanhDoan`.
 */
function napQuaWorker(ten: string, chu: string): { id: string } {
  const nguon = store.taoNguon({ ten, loai: "text", noiDungGoc: chu });
  const doan = catThanhDoan(chu, THAM_SO_CAT_MAC_DINH);
  chunkStore.luuDoan(nguon.id, doan, nguon.ten);
  binding.datNguonChoAgent(AGENT, [...binding.nguonCuaAgent(AGENT), nguon.id]);
  return nguon;
}

describe("timTrongKhoTriThuc - tra bằng TÊN TÀI LIỆU/TÊN NGUỒN (I1, qua đường nạp THẬT)", () => {
  it("tra bằng chính tiêu đề H1 của tài liệu ra đúng đoạn", () => {
    // Ca đã đo hỏng: H1 không có thân bài ngay dưới nên bị bỏ qua, và
    // `tieuDeHienTai` bị H2 ghi đè trước khi kịp có đoạn nào chốt dưới H1 -
    // "chính sách đổi trả" (tên tài liệu) tra ra 0 dòng dù nội dung đúng nằm
    // trong kho.
    //
    // Tên NGUỒN cố tình KHÔNG chứa chữ nào của câu hỏi ("Tài liệu vận hành" -
    // không "chính", "sách", "đổi", hay "trả") - tự bắt được lúc chạy phép phá
    // #1: fixture đầu dùng tên nguồn "Chính sách" (trùng 2 từ với câu hỏi) làm
    // test XANH GIẢ khi breadcrumb bị sabotage, vì phang vẫn khớp qua tenNguon
    // chứ không qua breadcrumb đang được kiểm.
    napQuaWorker(
      "Tài liệu vận hành",
      "# Chính sách đổi trả\n\n## Điều kiện\n\nHàng còn nguyên tem.\n\n## Thời hạn\n\nTrong vòng 7 ngày.",
    );
    const kq = search.timTrongKhoTriThuc({ cauHoi: "chính sách đổi trả", agentId: AGENT });
    assert.ok(kq.length > 0, "tra đúng tên tài liệu (H1) mà ra rỗng");
    assert.match(
      kq[0]!.tieuDe,
      /Chính sách đổi trả/,
      `breadcrumb phải mang tên tài liệu (H1), thực tế: "${kq[0]!.tieuDe}"`,
    );
  });

  it("tra bằng TÊN NGUỒN ra đúng đoạn", () => {
    napQuaWorker("Bảng giá quán", "Cà phê 25.000đ.");
    const kq = search.timTrongKhoTriThuc({ cauHoi: "bảng giá quán", agentId: AGENT });
    assert.ok(kq.length > 0, "tra đúng tên nguồn mà ra rỗng");
  });
});

describe("timTrongKhoTriThuc - khử trùng nội dung (I3)", () => {
  it("hai nguồn nội dung y hệt chỉ chiếm MỘT slot", () => {
    const nguonA = napQuaWorker("Nguồn A", "Cà phê 25.000đ.");
    const nguonB = napQuaWorker("Nguồn B", "Cà phê 25.000đ.");
    const kq = search.timTrongKhoTriThuc({ cauHoi: "cà phê", agentId: AGENT, soLuong: 5 });
    assert.equal(kq.length, 1, `phải khử còn 1, ra: ${JSON.stringify(kq.map((x) => x.sourceId))}`);
    assert.ok(
      kq[0]!.sourceId === nguonA.id || kq[0]!.sourceId === nguonB.id,
      "đoạn còn lại phải là bản của A hoặc B (giữ bản xếp hạng cao nhất, không phải bản khác)",
    );
  });

  it("khử trùng KHÔNG làm thiếu: vẫn đủ soLuong đoạn khác nhau", () => {
    // `timTheoTuKhoa` LIMIT đúng trong SQL nên khử SAU đó sẽ THIẾU nếu không
    // lấy dư trước (đúng lỗi gốc) - 2 đoạn trùng + 5 đoạn khác nhau, xin 5, kỳ
    // vọng đủ 5 (khử 1 đoạn trùng rồi lấy bù đoạn thứ 6 đang xếp hạng thấp hơn
    // nhưng còn tồn tại, KHÔNG dừng lại ở 4).
    napQuaWorker("Nguồn A", "Cà phê 25.000đ.");
    napQuaWorker("Nguồn B", "Cà phê 25.000đ.");
    for (let i = 0; i < 5; i++) napQuaWorker(`Khác ${i}`, `Cà phê loại ${i} giá ${i}0.000đ.`);
    const kq = search.timTrongKhoTriThuc({ cauHoi: "cà phê", agentId: AGENT, soLuong: 5 });
    assert.equal(kq.length, 5, `khử trùng xong bị hụt: ${JSON.stringify(kq.map((x) => x.noiDung))}`);
  });

  it("nội dung KHÁC nhau (dù tương tự) không bị khử oan", () => {
    napQuaWorker("Nguồn A", "Cà phê 25.000đ.");
    napQuaWorker("Nguồn B", "Cà phê 30.000đ.");
    const kq = search.timTrongKhoTriThuc({ cauHoi: "cà phê", agentId: AGENT, soLuong: 5 });
    assert.equal(kq.length, 2, "hai đoạn giá khác nhau bị khử nhầm thành một");
  });
});

describe("timTrongKhoTriThuc - một tài liệu lớn không chiếm trọn slot của câu hỏi chung chung (Important c, vòng rà soát lần 2)", () => {
  it("tài liệu nhiều mục (breadcrumb+tên nguồn lặp lại mỗi đoạn) không đẩy hết tài liệu khác ra khỏi top-k", () => {
    // Tài liệu LỚN: 6 mục, mỗi mục đều chứa từ "chính sách" (qua breadcrumb
    // "Sổ tay vận hành cửa hàng > <mục>") - nếu phang lặp tên nguồn+breadcrumb
    // trên MỌI đoạn làm bm25 lệch hẳn về tài liệu này, top-k có thể bị nó
    // chiếm trọn dù câu hỏi không nhắm riêng tài liệu nào.
    const tieuDeLon = "Sổ tay vận hành cửa hàng";
    const noiDungLon =
      `# ${tieuDeLon}\n\n` +
      "## Chính sách mở cửa\n\nMở cửa 8h, đóng cửa 21h các ngày trong tuần.\n\n" +
      "## Chính sách nhân sự\n\nCa làm việc chia 2 ca sáng chiều, nghỉ luân phiên.\n\n" +
      "## Chính sách kho\n\nKiểm kho mỗi tuần một lần vào sáng thứ Hai.\n\n" +
      "## Chính sách vệ sinh\n\nDọn dẹp quầy kệ cuối mỗi ca làm việc.\n\n" +
      "## Chính sách an toàn\n\nKiểm tra bình cứu hỏa mỗi tháng một lần.\n\n" +
      "## Chính sách đào tạo\n\nNhân viên mới được đào tạo trong 3 ngày đầu.";
    napQuaWorker(tieuDeLon, noiDungLon);

    // 3 tài liệu NHỎ, riêng biệt - đúng chủ đề câu hỏi sẽ tra ("bảo hành").
    napQuaWorker("Chính sách bảo hành A", "Bảo hành 12 tháng cho sản phẩm điện tử.");
    napQuaWorker("Chính sách bảo hành B", "Bảo hành 24 tháng cho đồ gia dụng.");
    napQuaWorker("Chính sách bảo hành C", "Bảo hành 6 tháng cho phụ kiện.");

    const kq = search.timTrongKhoTriThuc({ cauHoi: "chính sách bảo hành", agentId: AGENT, soLuong: 5 });
    const soNguonKhacNhau = new Set(kq.map((x) => x.sourceId)).size;
    // Ghi số THẬT - không tự chỉnh ngưỡng để test luôn xanh. Đây là bằng
    // chứng đo được: xem report task-4 mục "Important c" để biết số liệu này
    // đã được đối chiếu bằng tay lúc viết test, không phải suy luận.
    assert.ok(
      soNguonKhacNhau >= 2,
      `tài liệu lớn (6 mục, breadcrumb đều chứa "chính sách") có dấu hiệu CHIẾM TRỌN top-k - chỉ còn ${soNguonKhacNhau} nguồn khác nhau trong ${kq.length} kết quả: ${JSON.stringify(kq.map((x) => ({ nguon: x.tenNguon, tieuDe: x.tieuDe, diem: x.diem })))}`,
    );
  });
});

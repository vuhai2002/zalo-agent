import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
// Module THUẦN (không đụng env/DB) - import tĩnh an toàn, không cần chờ setupTestEnv()
import { catThanhDoan } from "./chunk-text.js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let store: typeof import("./kb-source-store.js");
let chunkStore: typeof import("./kb-chunk-store.js");
let binding: typeof import("./kb-agent-binding.js");
let search: typeof import("./kb-search.js");
let database: typeof import("../conversation/database.js");

const AGENT = "agent-a";

// Fixture: 4 đoạn kiểu tài liệu chăm sóc khách hàng thật.
const TAI_LIEU = [
  "# Phí vận chuyển\n\nNội thành 20.000 đồng, ngoại thành 35.000 đồng. Đơn trên 500.000 đồng được miễn phí ship.",
  "# Bảo hành\n\nBảo hành 12 tháng cho mọi sản phẩm. Đổi mới trong 30 ngày đầu nếu lỗi nhà sản xuất.",
  "# Chính sách đổi trả\n\nĐổi trả trong vòng 7 ngày kể từ ngày nhận hàng, sản phẩm còn nguyên tem.",
  "# Giờ làm việc\n\nCửa hàng mở cửa 8h00, đóng cửa 21h00 tất cả các ngày trong tuần.",
];

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

/** Nạp 1 nguồn, mỗi dòng của `noiDungs` thành một đoạn riêng, rồi gán cho agent-a */
function napNguon(ten: string, noiDungs: string[]): { id: string } {
  const nguon = store.taoNguon({ ten, loai: "text", noiDungGoc: noiDungs.join("\n\n") });
  chunkStore.luuDoan(
    nguon.id,
    noiDungs.map((noiDung, thuTu) => ({ thuTu, tieuDe: "", noiDung })),
  );
  return nguon;
}

const THAM_SO_CAT_MAC_DINH = { coDoanToiDa: 2000, chongLan: 0 };

/**
 * Nạp qua ĐÚNG đường nạp THẬT (`catThanhDoan` -> `luuDoan`, đúng cách
 * `kb-ingest-worker.ts` làm với nguồn `loai: "text"`) - KHÔNG dựng fixture
 * bằng `luuDoan` trực tiếp như `napNguon` ở trên. Đường nối phase 02 <-> phase
 * 03 (chunk-text.ts -> kb-chunk-store.ts) chưa có test nào phủ trước phase
 * này, và đó là lý do I1 (tra đúng TÊN TÀI LIỆU ra rỗng) lọt qua hai vòng rà
 * soát trước - test dựng fixture tắt bằng `luuDoan({tieuDe: "", ...})` không
 * bao giờ chạm nhánh heading của `catThanhDoan`.
 */
function napQuaWorker(ten: string, chu: string): { id: string } {
  const nguon = store.taoNguon({ ten, loai: "text", noiDungGoc: chu });
  const doan = catThanhDoan(chu, THAM_SO_CAT_MAC_DINH);
  chunkStore.luuDoan(nguon.id, doan, nguon.ten);
  binding.datNguonChoAgent(AGENT, [...binding.nguonCuaAgent(AGENT), nguon.id]);
  return nguon;
}

describe("timTrongKhoTriThuc - bm25 trên dữ liệu tiếng Việt thật", () => {
  beforeEach(() => {
    const nguon = napNguon("chăm sóc khách hàng", TAI_LIEU);
    binding.datNguonChoAgent(AGENT, [nguon.id]);
  });

  it("ba câu hỏi kiểu khách hàng ra đúng đoạn ở hạng 1", () => {
    for (const [cau, mong] of [
      ["phi ship noi thanh bao nhieu", "vận chuyển"],
      ["bảo hành bao lâu vậy shop", "Bảo hành"],
      ["đổi trả được không", "đổi trả"],
    ] as const) {
      const kq = search.timTrongKhoTriThuc({ cauHoi: cau, agentId: AGENT, soLuong: 1 });
      assert.match(kq[0]!.noiDung, new RegExp(mong), `câu "${cau}"`);
    }
  });

  it("câu hỏi giờ mở cửa cũng ra đúng đoạn ở hạng 1 (đã đo, không phải suy luận)", () => {
    // Cả 4 câu hỏi mẫu đều ra đúng hạng 1 trên fixture này. Va chạm "đồng"
    // (tiền) và "đóng" (cửa) cùng bỏ dấu thành "dong" là rủi ro CÓ THẬT của
    // tìm theo từ khóa - đoạn "Phí vận chuyển" khớp "dong" tới 3 lần - nhưng
    // fixture này không kích hoạt nó: đoạn "Giờ làm việc" khớp BA từ khác
    // nhau (gio, dong, cua - riêng "cua" đã xuất hiện 3 lần: "Cửa hàng", "mở
    // cửa", "đóng cửa"), còn đoạn "Phí vận chuyển" chỉ khớp DUY NHẤT một từ
    // ("dong") dù lặp lại nhiều lần. bm25 cộng điểm theo TỪNG từ khác nhau
    // (mỗi từ một trọng số IDF riêng) nên khớp đa dạng thắng khớp lặp cùng
    // một từ. soLuong giữ ở 2 để nếu thứ hạng có tụt lại (đổi fixture, đổi
    // dữ liệu), thông báo lỗi in ra cả 2 đoạn top, dễ dò nguyên nhân.
    const kq = search.timTrongKhoTriThuc({ cauHoi: "mấy giờ đóng cửa", agentId: AGENT, soLuong: 2 });
    assert.match(
      kq[0]!.noiDung,
      /Giờ làm việc/,
      `top 2 thực tế: ${kq.map((x) => JSON.stringify(x.noiDung.slice(0, 30))).join(" | ")}`,
    );
  });

  it("câu hỏi chỉ có từ mang chữ 'đ' vẫn ra đúng đoạn - chứng minh boDauTiengViet có tác dụng thật", () => {
    // "đ" (U+0111) là MỘT CHỮ CÁI riêng có gạch ngang, không phải chữ nền cộng
    // dấu phụ tổ hợp - unicode61 tự gấp được dấu thanh/mũ/móc (à, ả, ộ, ...)
    // nhưng KHÔNG tự gấp được "đ" thành "d" (xem kb-schema.ts). Cột `phang`
    // ghi "doi" (đã bỏ dấu từ lúc lưu), nên câu hỏi PHẢI đi qua boDauTiengViet
    // thì "đổi" mới thành "doi" mà khớp được.
    //
    // Chỉ dùng "đổi" MỘT MÌNH (không kèm "trả"): "đổi trả" sẽ vẫn ra đúng đoạn
    // dù bỏ boDauTiengViet, vì "trả" tự nó bỏ được dấu qua unicode61 ("ả" là
    // dấu tổ hợp thật) và không đoạn nào khác trong fixture có từ "tra" - một
    // mình "trả" đã đủ cứu kết quả, che mất lỗ hổng thật của "đ". Đã đo bằng
    // sabotage thật trước khi viết test này (xem report task-3).
    const kq = search.timTrongKhoTriThuc({ cauHoi: "đổi", agentId: AGENT, soLuong: 1 });
    assert.match(kq[0]!.noiDung, /Chính sách đổi trả/, "câu hỏi 'đổi' một mình");
  });
});

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

describe("timTrongKhoTriThuc - cách ly theo nguồn", () => {
  it("chỉ tìm trong nguồn ĐÃ BẬT cho agent đó", () => {
    const nguonA = napNguon("nguồn A", ["Bảo hành 12 tháng cho mọi sản phẩm."]);
    const nguonB = napNguon("nguồn B", ["Bảo hành 24 tháng cho sản phẩm cao cấp."]);
    binding.datNguonChoAgent("agent-a", [nguonA.id]);
    binding.datNguonChoAgent("agent-b", [nguonB.id]);

    const kq = search.timTrongKhoTriThuc({ cauHoi: "bảo hành", agentId: "agent-a" });
    assert.ok(
      kq.every((x) => x.sourceId === nguonA.id),
      "rò nguồn của agent khác",
    );
  });

  it("agent chưa gán nguồn nào thì trả RỖNG, không phải trả tất cả", () => {
    napNguon("nguồn A", ["Bảo hành 12 tháng cho mọi sản phẩm."]);
    assert.deepEqual(search.timTrongKhoTriThuc({ cauHoi: "bảo hành", agentId: "agent-chua-gan" }), []);
  });

  it("lọc nguồn nằm TRONG SQL, không lọc sau khi lấy top", () => {
    // Dựng 30 đoạn NGẮN, khớp gần như tuyệt đối (bm25 ưu tiên đoạn ngắn hơn) ở
    // nguồn KHÔNG được bật, cộng 1 đoạn khớp nhưng DÀI HƠN ở nguồn ĐƯỢC bật.
    // 30 đoạn nhiễu luôn thắng bm25 nên chiếm trọn top-5 - lọc sau khi lấy
    // top-5 thì đoạn đúng (dài hơn, bm25 thấp hơn) bị đẩy ra ngoài hẳn.
    const nguonNhieu = napNguon(
      "nguồn nhiễu",
      Array.from({ length: 30 }, () => "Bảo hành."),
    );
    const nguonDung = napNguon("nguồn đúng", [
      "Bảo hành 12 tháng cho mọi sản phẩm, đổi mới trong 30 ngày đầu nếu lỗi nhà sản xuất.",
    ]);
    binding.datNguonChoAgent(AGENT, [nguonDung.id]);
    void nguonNhieu;

    const kq = search.timTrongKhoTriThuc({ cauHoi: "bảo hành", agentId: AGENT, soLuong: 5 });
    assert.equal(kq.length, 1);
    assert.equal(kq[0]!.sourceId, nguonDung.id);
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

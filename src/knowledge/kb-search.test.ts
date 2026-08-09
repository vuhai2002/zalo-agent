import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

// Test I1 (breadcrumb/tên nguồn) và I3 (khử trùng) - dùng đường nạp THẬT
// (`catThanhDoan` -> `luuDoan`) - đã CHUYỂN sang `kb-search-quality.test.ts`
// (vòng rà soát lần 2, băn khoăn 2): hai describe block đó đẩy file này vượt
// trần 200 dòng. File này chỉ còn fixture "tắt" (`napNguon`, không qua
// `catThanhDoan`) từ trước phase 04.

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

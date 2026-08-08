import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
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

  it("MỐC ĐÃ BIẾT: câu hỏi giờ mở cửa chỉ vào được top 2, không chắc hạng 1", () => {
    // "đồng" (tiền) và "đóng" bỏ dấu đều ra "dong" nên đoạn phí ship chen lên
    // trên. Đây là điểm mù cố hữu của tìm theo từ khóa và là lý do đợt sau thêm
    // lớp vector. Khẳng định để LỎNG ở top 2 vì thứ hạng chính xác phụ thuộc
    // fixture; chạy thật thấy nó ổn định ở hạng 1 thì siết lại khẳng định.
    const kq = search.timTrongKhoTriThuc({ cauHoi: "mấy giờ đóng cửa", agentId: AGENT, soLuong: 2 });
    assert.ok(kq.some((x) => /Giờ làm việc/.test(x.noiDung)), "vẫn phải nằm trong top 2");
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

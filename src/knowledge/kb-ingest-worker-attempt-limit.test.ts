import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Tách riêng khỏi kb-ingest-worker.test.ts (đủ dài để tách - file kia đã gần
 * trần 200 dòng): ca "nguồn làm worker kẹt lặp lại" đi qua bộ tuning riêng
 * (KB_MAX_INGEST_ATTEMPTS) và mô phỏng "kẹt ở dang_xu_ly" bằng CÙNG kỹ thuật
 * mà test "nguồn kẹt ở dang_xu_ly từ lần chạy trước..." (kb-ingest-worker.test.ts)
 * đã dùng - đặt thẳng trang_thai='dang_xu_ly' rồi gọi goNguonKetLucKhoiDong(),
 * KHÔNG đợi một lần trích xuất thật sự quá hạn.
 *
 * Lý do KHÔNG dựng test bằng một file thật sự quá hạn qua worker.xuLyMotVong():
 * đã ĐO (script trong báo cáo phase này) - nội dung trong giới hạn hợp lệ của
 * ooxml-limits.ts xử lý nhanh hơn hẳn KB_EXTRACT_TIMEOUT_MS (trần env.ts đặt
 * TỐI THIỂU 5000ms): docx gần trần ký tự trích ra (8 MB) chỉ mất ~0,8-1,3s;
 * getTuning() còn tự CHẶN mọi giá trị dưới 5000ms (rơi về mặc định 60000ms) -
 * không có cách nào set nhỏ hơn qua tuning để làm test nhanh, và không có nội
 * dung hợp lệ nào (trong mọi trần đã đo) chạm nổi 5 giây thật. Đây CHÍNH LÀ
 * bằng chứng các trần ooxml-limits.ts (phase 01) hoạt động đúng - không phải
 * chỗ hổng của test.
 *
 * `trichXuatTachLuong` reject đúng loại lỗi khi quá hạn được test TRỰC TIẾP,
 * NHANH, không qua tuning, ở chay-trich-xuat-tach-luong.test.ts (bỏ qua trần
 * 5000ms bằng cách gọi thẳng hàm với `hanMs: 300`) - đó là test "quan trọng
 * nhất" của phase, xác nhận cơ chế `worker.terminate()` THẬT SỰ hoạt động.
 * Test ở FILE NÀY xác nhận phần còn lại: bộ đếm + cổng `goNguonKetLucKhoiDong`
 * quyết định đúng "thử tiếp hay bỏ hẳn" dựa trên `so_lan_thu`.
 */

let dataDir: string;
let store: typeof import("./kb-source-store.js");
let queries: typeof import("./kb-source-queries.js");
let worker: typeof import("./kb-ingest-worker.js");
let database: typeof import("../conversation/database.js");
let tuning: typeof import("../config/runtime-tuning-settings.js");

before(async () => {
  dataDir = setupTestEnv();
  store = await import("./kb-source-store.js");
  queries = await import("./kb-source-queries.js");
  worker = await import("./kb-ingest-worker.js");
  database = await import("../conversation/database.js");
  tuning = await import("../config/runtime-tuning-settings.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  for (const t of ["kb_sources", "kb_chunks", "kb_chunks_fts", "agent_kb_sources"]) {
    database.db.exec(`DELETE FROM ${t}`);
  }
  tuning.setTuning("KB_MAX_INGEST_ATTEMPTS", null);
});

describe("nguồn kẹt lặp lại ở dang_xu_ly - bị bỏ hẳn sau đúng KB_MAX_INGEST_ATTEMPTS lần (C3)", () => {
  it("bị đánh hong sau đúng KB_MAX_INGEST_ATTEMPTS lần, không thử vô hạn qua các lần khởi động lại", () => {
    tuning.setTuning("KB_MAX_INGEST_ATTEMPTS", 2);
    const n = store.taoNguon({ ten: "kẹt lặp lại", loai: "text", noiDungGoc: "abc" });

    // Lần 1: giành (so_lan_thu 0 -> 1) - đây là ĐÚNG câu UPDATE thật
    // (giaNguonChoXuLy), không phải giả lập tay. Nguồn đứng ở dang_xu_ly y hệt
    // hậu quả của LoiTrichXuatBiNgatGiuaChung (worker bị buộc dừng - xem catch
    // trong kb-ingest-worker.ts: KHÔNG gọi datTrangThai gì thêm).
    assert.equal(queries.giaNguonChoXuLy(n.id, tuning.getTuning("KB_MAX_INGEST_ATTEMPTS")), true);
    assert.equal(store.layNguon(n.id)!.trangThai, "dang_xu_ly");

    // "Khởi động lại": so_lan_thu(1) < trần(2) -> trả về cho_xu_ly để thử tiếp
    worker.goNguonKetLucKhoiDong();
    assert.equal(store.layNguon(n.id)!.trangThai, "cho_xu_ly");

    // Lần 2 (lần thử CUỐI CÙNG được phép): giành lại (so_lan_thu 1 -> 2)
    assert.equal(queries.giaNguonChoXuLy(n.id, tuning.getTuning("KB_MAX_INGEST_ATTEMPTS")), true);
    assert.equal(store.layNguon(n.id)!.trangThai, "dang_xu_ly");

    // "Khởi động lại" lần 2: so_lan_thu(2) >= trần(2) -> bỏ hẳn, đánh hong
    worker.goNguonKetLucKhoiDong();

    const sau = store.layNguon(n.id)!;
    assert.equal(sau.trangThai, "hong");
    assert.equal(sau.soLanThu, 2);
    assert.match(sau.loi, /đã thử 2 lần/i);

    // Lần 3: nguồn đã "hong" nên KHÔNG còn ở cho_xu_ly - giành sẽ thất bại,
    // đếm không tăng thêm, không thử vô hạn.
    assert.equal(queries.giaNguonChoXuLy(n.id, tuning.getTuning("KB_MAX_INGEST_ATTEMPTS")), false, "lần 3 KHÔNG được giành nữa");
    assert.equal(store.layNguon(n.id)!.soLanThu, 2, "đếm không được tăng thêm");
  });

  it("trần khác nhau (KB_MAX_INGEST_ATTEMPTS=4) thì phải đủ 4 lần mới bỏ hẳn, không chốt cứng số 2", () => {
    // Chốt BẤT BIẾN "đúng bằng trần đang cấu hình", không chốt cứng "đúng 2" -
    // nếu cài đặt lỡ hardcode số 2 ở đâu đó thay vì đọc tuning thì test NÀY lật.
    tuning.setTuning("KB_MAX_INGEST_ATTEMPTS", 4);
    const n = store.taoNguon({ ten: "trần 4", loai: "text", noiDungGoc: "abc" });

    for (let lan = 1; lan <= 3; lan++) {
      assert.equal(queries.giaNguonChoXuLy(n.id, tuning.getTuning("KB_MAX_INGEST_ATTEMPTS")), true, `lần ${lan} phải giành được`);
      worker.goNguonKetLucKhoiDong();
      assert.equal(store.layNguon(n.id)!.trangThai, "cho_xu_ly", `sau lần ${lan}/4 phải còn cho_xu_ly, chưa tới trần`);
    }

    assert.equal(queries.giaNguonChoXuLy(n.id, tuning.getTuning("KB_MAX_INGEST_ATTEMPTS")), true, "lần 4 phải giành được");
    worker.goNguonKetLucKhoiDong();
    const sau = store.layNguon(n.id)!;
    assert.equal(sau.trangThai, "hong");
    assert.equal(sau.soLanThu, 4);
  });
});

describe("goNguonKetLucKhoiDong chạy ĐỊNH KỲ mỗi tick qua chayMotVongAnToan(), không chỉ lúc boot", () => {
  // TRƯỚC bản sửa: goNguonKetLucKhoiDong() CHỈ được gọi từ batDauWorker() lúc
  // boot. Một nguồn kẹt dang_xu_ly XUẤT HIỆN SAU boot (worker bị terminate()
  // vì quá hạn NGAY TRONG một tick) không có đường tự gỡ nào khác - route
  // reindex từ chối 409 mọi nguồn dang_xu_ly, nên nguồn kẹt VĨNH VIỄN tới lúc
  // ai đó restart cả bot. Test này gọi chayMotVongAnToan() TRỰC TIẾP hai lần
  // (mô phỏng hai tick liên tiếp, KHÔNG qua batDauWorker/setInterval) để chứng
  // minh lần gọi THỨ HAI - không chỉ lần đầu tiên - cũng tự gỡ được.
  it("nguồn kẹt dang_xu_ly XUẤT HIỆN SAU tick đầu vẫn được gỡ ở tick kế tiếp, không cần restart", async () => {
    // Tick 1: không có gì kẹt - chỉ để mô phỏng "đã qua một lần chạy" (đúng
    // cách batDauWorker() gọi lần đầu tiên lúc boot).
    await worker.chayMotVongAnToan();

    // Kẹt xảy ra GIỮA hai tick - mô phỏng đúng ca thật: worker bị terminate()
    // vì quá KB_EXTRACT_TIMEOUT_MS, catch trong xuLyMotNguon để NGUYÊN
    // dang_xu_ly (không tự đặt lại gì) chờ tick sau xét lại.
    const n = store.taoNguon({ ten: "kẹt giữa hai tick", loai: "text", noiDungGoc: "# Giờ mở cửa\n\n8h - 21h" });
    assert.equal(queries.giaNguonChoXuLy(n.id, tuning.getTuning("KB_MAX_INGEST_ATTEMPTS")), true);
    assert.equal(store.layNguon(n.id)!.trangThai, "dang_xu_ly", "tiền đề: nguồn phải đang kẹt dang_xu_ly trước tick 2");

    // Tick 2 (ĐỊNH KỲ - không phải lúc boot) phải tự gỡ nguồn kẹt này. Nếu
    // goNguonKetLucKhoiDong() chỉ chạy ở batDauWorker() (bản TRƯỚC sửa) thì
    // lần gọi chayMotVongAnToan() này chỉ chạy xuLyMotVong() - hàm đó CHỈ xử
    // lý cho_xu_ly, không đụng gì tới dang_xu_ly - nguồn sẽ kẹt mãi.
    await worker.chayMotVongAnToan();

    const sau = store.layNguon(n.id)!;
    assert.notEqual(
      sau.trangThai,
      "dang_xu_ly",
      "goNguonKetLucKhoiDong() phải chạy lại ở MỖI tick (không chỉ boot) - nguồn kẹt xuất hiện SAU boot vẫn phải tự gỡ ở tick kế tiếp",
    );
    // Nội dung hợp lệ + nhanh nên cùng tick 2 luôn xử lý xong tới san_sang -
    // chốt cả bước sau, không chỉ "thoát dang_xu_ly", để không lẫn với một
    // nhánh chỉ đặt cho_xu_ly rồi bỏ dở.
    assert.equal(sau.trangThai, "san_sang");
    assert.ok(sau.soDoan > 0);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { timDoanNguyenVan } from "./khop-nguyen-van.js";

/**
 * Văn bản GIẢ cùng hình dạng ca thật trên prod (thông báo kèm câu dặn trong
 * cùng một tin): hai dấu cách cuối dòng, dòng trống, emoji, ký hiệu Zalo,
 * chữ viết tắt và lỗi chính tả. Không dùng tin thật vì repo công khai.
 */
const THONG_BAO =
  "🌻 🌻 Thông báo nhận quà sau khoá tu /-heart/-heart\n" +
  "Dạ con thưa HĐ, ban hậu cần có chuẩn bị quà để HĐ không\n" +
  " ở lại được sau khoá tu ạ\n\n" +
  "Thông tin nhận:  \n" +
  "Địa điểm: Trước cổng phụ\n" +
  "Liên hệ: Bạn A - 0900000000  \n" +
  "Chúng con cảm ơn HĐ ạ _()__()_";
const TIN = `${THONG_BAO}\n\nghi nhớ tin này. khi nào tôi hỏi thì gửi lại nhé`;

function khop(can: string, nguon: string[]) {
  const kq = timDoanNguyenVan(can, nguon);
  assert.ok(kq.ok, `phải khớp, nhận: ${JSON.stringify(kq)}`);
  return kq.doanGoc;
}

function lech(can: string, nguon: string[]) {
  const kq = timDoanNguyenVan(can, nguon);
  assert.equal(kq.ok, false, "phải từ chối");
  return kq as Extract<typeof kq, { ok: false }>;
}

describe("timDoanNguyenVan - khớp và trả ĐÚNG đoạn gốc", () => {
  it("chép đúng, bỏ câu dặn -> trả nguyên đoạn gốc, từng byte", () => {
    assert.equal(khop(THONG_BAO, ["hi", TIN, "ok"]), THONG_BAO);
  });

  it("model nuốt khoảng trắng thừa vẫn khớp, nhưng thứ LƯU là bản gốc còn nguyên hai dấu cách cuối dòng", () => {
    const modelChep = THONG_BAO.replace(/ +\n/g, "\n").replace(/\n\n/g, "\n");
    assert.notEqual(modelChep, THONG_BAO);
    const goc = khop(modelChep, [TIN]);
    assert.equal(goc, THONG_BAO);
    assert.ok(goc.includes("Thông tin nhận:  \n"));
  });

  it("đoạn trải qua HAI tin liền nhau vẫn khớp (người dùng gửi một thông báo thành hai tin)", () => {
    const [dau, cuoi] = [THONG_BAO.slice(0, 80), THONG_BAO.slice(80)];
    assert.equal(khop(THONG_BAO, [dau, cuoi]), `${dau}\n${cuoi}`);
  });

  it("chữ tổ hợp (NFD) khớp với tin gốc dựng sẵn (NFC)", () => {
    assert.equal(khop("Địa điểm: Trước cổng phụ".normalize("NFD"), [TIN]), "Địa điểm: Trước cổng phụ");
  });
});

describe("timDoanNguyenVan - rác ở đuôi và ký tự vô hình (đo trên model thật)", () => {
  // Đúng các đuôi model thật đã chèn sau "_()__()_" trong lúc chạy thử
  const DUOI_THAT = ["‌", "።", " ་", " server?", "ông()_toi pdate to functions.verbatim_note? no."];

  for (const duoi of DUOI_THAT) {
    it(`bỏ rác đuôi ${JSON.stringify(duoi)} -> lưu đúng đoạn gốc, báo phần bị bỏ và phần tin gốc còn lại`, () => {
      const kq = timDoanNguyenVan(THONG_BAO + duoi, [TIN]);
      assert.ok(kq.ok, JSON.stringify(kq));
      assert.equal(kq.doanGoc, THONG_BAO);
      if (duoi.trim().replace(/\p{Cf}/gu, "")) {
        assert.ok(kq.boDuoi, "phải báo đã bỏ đuôi");
        assert.ok(kq.boDuoi.tinGocConLai.startsWith("ghi nhớ tin này"));
      }
    });
  }

  it("gõ sai CHỮ CUỐI rồi thêm rác -> phần khớp dừng giữa dòng -> TỪ CHỐI, không lưu cụt", () => {
    lech(THONG_BAO.slice(0, -3) + "X_ server?", [TIN]);
  });

  it("bỏ sót một dòng GIỮA: phần sau là chữ thật có trong tin gốc -> TỪ CHỐI, không coi là rác", () => {
    const boDongGiua = THONG_BAO.replace("Liên hệ: Bạn A - 0900000000  \n", "");
    lech(boDongGiua, [TIN]);
  });

  it("rác dài quá trần -> từ chối", () => {
    lech(THONG_BAO + " " + "zq".repeat(40), [TIN]);
  });

  it("ký tự vô hình ở GIỮA đoạn model chép không làm lệch; ZWJ trong emoji gốc được giữ khi lưu", () => {
    const emojiGhep = "Nhà mình 👨‍👩‍👧 đủ cả ạ";
    assert.equal(khop("Nhà​ mình 👨👩👧 đủ cả ạ", [emojiGhep]), emojiGhep);
  });

  it("ký tự Tags (cặp surrogate, vô hình) chèn vào giữa vẫn bị bỏ qua", () => {
    assert.equal(khop("Địa \u{E0041}điểm: Trước cổng phụ", [TIN]), "Địa điểm: Trước cổng phụ");
  });
});

describe("timDoanNguyenVan - từ chối mọi thứ không phải nguyên văn", () => {
  it("tóm tắt (đúng lỗi đo được 4/4 lần trên model thật) -> từ chối", () => {
    lech("Thông báo: ban hậu cần chuẩn bị quà cho HĐ, nhận trước cổng phụ, liên hệ Bạn A.", [TIN]);
  });

  it("sửa lỗi chính tả 'khoá' -> 'khóa' là hết nguyên văn", () => {
    lech(THONG_BAO.replace("khoá tu /-heart", "khóa tu /-heart"), [TIN]);
  });

  it("lưu thiếu đoạn giữa -> từ chối, và chỉ đúng chỗ bắt đầu lệch", () => {
    const thieuGiua = THONG_BAO.replace("Thông tin nhận:  \n", "");
    const kq = lech(thieuGiua, [TIN]);
    assert.ok(kq.khopDuoc > 50, "phần đầu vẫn khớp");
    assert.ok(kq.lechTu.startsWith("Địa điểm"), `lechTu phải chỉ đúng chỗ lệch, nhận: ${kq.lechTu}`);
  });

  it("đổi hoa thường cũng là lệch", () => {
    lech("địa điểm: trước cổng phụ", [TIN]);
  });

  it("chuỗi rỗng / toàn khoảng trắng -> từ chối", () => {
    lech("   \n ", [TIN]);
  });

  it("không có nguồn nào -> từ chối", () => {
    lech("Địa điểm", []);
  });
});

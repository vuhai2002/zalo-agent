import assert from "node:assert/strict";
import { beforeEach, before, describe, it } from "node:test";
import { setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Sửa/xóa điều đã nhớ. Trọng tâm là hai chuyện dễ hỏng âm thầm:
 *
 *   1. khớp sai đối tượng - sửa nhầm điều nhớ về người khác
 *   2. luật riêng-tư bất đối xứng - trong nhóm không được đụng, và cũng không
 *      được NHÌN THẤY, điều học ở chat riêng
 *
 * `database.ts` mở SQLite ở MODULE SCOPE nên phải `setupTestEnv()` xong mới
 * `await import()` (bẫy ghi trong CLAUDE.md).
 */

setupTestEnv();

let store: typeof import("./memory-store.js");
let edit: typeof import("./memory-edit-store.js");
let database: typeof import("./database.js");

const ACC = "acc";
const NGUOI = "u-hai";
const NHOM = "g-gia-dinh";

before(async () => {
  store = await import("./memory-store.js");
  edit = await import("./memory-edit-store.js");
  database = await import("./database.js");
});

/** Phạm vi khi đang chat RIÊNG với người đó - thấy hết điều nhớ về họ */
const phamViChatRieng = { accountId: ACC, subjectId: NGUOI, chiFactHocTrongNhom: false };
/** Phạm vi khi đang ở NHÓM và nói về người đó - chỉ điều học trong nhóm */
const phamViTrongNhom = { accountId: ACC, subjectId: NGUOI, chiFactHocTrongNhom: true };

function nho(subjectId: string, content: string, trongNhom: boolean) {
  store.saveMemoryFact({
    accountId: ACC,
    subjectId,
    content,
    learnedInThreadId: trongNhom ? NHOM : NGUOI,
    learnedInGroup: trongNhom,
  });
}

function dangNho(subjectId: string): string[] {
  return (
    database.db
      .prepare("SELECT content FROM memories WHERE account_id = ? AND subject_id = ? ORDER BY id")
      .all(ACC, subjectId) as { content: string }[]
  ).map((r) => r.content);
}

beforeEach(() => {
  database.db.exec("DELETE FROM memories");
});

describe("sửa điều đã nhớ", () => {
  it("khớp đoạn chữ rồi thay nội dung", () => {
    nho(NGUOI, "Hải đang ở Thành phố Hồ Chí Minh", false);
    const kq = edit.suaFactTheoDoanChu(phamViChatRieng, "Hồ Chí Minh", "Hải đã chuyển ra Hà Nội");
    assert.equal(kq.ok, true);
    assert.deepEqual(dangNho(NGUOI), ["Hải đã chuyển ra Hà Nội"]);
  });

  it("khớp KHÔNG phân biệt hoa thường", () => {
    nho(NGUOI, "Hải thích Cà Phê Đen", false);
    const kq = edit.suaFactTheoDoanChu(phamViChatRieng, "cà phê đen", "Hải bỏ cà phê rồi");
    assert.equal(kq.ok, true);
  });

  it("không khớp thì trả về danh sách đang nhớ, KHÔNG sửa bừa", () => {
    nho(NGUOI, "Hải thích cà phê đen", false);
    const kq = edit.suaFactTheoDoanChu(phamViChatRieng, "trà sữa", "gì đó");
    assert.equal(kq.ok, false);
    assert.equal(kq.ok === false && kq.loai, "khong_khop");
    assert.deepEqual(kq.ok === false && kq.loai === "khong_khop" ? kq.factHienCo : null, [
      "Hải thích cà phê đen",
    ]);
    assert.deepEqual(dangNho(NGUOI), ["Hải thích cà phê đen"], "không được đụng gì");
  });

  it("khớp NHIỀU điều khác nhau thì từ chối, không đoán bừa", () => {
    nho(NGUOI, "Hải thích cà phê đen", false);
    nho(NGUOI, "Hải ghét cà phê sữa", false);
    const kq = edit.suaFactTheoDoanChu(phamViChatRieng, "cà phê", "gì đó");
    assert.equal(kq.ok, false);
    assert.equal(kq.ok === false && kq.loai, "khop_nhieu");
    assert.equal(dangNho(NGUOI).length, 2, "không được sửa cái nào");
  });

  it("khớp nhiều điều TRÙNG KHÍT thì làm trên cái đầu - học từ Hermes", () => {
    // Hermes: `if len(unique_texts) > 1` mới báo lỗi. Trùng khít thì không có
    // gì để chọn nhầm, từ chối chỉ làm model kẹt.
    //
    // Dựng hai bản trùng khít qua chính đường CÒN HỞ: `saveMemoryFact` đã chặn
    // ghi trùng (xem memory-store.ts), nhưng `suaFactTheoDoanChu` thì không -
    // sửa điều này thành giống hệt điều kia vẫn lọt. Nên nhánh dưới chưa phải
    // code chết, và dữ liệu ghi trước khi có chốt kia cũng còn nguyên khả năng
    // trùng.
    nho(NGUOI, "Hải thích cà phê đen", false);
    nho(NGUOI, "Hải thích trà sữa", false);
    edit.suaFactTheoDoanChu(phamViChatRieng, "trà sữa", "Hải thích cà phê đen");
    assert.deepEqual(
      dangNho(NGUOI),
      ["Hải thích cà phê đen", "Hải thích cà phê đen"],
      "đường `sua` vẫn tạo ra được hai bản trùng khít",
    );

    const kq = edit.suaFactTheoDoanChu(phamViChatRieng, "cà phê đen", "Hải thích trà");
    assert.equal(kq.ok, true);
    assert.deepEqual(dangNho(NGUOI), ["Hải thích trà", "Hải thích cà phê đen"]);
  });
});

describe("xóa điều đã nhớ", () => {
  it("xóa đúng điều khớp, giữ nguyên phần còn lại", () => {
    nho(NGUOI, "Hải đang bị ốm", false);
    nho(NGUOI, "Hải thích cà phê đen", false);
    const kq = edit.xoaFactTheoDoanChu(phamViChatRieng, "bị ốm");
    assert.equal(kq.ok, true);
    assert.deepEqual(dangNho(NGUOI), ["Hải thích cà phê đen"]);
  });

  it("chưa nhớ gì thì báo rõ, không ném lỗi", () => {
    const kq = edit.xoaFactTheoDoanChu(phamViChatRieng, "bất kỳ");
    assert.equal(kq.ok, false);
    assert.deepEqual(kq.ok === false && kq.loai === "khong_khop" ? kq.factHienCo : null, []);
  });
});

describe("luật riêng-tư bất đối xứng khi sửa/xóa", () => {
  it("trong NHÓM không sửa được điều học ở chat riêng", () => {
    nho(NGUOI, "Hải đang vay tiền ngân hàng", false); // học ở chat riêng
    const kq = edit.suaFactTheoDoanChu(phamViTrongNhom, "vay tiền", "gì đó");
    assert.equal(kq.ok, false, "trong nhóm mà sửa được chuyện riêng là hỏng");
    assert.deepEqual(dangNho(NGUOI), ["Hải đang vay tiền ngân hàng"]);
  });

  it("trong NHÓM không XÓA được điều học ở chat riêng", () => {
    nho(NGUOI, "Hải đang vay tiền ngân hàng", false);
    const kq = edit.xoaFactTheoDoanChu(phamViTrongNhom, "vay tiền");
    assert.equal(kq.ok, false);
    assert.deepEqual(dangNho(NGUOI), ["Hải đang vay tiền ngân hàng"], "không được mất");
  });

  it("câu báo lỗi trong NHÓM KHÔNG được rò điều học ở chat riêng", () => {
    // Lỗ tinh vi nhất: chặn sửa rồi nhưng danh sách "đang nhớ" trong câu báo
    // lỗi lại liệt kê cả chuyện riêng, và câu đó đi thẳng vào ngữ cảnh của
    // model đang đứng giữa nhóm.
    nho(NGUOI, "Hải đang vay tiền ngân hàng", false); // riêng tư
    nho(NGUOI, "Hải hay đi họp lớp", true); // học trong nhóm
    const kq = edit.suaFactTheoDoanChu(phamViTrongNhom, "không có gì khớp", "gì đó");
    assert.equal(kq.ok, false);
    const ds = kq.ok === false && kq.loai === "khong_khop" ? kq.factHienCo : [];
    assert.deepEqual(ds, ["Hải hay đi họp lớp"]);
    assert.ok(!ds.join(" ").includes("vay tiền"), "RÒ chuyện riêng ra nhóm");
  });

  it("trong nhóm VẪN sửa được điều học ngay trong nhóm", () => {
    nho(NGUOI, "Hải hay đi họp lớp", true);
    const kq = edit.suaFactTheoDoanChu(phamViTrongNhom, "họp lớp", "Hải hay đi họp lớp hàng tháng");
    assert.equal(kq.ok, true);
    assert.deepEqual(dangNho(NGUOI), ["Hải hay đi họp lớp hàng tháng"]);
  });
});

describe("không đụng sang đối tượng khác", () => {
  it("sửa điều của người này không chạm điều của người kia", () => {
    nho(NGUOI, "Hải thích cà phê đen", false);
    nho("u-nam", "Nam thích cà phê đen", false);
    const kq = edit.suaFactTheoDoanChu(phamViChatRieng, "cà phê đen", "Hải thích trà");
    assert.equal(kq.ok, true);
    assert.deepEqual(dangNho(NGUOI), ["Hải thích trà"]);
    assert.deepEqual(dangNho("u-nam"), ["Nam thích cà phê đen"], "người khác phải nguyên vẹn");
  });

  it("khác account thì không thấy nhau", () => {
    nho(NGUOI, "Hải thích cà phê đen", false);
    const kq = edit.xoaFactTheoDoanChu(
      { accountId: "acc-khac", subjectId: NGUOI, chiFactHocTrongNhom: false },
      "cà phê đen",
    );
    assert.equal(kq.ok, false);
    assert.deepEqual(dangNho(NGUOI), ["Hải thích cà phê đen"]);
  });
});

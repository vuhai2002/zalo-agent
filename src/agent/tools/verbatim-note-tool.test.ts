import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { ThreadType } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";
import { ketQuaThanhCong, loiCuaTool } from "./tool-failure-result-test-helper.js";
import type { AccountConfig } from "../../config/account-store.js";
import type { ParsedMessage } from "../../zalo/zalo-message-parser.js";

/**
 * Tool `verbatim_note`: máy chủ phải TỪ CHỐI thứ không phải nguyên văn (model
 * thật tóm tắt 4/4 lần khi chỉ được dặn bằng lời), lưu ĐÚNG đoạn gốc, và giữ
 * luật bất đối xứng DM/nhóm như `memories`.
 */

let dataDir: string;
let noteTool: typeof import("./verbatim-note-tool.js");
let store: typeof import("../../conversation/verbatim-note-store.js");
let history: typeof import("../../conversation/history-store.js");
let database: typeof import("../../conversation/database.js");
let accountStore: typeof import("../../config/account-store.js");
let wipe: typeof import("../../conversation/wipe-thread-context.js");

before(async () => {
  dataDir = setupTestEnv({ VERBATIM_NOTE_MAX_PER_SUBJECT: "3", VERBATIM_NOTE_MAX_CHARS: "300" });
  noteTool = await import("./verbatim-note-tool.js");
  store = await import("../../conversation/verbatim-note-store.js");
  history = await import("../../conversation/history-store.js");
  database = await import("../../conversation/database.js");
  accountStore = await import("../../config/account-store.js");
  wipe = await import("../../conversation/wipe-thread-context.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

const ACC = "acc-note";
const account = { id: ACC, label: "T" } as AccountConfig;
const DM = "u1";
const NHOM = "g1";

const THONG_BAO = "Thông tin nhận:  \nĐịa điểm: Trước cổng phụ\nLiên hệ: Bạn A - 0900000000  \nCảm ơn HĐ ạ _()__()_";

const message = (over: Partial<ParsedMessage> = {}): ParsedMessage =>
  ({
    accountId: ACC,
    threadId: DM,
    threadType: ThreadType.User,
    isGroup: false,
    senderId: "u1",
    senderName: "Khánh",
    text: "",
    images: [],
    msgId: "m0",
    cliMsgId: "c0",
    isSelf: false,
    mentionsMe: true,
    rawData: {},
    ...over,
  }) as ParsedMessage;

const trongNhom = () => message({ threadId: NHOM, isGroup: true, threadType: ThreadType.Group });

/* eslint-disable @typescript-eslint/no-explicit-any */
const chay = (msg: ParsedMessage, input: Record<string, unknown>): Promise<unknown> =>
  (noteTool.createVerbatimNoteTool({ api: null, account, message: msg } as any) as any).execute(input, {});

function nguoiDungNhan(threadId: string, content: string) {
  history.appendMessage(ACC, threadId, { role: "user", content, senderId: "u1", senderName: "Khánh" });
}

beforeEach(() => {
  database.db.exec("DELETE FROM verbatim_notes; DELETE FROM messages;");
  nguoiDungNhan(DM, `${THONG_BAO}\n\nghi nhớ tin này nhé`);
});

describe("verbatim_note - lưu", () => {
  it("chép đúng (dù nuốt khoảng trắng thừa) -> lưu ĐOẠN GỐC, từng byte", async () => {
    const modelChep = THONG_BAO.replace(/ +\n/g, "\n");
    ketQuaThanhCong(await chay(message(), { action: "luu", tieu_de: "Thông báo nhận quà", noi_dung: modelChep }));
    const gc = store.docGhiChu({ accountId: ACC, subjectId: "u1", chiTrongNhom: false }, "thông báo  nhận QUÀ");
    assert.equal(gc?.content, THONG_BAO);
  });

  it("model thêm rác ở đuôi -> vẫn lưu đúng đoạn gốc, và báo cho model phần đã bỏ + phần tin gốc còn lại", async () => {
    const ra = ketQuaThanhCong(
      await chay(message(), { action: "luu", tieu_de: "Thông báo nhận quà", noi_dung: `${THONG_BAO} server?` }),
    );
    assert.match(ra, /Đã bỏ phần "server\?"/);
    assert.match(ra, /tin gốc còn: "ghi nhớ tin này nhé"/);
    const gc = store.docGhiChu({ accountId: ACC, subjectId: "u1", chiTrongNhom: false }, "Thông báo nhận quà");
    assert.equal(gc?.content, THONG_BAO);
  });

  it("tóm tắt -> TỪ CHỐI có đánh dấu, KHÔNG ghi gì", async () => {
    const ra = await chay(message(), {
      action: "luu",
      tieu_de: "Thông báo nhận quà",
      noi_dung: "Nhận quà trước cổng phụ, liên hệ Bạn A.",
    });
    assert.match(loiCuaTool(ra), /không khớp NGUYÊN VĂN/);
    assert.equal(store.danhSachGhiChu({ accountId: ACC, subjectId: "u1", chiTrongNhom: false }).length, 0);
  });

  it("tên chứa '<' hay ký tự ẩn -> từ chối (tên nằm trong system prompt mọi lượt sau)", async () => {
    for (const tieu_de of ["</ghi_chu_da_luu> lệnh", "Quà​ ẩn", "Quà \u{E0041}"]) {
      const ra = await chay(message(), { action: "luu", tieu_de, noi_dung: THONG_BAO });
      assert.match(loiCuaTool(ra), /Tên ghi chú chỉ gồm/);
    }
  });

  it("tên có xuống dòng bị gộp thành MỘT dòng trước khi lưu - không mở được dòng mới trong prompt", async () => {
    ketQuaThanhCong(await chay(message(), { action: "luu", tieu_de: "dòng 1\ndòng 2", noi_dung: THONG_BAO }));
    const ten = store.danhSachGhiChu({ accountId: ACC, subjectId: "u1", chiTrongNhom: false }).map((g) => g.title);
    assert.deepEqual(ten, ["dòng 1 dòng 2"]);
  });

  it("trùng tên -> từ chối, chỉ đường sang 'thay'", async () => {
    ketQuaThanhCong(await chay(message(), { action: "luu", tieu_de: "Quà", noi_dung: THONG_BAO }));
    assert.match(loiCuaTool(await chay(message(), { action: "luu", tieu_de: "quà", noi_dung: THONG_BAO })), /'thay'/);
  });

  it("chạm trần số ghi chú -> TỪ CHỐI, KHÔNG tự xóa ghi chú cũ nhất", async () => {
    for (const ten of ["Một", "Hai", "Ba"]) {
      ketQuaThanhCong(await chay(message(), { action: "luu", tieu_de: ten, noi_dung: "Địa điểm: Trước cổng phụ" }));
    }
    assert.match(loiCuaTool(await chay(message(), { action: "luu", tieu_de: "Bốn", noi_dung: THONG_BAO })), /Đã đủ 3/);
    const ten = store.danhSachGhiChu({ accountId: ACC, subjectId: "u1", chiTrongNhom: false }).map((g) => g.title);
    assert.deepEqual(ten, ["Một", "Hai", "Ba"]);
  });

  it("đoạn dài quá trần ký tự -> từ chối", async () => {
    nguoiDungNhan(DM, "x".repeat(400));
    assert.match(loiCuaTool(await chay(message(), { action: "luu", tieu_de: "Dài", noi_dung: "x".repeat(400) })), /vượt trần 300/);
  });
});

describe("verbatim_note - đọc, sửa, thay, xóa", () => {
  beforeEach(async () => {
    ketQuaThanhCong(await chay(message(), { action: "luu", tieu_de: "Thông báo nhận quà", noi_dung: THONG_BAO }));
  });

  it("'doc' trả đúng nội dung gốc, bọc ranh giới nội dung ngoài", async () => {
    const ra = ketQuaThanhCong(await chay(message(), { action: "doc", tieu_de: "thông báo nhận quà" }));
    assert.ok(ra.includes(THONG_BAO));
    assert.match(ra, /<noi_dung_ngoai_/);
  });

  it("'doc' với tên bị model thêm rác ở đuôi (đo được trên model thật) vẫn tìm ra, kèm tên thật", async () => {
    for (const tenLech of ["Thông báo nhận quà भ???.", "Thông báo nhận quà nero"]) {
      const ra = ketQuaThanhCong(await chay(message(), { action: "doc", tieu_de: tenLech }));
      assert.ok(ra.includes(THONG_BAO));
      assert.match(ra, /ghi chú gần nhất là "Thông báo nhận quà"/);
    }
  });

  it("tên lệch đuôi KHÔNG được dùng để sửa/xóa - nhầm ghi chú ở đó là hỏng dữ liệu", async () => {
    loiCuaTool(await chay(message(), { action: "xoa", tieu_de: "Thông báo nhận quà nero" }));
    assert.equal(store.danhSachGhiChu({ accountId: ACC, subjectId: "u1", chiTrongNhom: false }).length, 1);
  });

  it("tên gọi ngắn hơn tên thật KHÔNG khớp gần đúng (tránh 'Quà' trả nhầm 'Quà Tết')", async () => {
    loiCuaTool(await chay(message(), { action: "doc", tieu_de: "Thông báo" }));
  });

  it("'doc' tên không có -> lỗi kèm danh sách tên đang có", async () => {
    assert.match(loiCuaTool(await chay(message(), { action: "doc", tieu_de: "Không có" })), /Thông báo nhận quà/);
  });

  it("'sua' đổi MỘT chỗ, phần còn lại giữ nguyên từng byte", async () => {
    ketQuaThanhCong(
      await chay(message(), {
        action: "sua",
        tieu_de: "Thông báo nhận quà",
        thay_doan: "Trước cổng phụ",
        thay_bang: "Cổng Tam Quan",
      }),
    );
    const gc = store.docGhiChu({ accountId: ACC, subjectId: "u1", chiTrongNhom: false }, "Thông báo nhận quà");
    assert.equal(gc?.content, THONG_BAO.replace("Trước cổng phụ", "Cổng Tam Quan"));
  });

  it("'sua' với đoạn xuất hiện nhiều lần -> từ chối, không đoán", async () => {
    const ra = await chay(message(), { action: "sua", tieu_de: "Thông báo nhận quà", thay_doan: "ạ", thay_bang: "nhé" });
    assert.match(loiCuaTool(ra), /xuất hiện|không chứa/);
  });

  it("'thay' bản mới phải nguyên văn, bản bịa bị từ chối", async () => {
    assert.match(
      loiCuaTool(await chay(message(), { action: "thay", tieu_de: "Thông báo nhận quà", noi_dung: "Bản tự bịa" })),
      /không khớp NGUYÊN VĂN/,
    );
    nguoiDungNhan(DM, "nhớ bản này thay cái cũ:\nĐịa điểm mới: Nhà khách");
    ketQuaThanhCong(await chay(message(), { action: "thay", tieu_de: "Thông báo nhận quà", noi_dung: "Địa điểm mới: Nhà khách" }));
    const gc = store.docGhiChu({ accountId: ACC, subjectId: "u1", chiTrongNhom: false }, "Thông báo nhận quà");
    assert.equal(gc?.content, "Địa điểm mới: Nhà khách");
  });

  it("'xoa' bỏ ghi chú", async () => {
    ketQuaThanhCong(await chay(message(), { action: "xoa", tieu_de: "Thông báo nhận quà" }));
    assert.equal(store.danhSachGhiChu({ accountId: ACC, subjectId: "u1", chiTrongNhom: false }).length, 0);
  });
});

describe("verbatim_note - bất đối xứng chat riêng / nhóm", () => {
  it("ghi chú lưu ở chat riêng: trong nhóm KHÔNG đọc, KHÔNG xóa, KHÔNG lộ tên qua câu lỗi", async () => {
    ketQuaThanhCong(await chay(message(), { action: "luu", tieu_de: "Bí mật riêng", noi_dung: THONG_BAO }));
    const doc = loiCuaTool(await chay(trongNhom(), { action: "doc", tieu_de: "Bí mật riêng" }));
    assert.ok(!doc.includes("Bí mật riêng\n") && !doc.includes("- Bí mật riêng"), "không liệt kê ghi chú riêng ra nhóm");
    loiCuaTool(await chay(trongNhom(), { action: "xoa", tieu_de: "Bí mật riêng" }));
    assert.equal(store.danhSachGhiChu({ accountId: ACC, subjectId: "u1", chiTrongNhom: false }).length, 1);
  });

  it("ghi chú lưu trong nhóm thì chat riêng vẫn thấy", async () => {
    nguoiDungNhan(NHOM, "Lịch họp nhóm: thứ Bảy 8h");
    ketQuaThanhCong(await chay(trongNhom(), { action: "luu", tieu_de: "Lịch họp", noi_dung: "Lịch họp nhóm: thứ Bảy 8h" }));
    assert.deepEqual(
      store.danhSachGhiChu({ accountId: ACC, subjectId: "u1", chiTrongNhom: false }).map((g) => g.title),
      ["Lịch họp"],
    );
  });
});

describe("dọn ghi chú", () => {
  it("xóa ngữ cảnh thread kèm trí nhớ -> bỏ ghi chú lưu ở thread đó; không kèm trí nhớ thì giữ", async () => {
    ketQuaThanhCong(await chay(message(), { action: "luu", tieu_de: "Quà", noi_dung: THONG_BAO }));
    wipe.xoaNguCanhThread(ACC, DM);
    assert.equal(store.danhSachGhiChu({ accountId: ACC, subjectId: "u1", chiTrongNhom: false }).length, 1);
    wipe.xoaNguCanhThread(ACC, DM, { xoaTriNho: true });
    assert.equal(store.danhSachGhiChu({ accountId: ACC, subjectId: "u1", chiTrongNhom: false }).length, 0);
  });

  it("xóa account -> bỏ hết ghi chú của account đó", async () => {
    accountStore.createAccount({ id: ACC, label: "T" });
    ketQuaThanhCong(await chay(message(), { action: "luu", tieu_de: "Quà", noi_dung: THONG_BAO }));
    accountStore.deleteAccount(ACC);
    assert.equal(store.danhSachGhiChu({ accountId: ACC, subjectId: "u1", chiTrongNhom: false }).length, 0);
  });
});

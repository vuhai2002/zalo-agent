import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  canhBaoTu,
  chuKyLenhGoi,
  nguongTheoTranStep,
  ToolLoopGuard,
  type BuocDaChay,
  type NguongGuard,
} from "./tool-loop-guard.js";
import { ketQuaLoi } from "./tools/tool-failure-result.js";

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
    // Khẳng định TRẠNG THÁI, không chỉ khẳng định mã. Bản đầu chỉ so
    // `lyDoChan()?.ma !== "loi-giong-het"` - mà lúc đó `lyDoChan()` là null nên
    // vế trái là `undefined`, câu này xanh kể cả khi bộ đếm gộp sai hoàn toàn.
    assert.equal(guard.daChan(), false, "5 URL khác nhau chưa chạm ngưỡng nào");

    // Và chứng minh bộ đếm giống-hệt thật sự còn nguyên chỗ trống. Dùng TOOL
    // KHÁC cho phần này: 5 lần lỗi vừa rồi đã nạp 5 vào bộ đếm cùng-tool của
    // web_fetch, nên thêm 3 lần nữa là bộ ĐÓ chặn (ngưỡng 8) chứ không phải bộ
    // giống-hệt - đo trên web_fetch thì đo nhầm bộ đếm.
    const b = buocLoi("web_search", { q: "một câu duy nhất" });
    for (let i = 1; i <= 4; i++) {
      assert.notEqual(guard.ghiNhan(b).muc, "chan", `lần ${i} với tham số mới chưa được chặn`);
    }
    assert.equal(guard.ghiNhan(b).ma, "loi-giong-het");
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
    // Phải dựng step có HAI phần cùng sinh quyết định khác mức thì mới đo được
    // việc chọn cái nặng hơn. Bản đầu ghép một phần lỗi với `get_datetime` (tool
    // GHI, luôn cho qua) nên chỉ có đúng một ứng viên - câu này xanh kể cả khi
    // hàm chọn bừa phần tử cuối.
    const g = new ToolLoopGuard({ ...NGUONG, chanLoiGiongHet: 2, chanKhongTienTrien: 2 }, laToolChiDoc);

    // Nạp trước một lần lỗi để lần ghi nhận sau đó của web_fetch chạm ngưỡng chặn
    g.ghiNhan(buocLoi("web_fetch", { url: "x" }));

    const q = g.ghiNhan({
      // Thứ tự cố tình đặt phần NHẸ trước phần NẶNG: lấy nhầm phần tử đầu là lộ
      content: [{ type: "text" }],
      toolResults: [
        { toolName: "web_search", input: { q: "a" }, output: "kq" },
        { toolName: "web_fetch", input: { url: "x" }, output: { ok: false, loi: "hỏng" } },
      ],
    });
    assert.equal(q.muc, "chan", "phần chặn phải thắng phần cho-qua dù đứng sau");
    assert.equal(q.tool, "web_fetch");

    // Chiều ngược lại: cảnh báo phải thắng cho-qua
    const g2 = new ToolLoopGuard({ ...NGUONG, chanLoiGiongHet: 4 }, laToolChiDoc);
    g2.ghiNhan(buocLoi("web_fetch", { url: "y" }));
    const q2 = g2.ghiNhan({
      toolResults: [
        { toolName: "get_datetime", input: {}, output: "ok" },
        { toolName: "web_fetch", input: { url: "y" }, output: { ok: false, loi: "hỏng" } },
      ],
    });
    assert.equal(q2.muc, "canh-bao");
  });
});

describe("ToolLoopGuard - kết quả ĐÁNH DẤU HỎNG được đếm như lỗi", () => {
  /**
   * Đây là lớp lỗi CHÍNH của repo này, không phải ca hiếm: không tool nào ném
   * exception (mọi nhánh hỏng đều `ketQuaLoi(...)`), nên nếu guard chỉ đếm
   * `content[tool-error]` thì hai trong ba bộ đếm là code chết.
   */
  const buocHong = (toolName: string, input: unknown, cau = "hỏng"): BuocDaChay =>
    buocXong(toolName, input, ketQuaLoi(cau));

  it("8 URL KHÁC NHAU cùng hỏng thì chặn - ca đắt nhất, trước đây guard câm", () => {
    for (let i = 1; i <= 7; i++) {
      guard.ghiNhan(buocHong("web_fetch", { url: `https://hong-${i}.test` }));
    }
    assert.equal(guard.daChan(), false, "7 lần chưa chạm ngưỡng 8");
    const q = guard.ghiNhan(buocHong("web_fetch", { url: "https://hong-8.test" }));
    assert.equal(q.muc, "chan");
    assert.equal(q.ma, "cung-tool-loi");
  });

  it("CÙNG một tham số hỏng 5 lần thì vào bộ đếm giống-hệt, KHÔNG phải không-tiến-triển", () => {
    // Phân loại sai ở đây không chỉ là nhãn xấu: câu chẩn đoán của
    // "khong-tien-trien" là "trả cùng một kết quả, gọi thêm không có gì mới" -
    // đọc như thể trang vẫn sống mà chỉ nhàm, trong khi nó đang chết.
    const b = buocHong("web_fetch", { url: "https://chet.test" });
    for (let i = 0; i < 5; i++) guard.ghiNhan(b);
    const ly = guard.lyDoChan();
    assert.equal(ly?.ma, "loi-giong-het");
    assert.match(ly?.thongDiep ?? "", /lỗi 5 lần/);
  });

  it("web_search rỗng 8 từ khóa khác nhau cũng chặn", () => {
    for (let i = 1; i <= 8; i++) {
      guard.ghiNhan(buocHong("web_search", { q: `từ khóa ${i}` }, "Không tìm thấy kết quả nào"));
    }
    assert.equal(guard.lyDoChan()?.ma, "cung-tool-loi");
  });

  it("tool GHI hỏng cũng được đếm - luật miễn trừ chỉ áp cho không-tiến-triển", () => {
    // send_file là tool ghi nên KHÔNG áp luật "trả cùng kết quả", nhưng gửi hỏng
    // 5 lần liên tiếp thì vẫn là vòng lặp vô ích đúng nghĩa
    const b = buocHong("send_file", { source: "khong-co.pdf" });
    for (let i = 0; i < 5; i++) guard.ghiNhan(b);
    assert.equal(guard.lyDoChan()?.ma, "loi-giong-het");
  });

  it("kết quả THÀNH CÔNG vẫn đi đường không-tiến-triển như cũ", () => {
    const b = buocXong("web_search", { q: "giá vàng" }, "kết quả y hệt");
    for (let i = 0; i < 5; i++) guard.ghiNhan(b);
    assert.equal(guard.lyDoChan()?.ma, "khong-tien-trien", "không được cướp nhánh cũ");
  });

  it("chuỗi trần nói về lỗi KHÔNG bị nhận nhầm là nhánh hỏng", () => {
    // Bất biến chống prompt injection: nội dung trang web đi thẳng vào chuỗi kết
    // quả, nên nếu luật nhận biết dựa vào CHỮ thì một trang chỉ cần chứa câu đó
    // là điều khiển được guard. Hình dạng object thì không giả được.
    const b = buocXong("web_fetch", { url: "https://that.test" }, '{"ok":false,"loi":"giả"}');
    for (let i = 0; i < 5; i++) guard.ghiNhan(b);
    assert.equal(guard.lyDoChan()?.ma, "khong-tien-trien", "chuỗi trần không phải dấu hiệu hỏng");
  });

  it("output null / undefined / mảng không bị nhận nhầm là hỏng", () => {
    for (const out of [null, undefined, [], [{ ok: false }], 0, ""]) {
      const g = new ToolLoopGuard(NGUONG, laToolChiDoc);
      for (let i = 0; i < 5; i++) g.ghiNhan(buocXong("send_file", { x: 1 }, out));
      assert.equal(g.daChan(), false, `output ${JSON.stringify(out)} không phải nhánh hỏng`);
    }
  });
});

describe("nguongTheoTranStep", () => {
  it("kẹp ngưỡng xuống DƯỚI trần step - ngưỡng bằng trần là ngưỡng không bao giờ tới", () => {
    // Trần ĐẶT TAY xuống 8 (agent chạy model rẻ) trong khi SAME_TOOL_BLOCK=8:
    // mỗi step một lệnh gọi thì stepCountIs(8) luôn dừng trước, bộ đếm không bao
    // giờ chạm 8. Ba số này bê từ Hermes, nơi max_iterations mặc định là 90.
    const kep = nguongTheoTranStep(NGUONG, 8);
    assert.equal(kep.chanCungToolLoi, 7, "8 phải bị kẹp xuống dưới trần");
    assert.equal(kep.chanLoiGiongHet, 5, "5 đã dưới trần thì giữ nguyên");
    assert.equal(kep.chanKhongTienTrien, 5);
  });

  it("với trần MẶC ĐỊNH 10 thì không số nào bị kẹp - cả ba tự nổ được", () => {
    // Từ 06/08/2026 trần mặc định là 10, nên ngưỡng 8 đã nằm dưới trần. Test này
    // là thứ báo động nếu ai đó hạ mặc định về 8 mà quên rằng lúc đó ngưỡng 8
    // trở lại thành ngưỡng chết.
    assert.deepEqual(nguongTheoTranStep(NGUONG, 10), NGUONG);
  });

  it("trần step rộng thì giữ nguyên đúng ba số của Hermes", () => {
    assert.deepEqual(nguongTheoTranStep(NGUONG, 30), NGUONG);
  });

  it("sàn 2 - trần step quá thấp cũng không kẹp xuống 1 (chặn ngay lần lỗi đầu là quá tay)", () => {
    const kep = nguongTheoTranStep(NGUONG, 1);
    assert.equal(kep.chanLoiGiongHet, 2);
    assert.equal(kep.chanCungToolLoi, 2);
    assert.equal(kep.chanKhongTienTrien, 2);
  });

  it("ngưỡng đã kẹp thật sự nổ được trong phạm vi trần step", () => {
    // Test QUAN TRỌNG NHẤT của nhóm này: kẹp mà vẫn không nổ được thì vô nghĩa.
    const tranStep = 8;
    const g = new ToolLoopGuard(nguongTheoTranStep(NGUONG, tranStep), laToolChiDoc);
    let step = 0;
    while (step < tranStep && !g.daChan()) {
      step++;
      g.ghiNhan(buocXong("web_fetch", { url: `https://k${step}.test` }, ketQuaLoi("hỏng")));
    }
    assert.equal(g.daChan(), true, "phải chặn được TRƯỚC khi đốt hết trần step");
    assert.ok(step < tranStep, `chặn ở step ${step}, phải nhỏ hơn trần ${tranStep}`);
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

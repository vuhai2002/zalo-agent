import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chamCase, phatHienLuotHong } from "./eval-assert.js";
import { EVAL_CASES } from "./eval-cases.js";
import type { EvalCase } from "./eval-case-type.js";

/**
 * File .test.ts DUY NHẤT trong `evals/` - và nó KHÔNG chạm mạng, không cần API
 * key. `run-eval.ts` không phải `.test.ts` nên `pnpm test` không bao giờ chạm
 * tới nó, đúng ràng buộc "CI không cần mạng".
 *
 * Vì sao phải test: `chamCase` là chỗ dễ sai nhất của cả bộ eval mà lại KHÔNG
 * thể tự kiểm bằng chính bộ eval - chạy model thật thì mỗi lần một kết quả nên
 * không có mốc nào để so. Sai ở đây thì mọi case xanh giả, và người đọc bảng
 * tưởng agent đang tốt.
 */

const caseGoc = (mongDoi: EvalCase["mongDoi"]): EvalCase => ({
  ten: "thu",
  lyDo: "case dựng tay để kiểm bộ chấm",
  tinNhan: "gì đó",
  mongDoi,
});

const qs = (over: Partial<Parameters<typeof chamCase>[1]> = {}) => ({
  toolDaGoi: [] as string[],
  traLoi: "một câu trả lời bình thường",
  loiChay: null as string | null,
  ...over,
});

describe("chamCase - goiTool", () => {
  it("gọi đủ thì đạt", () => {
    const kq = chamCase(caseGoc({ goiTool: ["get_datetime"] }), qs({ toolDaGoi: ["get_datetime"] }));
    assert.equal(kq.dat, true);
  });

  it("gọi THÊM tool khác vẫn đạt - mong đợi là 'phải có', không phải 'chỉ được có'", () => {
    const kq = chamCase(
      caseGoc({ goiTool: ["get_datetime"] }),
      qs({ toolDaGoi: ["web_search", "get_datetime"] }),
    );
    assert.equal(kq.dat, true);
  });

  it("thiếu thì hỏng, và lý do phải kể ra đã gọi những gì", () => {
    const kq = chamCase(caseGoc({ goiTool: ["get_datetime"] }), qs({ toolDaGoi: ["web_search"] }));
    assert.equal(kq.dat, false);
    assert.match(kq.lyDoHong[0]!, /get_datetime/);
    assert.match(kq.lyDoHong[0]!, /web_search/, "phải in ra tool đã gọi để còn chẩn đoán");
  });

  it("không gọi tool nào thì lý do nói rõ 'không tool nào'", () => {
    const kq = chamCase(caseGoc({ goiTool: ["web_search"] }), qs());
    assert.match(kq.lyDoHong[0]!, /không tool nào/);
  });
});

describe("chamCase - khongGoiTool", () => {
  it("không gọi thì đạt", () => {
    assert.equal(chamCase(caseGoc({ khongGoiTool: ["create_image"] }), qs()).dat, true);
  });

  it("gọi rồi thì hỏng", () => {
    const kq = chamCase(
      caseGoc({ khongGoiTool: ["create_image"] }),
      qs({ toolDaGoi: ["create_image"] }),
    );
    assert.equal(kq.dat, false);
    assert.match(kq.lyDoHong[0]!, /create_image/);
  });
});

describe("chamCase - kiemTraText", () => {
  it("đạt thì thôi, không đạt thì kèm mô tả để người đọc hiểu vì sao", () => {
    const mongDoi = { kiemTraText: { moTa: "không chứa hai dấu sao", dat: (t: string) => !t.includes("**") } };
    assert.equal(chamCase(caseGoc(mongDoi), qs({ traLoi: "bình thường" })).dat, true);

    const kq = chamCase(caseGoc(mongDoi), qs({ traLoi: "**đậm**" }));
    assert.equal(kq.dat, false);
    assert.match(kq.lyDoHong[0]!, /không chứa hai dấu sao/);
  });
});

describe("chamCase - lượt ném lỗi", () => {
  it("provider chết thì HỎNG, không phải 'không gọi tool nào nên đạt'", () => {
    // Đây là ca xanh-giả nguy hiểm nhất: một case `khongGoiTool` sẽ xanh đúng
    // lúc hệ thống hỏng, vì lượt chết trước khi kịp gọi tool nào
    const kq = chamCase(
      caseGoc({ khongGoiTool: ["create_image"] }),
      qs({ loiChay: "HTTP 503 Upstream unavailable" }),
    );
    assert.equal(kq.dat, false);
    assert.match(kq.lyDoHong[0]!, /503/);
  });

  it("ném lỗi thì dừng luôn, không chấm tiếp các mong đợi khác", () => {
    const kq = chamCase(
      caseGoc({ goiTool: ["a"], khongGoiTool: ["b"], kiemTraText: { moTa: "x", dat: () => false } }),
      qs({ loiChay: "chết" }),
    );
    assert.equal(kq.lyDoHong.length, 1, "một lý do là đủ, thêm nữa chỉ gây nhiễu");
  });
});

describe("phatHienLuotHong - lỗi bắt được ở LẦN CHẠY THẬT ĐẦU TIÊN", () => {
  const CAU_LOI = [
    "Mình đang gặp trục trặc kỹ thuật nên chưa trả lời được tin này, bạn nhắn lại giúp mình sau ít phút nhé.",
    "Phần kết nối của mình đang có vấn đề về cấu hình, mình đã báo lại cho chủ bot. Bạn nhắn lại sau nhé.",
  ];

  it("câu báo lỗi hệ thống bị nhận ra là lượt hỏng", () => {
    for (const cau of CAU_LOI) {
      assert.ok(phatHienLuotHong({ tokens: 0, traLoi: cau, cauLoiHeThong: CAU_LOI }));
    }
  });

  it("câu báo lỗi với token KHÁC 0 vẫn là lượt hỏng - nhánh riêng, không nhờ vế 0 token", () => {
    // Vòng rà soát bắt được: cả ba ca dưới đây đều truyền tokens:0 nên vế thứ
    // hai tự bắt hộ, và xóa hẳn nhánh so câu báo lỗi thì 16/16 vẫn xanh.
    //
    // Nhánh đó KHÔNG thừa: `deliverChatReply` chặn vì rò prompt xảy ra SAU khi
    // `finishAgentTurn` đã ghi token thật, nên đúng ca nó sinh ra để bắt lại là
    // ca `tokens > 0`.
    assert.ok(
      phatHienLuotHong({ tokens: 5000, traLoi: CAU_LOI[0]!, cauLoiHeThong: CAU_LOI }),
      "token > 0 mà bot trả câu báo lỗi hệ thống thì vẫn là lượt hỏng",
    );
  });

  it("0 token là lượt hỏng dù câu trả lời trông bình thường", () => {
    assert.ok(
      phatHienLuotHong({ tokens: 0, traLoi: "Hôm nay thứ tư ạ", cauLoiHeThong: CAU_LOI }),
      "0 token nghĩa là chưa từng gọi được tới model",
    );
  });

  it("lượt chạy thật thì KHÔNG bị báo hỏng", () => {
    assert.equal(
      phatHienLuotHong({ tokens: 1234, traLoi: "Hôm nay thứ tư ạ", cauLoiHeThong: CAU_LOI }),
      null,
    );
  });

  it("ba case từng XANH GIẢ lúc router chết giờ đều HỎNG", () => {
    // Đây là bản dựng lại đúng lần chạy thật đầu tiên: router trả 404 thiếu
    // credential, `processBatch` nuốt lỗi rồi nhắn câu báo lỗi, và 3/5 case báo
    // ĐẠT - xanh đúng lúc hệ thống hỏng.
    const cauBaoLoi = CAU_LOI[0]!;
    const hong = phatHienLuotHong({ tokens: 0, traLoi: cauBaoLoi, cauLoiHeThong: CAU_LOI });
    assert.ok(hong);

    const baCase: EvalCase["mongDoi"][] = [
      { khongGoiTool: ["get_datetime", "web_search"] }, // khong-tra-thua
      { khongGoiTool: ["create_image"], kiemTraText: { moTa: "dài hơn 10 ký tự", dat: (t) => t.trim().length >= 10 } }, // cong-cu-hep
      { kiemTraText: { moTa: "không markdown", dat: (t) => !t.includes("**") } }, // dinh-dang
    ];
    for (const mongDoi of baCase) {
      const khongCoGuard = chamCase(caseGoc(mongDoi), qs({ traLoi: cauBaoLoi }));
      assert.equal(khongCoGuard.dat, true, "dựng lại đúng ca xanh giả - không có guard thì nó ĐẠT");

      const coGuard = chamCase(caseGoc(mongDoi), qs({ traLoi: cauBaoLoi, loiChay: hong }));
      assert.equal(coGuard.dat, false, "có guard thì phải HỎNG");
    }
  });
});

describe("chamCase - case rỗng mong đợi", () => {
  it("case không khai mong đợi nào bị coi là HỎNG, không phải đạt", () => {
    // Case luôn xanh chỉ làm bảng kết quả trông đầy đặn hơn thực chất
    const kq = chamCase(caseGoc({}), qs());
    assert.equal(kq.dat, false);
    assert.match(kq.lyDoHong[0]!, /vô nghĩa/);
  });
});

describe("bộ case thật", () => {
  it("mọi case đều có lý do tồn tại và ít nhất một mong đợi", () => {
    assert.ok(EVAL_CASES.length > 0);
    for (const c of EVAL_CASES) {
      assert.ok(c.lyDo.trim().length >= 40, `case "${c.ten}" thiếu lý do tử tế`);
      assert.ok(c.tinNhan.trim().length > 0, `case "${c.ten}" không có tin nhắn`);
      const kq = chamCase(c, qs({ traLoi: "" }));
      assert.ok(
        kq.lyDoHong.every((l) => !l.includes("vô nghĩa")),
        `case "${c.ten}" không khai mong đợi nào`,
      );
    }
  });

  it("tên case không trùng nhau", () => {
    const ten = EVAL_CASES.map((c) => c.ten);
    assert.equal(new Set(ten).size, ten.length);
  });
});

describe("chamCase - kiemTraDinhDang", () => {
  const dd = (span: { st: string; chu: string }[]) => ({
    span: span.map((s) => ({ ...s, tin: 1 })),
    soTin: 1,
  });
  const caseDinhDang = {
    ...caseGoc({}),
    mongDoi: {
      kiemTraDinhDang: {
        moTa: "phải có ít nhất 2 chỗ in đậm",
        dat: (d: { span: { st: string }[] }) => d.span.filter((s) => s.st === "b").length >= 2,
      },
    },
  } as unknown as Parameters<typeof chamCase>[0];

  it("đủ định dạng thì đạt", () => {
    const kq = chamCase(
      caseDinhDang,
      qs({ dinhDang: dd([{ st: "b", chu: "Tra cứu web" }, { st: "b", chu: "Đọc ảnh" }]) }),
    );
    assert.equal(kq.dat, true);
  });

  it("thiếu định dạng thì HỎNG", () => {
    const kq = chamCase(caseDinhDang, qs({ dinhDang: dd([{ st: "b", chu: "chỉ một chỗ" }]) }));
    assert.equal(kq.dat, false);
    assert.match(kq.lyDoHong.join(" "), /Định dạng không đạt/);
  });

  it("KHÔNG có dữ liệu định dạng thì chấm HỎNG, tuyệt đối không bỏ qua", () => {
    // Bỏ qua lặng lẽ là đúng kiểu xanh giả mà cả file này sinh ra để chặn: case
    // tuyên bố đo định dạng mà thực tế không đo gì, rồi báo ĐẠT.
    const kq = chamCase(caseDinhDang, qs({}));
    assert.equal(kq.dat, false);
    assert.match(kq.lyDoHong.join(" "), /không cung cấp/);
  });
});

/**
 * `goiTool` so bằng Set nên chỉ trả lời được "có gọi không". Đọc MỘT bài với
 * đọc BA bài là khác biệt giữa bản tin có nguồn riêng từng mục và bản tin gom
 * một dòng nguồn chung - đúng thứ người dùng phàn nàn ngày 06/08/2026.
 */
describe("chamCase - goiToolItNhat", () => {
  it("đủ số lần thì đạt", () => {
    const kq = chamCase(
      caseGoc({ goiToolItNhat: { web_fetch: 2 } }),
      qs({ toolDaGoi: ["web_search", "web_fetch", "web_fetch"] }),
    );
    assert.equal(kq.dat, true);
  });

  it("gọi NHIỀU HƠN vẫn đạt - đây là sàn, không phải trần", () => {
    const kq = chamCase(
      caseGoc({ goiToolItNhat: { web_fetch: 2 } }),
      qs({ toolDaGoi: ["web_fetch", "web_fetch", "web_fetch"] }),
    );
    assert.equal(kq.dat, true);
  });

  it("THIẾU một lần là hỏng - đây là chỗ goiTool mù", () => {
    const kq = chamCase(
      caseGoc({ goiToolItNhat: { web_fetch: 2 } }),
      qs({ toolDaGoi: ["web_search", "web_fetch"] }),
    );
    assert.equal(kq.dat, false);
    assert.match(kq.lyDoHong.join(" "), /ít nhất 2 lần, thực tế 1 lần/);
  });

  it("không gọi lần nào cũng hỏng", () => {
    const kq = chamCase(
      caseGoc({ goiToolItNhat: { web_fetch: 1 } }),
      qs({ toolDaGoi: ["web_search"] }),
    );
    assert.equal(kq.dat, false);
  });

  it("case CHỈ khai goiToolItNhat vẫn là case có mong đợi - không bị coi là rỗng", () => {
    // Quên nới bộ chặn "case rỗng" thì case hợp lệ bị báo vô nghĩa
    const kq = chamCase(
      caseGoc({ goiToolItNhat: { web_fetch: 1 } }),
      qs({ toolDaGoi: ["web_fetch"] }),
    );
    assert.equal(kq.dat, true);
    assert.equal(kq.lyDoHong.length, 0);
  });
});

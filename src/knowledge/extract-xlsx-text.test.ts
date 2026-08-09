import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
// Module thuần (chỉ đụng zip/regex) - không chạm env/DB nên import tĩnh được
import { docChuTuFile } from "./doc-text-extract.js";
import { renderXlsx } from "../documents/render-xlsx.js";
import { chuKhoNen, xlsxRong, xlsxTuSheetVaChuoi, zipNhieuEntryVuaDu } from "./ooxml-zip-test-helper.js";

const excelORong = () =>
  fs.readFileSync(new URL("./fixtures/excel-o-rong-co-dinh-dang.xlsx", import.meta.url));

describe("extract-xlsx-text (qua docChuTuFile)", () => {
  it("mỗi hàng thành một dòng chữ, các ô nối bằng ' | '", async () => {
    const buf = await renderXlsx([
      {
        name: "Bảng giá",
        headers: ["Món", "Giá"],
        rows: [[{ kind: "text", value: "Cà phê" }, { kind: "number", value: 25000, format: "plain" }]],
      },
    ]);
    const chu = await docChuTuFile(buf, "xlsx");
    assert.match(chu, /Cà phê \| 25000/);
  });

  it("hàng header cũng đọc ra, không chỉ hàng dữ liệu", async () => {
    const buf = await renderXlsx([
      { name: "Bảng giá", headers: ["Món", "Giá"], rows: [[{ kind: "text", value: "Trà" }, { kind: "number", value: 15000, format: "plain" }]] },
    ]);
    const chu = await docChuTuFile(buf, "xlsx");
    assert.match(chu, /Món \| Giá/);
  });

  it("nhiều sheet đều đọc được, không chỉ sheet đầu", async () => {
    const buf = await renderXlsx([
      { name: "Sheet A", headers: ["X"], rows: [[{ kind: "text", value: "một" }]] },
      { name: "Sheet B", headers: ["Y"], rows: [[{ kind: "text", value: "hai" }]] },
    ]);
    const chu = await docChuTuFile(buf, "xlsx");
    assert.match(chu, /một/);
    assert.match(chu, /hai/);
  });

  it("ô công thức đọc ra GIÁ TRỊ đã tính, không phải chuỗi công thức", async () => {
    const buf = await renderXlsx([
      {
        name: "Báo giá",
        headers: ["SL", "Đơn giá", "Thành tiền"],
        rows: [
          [
            { kind: "number", value: 2, format: "plain" },
            { kind: "number", value: 1500, format: "plain" },
            { kind: "formula", op: "multiply", columns: ["A", "B"] },
          ],
        ],
      },
    ]);
    const chu = await docChuTuFile(buf, "xlsx");
    assert.match(chu, /3000/, "phải ra giá trị đã tính (2 x 1500), không phải '=A2*B2'");
  });

  it("file xlsx hỏng (không phải zip) ném lỗi tiếng Việt đọc được", async () => {
    await assert.rejects(
      () => docChuTuFile(Buffer.from("khong phai file zip"), "xlsx"),
      /không phải file zip/i,
    );
  });
});

describe("extract-xlsx-text - fixture Excel THẬT (src/knowledge/fixtures)", () => {
  it("ô rỗng tự đóng của Excel KHÔNG nuốt ô kế tiếp", async () => {
    // Ca ĐÃ ĐO hỏng ở bản regex cũ: ra "Mon | 1" thay vì "Mon |  | Gia" - số 1
    // là INDEX sharedString bị lộ ra ngoài, không phải chữ thật. Fixture ghi
    // nội dung không dấu ("Mon"/"Gia") - giữ nguyên đúng byte Excel đã ghi,
    // không phải lỗi thiếu dấu tiếng Việt của test.
    const chu = await docChuTuFile(excelORong(), "xlsx");
    const dongDau = chu.split("\n")[0]!;
    assert.match(dongDau, /Mon \|\s*\| Gia/, `hàng đầu đọc ra: ${JSON.stringify(dongDau)}`);
    const dongHai = chu.split("\n")[1]!;
    assert.match(dongHai, /Ca phe \|\s*\| 25000/, `hàng hai đọc ra: ${JSON.stringify(dongHai)}`);
  });

  it("ô rỗng tự đóng Ở CUỐI HÀNG vẫn giữ đúng số cột (không có ô sau để lấp hộ)", async () => {
    // Khác ca trên: fixture Excel thật có ô rỗng NẰM GIỮA hàng, nên cơ chế
    // "lấp cột theo ô kế tiếp" (themOVaoDong khi gặp ô có r= sau đó) tình cờ
    // che luôn cả lỗi thiếu xử lý ô tự đóng. Test này đặt ô rỗng Ở CUỐI - không
    // ô nào phía sau để lấp hộ - mới cô lập ĐÚNG nhánh "ô tự đóng" một mình.
    const buf = xlsxTuSheetVaChuoi(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"/></row>',
      ["X", "Y", "Z"],
    );
    const chu = await docChuTuFile(buf, "xlsx");
    const dong = chu.split("\n");
    assert.equal(dong[0], "X | Y");
    assert.equal(dong[1], "Z | ", `hàng 2 phải giữ đủ 2 cột (ô B rỗng ở cuối): ${JSON.stringify(dong[1])}`);
  });

  it('ô t="s" KHÔNG có <v> (rỗng nhưng không tự đóng) không bịa nội dung từ ô khác', async () => {
    // Ca ĐÃ ĐO hỏng: boDemV === "" -> Number("") === 0 -> lấy NHẦM chuỗi tại
    // index 0 của sharedStrings, dù ô này không hề khai chỉ số nào. Khác ca
    // "ô tự đóng" ở trên: đây là ô KHÔNG tự đóng (<c t="s"></c>, có mở/đóng
    // riêng) nhưng bên trong KHÔNG có <v> - đường code khác, đúng nhánh
    // giaTriOTheoLoai() thay vì nhánh ô tự đóng.
    const buf = xlsxTuSheetVaChuoi(
      '<row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1" t="s"></c></row>',
      ["Bi-mat", "That"],
    );
    const chu = await docChuTuFile(buf, "xlsx");
    assert.equal(chu, "That | ", `ô B1 rỗng không được bịa ra "Bi-mat": ${JSON.stringify(chu)}`);
  });
});

describe("extract-xlsx-text - trần cột Excel (Critical: r= của người ngoài không trần)", () => {
  // Đã đo TRƯỚC khi sửa: chuCotThanhChiSo không kẹp trần, themOVaoDong cấp
  // phát mảng theo chỉ số cột suy từ r= - r="AAAAAAA1" (7 chữ cái) ra hơn 321
  // TRIỆU, khiến vòng lặp lấp cột cấp một mảng 321 triệu phần tử. Với
  // --max-old-space-size=384 (đúng ngân sách container): FATAL ERROR heap
  // out of memory - GIẾT HẲN process, không phải Error bắt được bằng
  // try/catch. Nặng hơn cả ReDoS gốc: ReDoS chỉ khoá event loop rồi process
  // còn sống, cái này giết luôn mọi tài khoản Zalo cùng lúc. Xem B11 (report)
  // cho số đo thật với --max-old-space-size=384 + setInterval.

  it('cột r="AAAAAAA1" (~321 triệu) bị từ chối NGAY, không cấp phát mảng khổng lồ', async () => {
    const buf = xlsxTuSheetVaChuoi(
      '<row r="1"><c r="AAAAAAA1" t="s"><v>0</v></c></row>',
      ["x"],
    );
    await assert.rejects(
      () => docChuTuFile(buf, "xlsx"),
      /vượt quá giới hạn thật của Excel/i,
    );
  });

  it('cột r="AAAAA1" (~475 nghìn, vẫn vượt XFD) KHÔNG để lọt ký tự rác nào vào kết quả', async () => {
    // Ca ĐÃ ĐO hỏng ở mức nhẹ hơn ca trên: không OOM nhưng "OK" một cách sai
    // - 1,4 triệu ký tự đệm (chuỗi rỗng lặp lại do lấp cột) lọt vào kết quả,
    // +6,7 MB RSS. Với chốt mới, PHẢI ném lỗi - không được trả về BẤT KỲ chữ
    // nào (kể cả rỗng có ý nghĩa), vì cả file coi như không đọc được.
    const buf = xlsxTuSheetVaChuoi(
      '<row r="1"><c r="AAAAA1" t="s"><v>0</v></c></row>',
      ["x"],
    );
    await assert.rejects(
      () => docChuTuFile(buf, "xlsx"),
      /vượt quá giới hạn thật của Excel/i,
    );
  });

  it('cột XFD1 (16.384, cột CUỐI CÙNG thật của Excel) vẫn đọc được bình thường - không kẹp nhầm ca hợp lệ', async () => {
    const buf = xlsxTuSheetVaChuoi('<row r="1"><c r="XFD1" t="s"><v>0</v></c></row>', ["Cot cuoi"]);
    const chu = await docChuTuFile(buf, "xlsx");
    assert.match(chu, /Cot cuoi$/);
  });

  it("100.000 hàng ô rỗng ở cột XFD bị từ chối trong dưới 1 giây - trần theo CÔNG CẤP PHÁT, không theo chữ trích ra", async () => {
    // Ca ĐÃ ĐO hỏng: kẹp trần MỘT ô (TRAN_SO_COT_EXCEL, test ở trên) chỉ hạ
    // cấp bug từ "giết process" (OOM fatal) xuống "khoá event loop hàng
    // phút" - CHƯA đóng hẳn. Mỗi hàng chỉ có 1 ô tự đóng ở cột XFD (s=1,
    // không t=) - hàng toàn ô rỗng bị `dongHienTai.some(o => o.trim())` lọc
    // bỏ TRƯỚC khi cộng vào tongKyTu, nên TRAN_TONG_KY_TU_TRICH không bắt
    // được, dù vòng lặp lấp cột (themOVaoDong) vẫn chạy đủ 16.383 lần push
    // MỖI HÀNG. Đo được TRƯỚC khi có TRAN_TONG_SO_O: 100.000 hàng (sheet nén
    // chỉ ~507 KB) -> 21,7 giây khoá event loop, --max-old-space-size=384.
    const hang = '<row><c r="XFD1" s="1"/></row>'.repeat(100_000);
    const buf = xlsxTuSheetVaChuoi(hang, []);
    const t0 = performance.now();
    await assert.rejects(() => docChuTuFile(buf, "xlsx"), /quá nhiều ô/i);
    const tonMs = performance.now() - t0;
    assert.ok(tonMs < 1000, `tốn ${tonMs}ms - phải dưới 1 giây (trước khi sửa: 21 700ms)`);
  });

  it("hàng có cột GIẢM DẦN (XFD1 rồi A1) không hoàn quỹ - BẤT BIẾN: tongO luôn >= số push mảng thật đã chạy", async () => {
    // BẤT BIẾN cần giữ, không phải MỘT chuỗi cụ thể: "không có input nào khiến
    // themOVaoDong() chạy vòng lặp push() thật mà nganSachO.tongO không ghi đủ
    // công đó". Ca trước (test "100.000 hàng ô rỗng") chỉ có 1 ô/hàng nên
    // KHÔNG BAO GIỜ chạm nhánh trừ ra ÂM của `chiSoCot - dongHienTai.length` -
    // không đại diện cho bất biến trên. Ca NÀY xếp 2 ô/hàng theo thứ tự
    // GIẢM (cột 16.384 trước, cột 1 sau) - đúng hình dạng đã đo hỏng: hàng thứ
    // hai "hoàn quỹ" 16.383 dù `themOVaoDong` vẫn chạy đủ vòng lặp push() cho ô
    // XFD1. Trước khi sửa (bỏ Math.max): 100.000 hàng dạng này khoá event loop
    // ~20 giây (đo lại ở báo cáo) mà tongO cuối chỉ = 100.000 (5% trần) -
    // KHÔNG trần nào bắt. Sau khi kẹp sàn 1, mỗi hàng tốn đúng 16.384 + 1 =
    // 16.385 vào tongO -> vượt trần 2.000.000 ngay ở hàng ~123, nên phép thử
    // này phải BỊ TỪ CHỐI RẤT NHANH (không cần dựng đủ 100.000 hàng mới biết).
    const hang = '<row><c r="XFD1" s="1"/><c r="A1" s="1"/></row>'.repeat(100_000);
    const buf = xlsxTuSheetVaChuoi(hang, []);
    const t0 = performance.now();
    await assert.rejects(() => docChuTuFile(buf, "xlsx"), /quá nhiều ô/i);
    const tonMs = performance.now() - t0;
    assert.ok(tonMs < 1000, `tốn ${tonMs}ms - phải dưới 1 giây (trước khi sửa: không bao giờ bị chặn, khoá ~20s)`);
  });
});

describe("extract-xlsx-text - bom và trần an toàn", () => {
  it("tổng giải nén vượt trần bị từ chối dù mỗi entry đều dưới trần", async () => {
    // Trần theo TỪNG entry là chưa đủ: xlsx đọc sharedStrings.xml CỘNG mọi
    // sheet - 4 entry x 20 MB (mỗi entry dưới trần 32 MB) nhưng tổng 80 MB
    // vượt trần archive 64 MB (xem ooxml-zip-test-helper.ts cho lý do chọn
    // 20 MB đóng thẻ đầy đủ thay vì để hở).
    await assert.rejects(
      () => docChuTuFile(zipNhieuEntryVuaDu(), "xlsx"),
      /vượt quá giới hạn/i,
    );
  });

  it("xlsx toàn ô rỗng NÉM lỗi", async () => {
    await assert.rejects(() => docChuTuFile(xlsxRong(), "xlsx"), /không đọc được chữ nào/i);
  });

  it("chữ trích ra vượt trần 8 MB (xlsx) bị từ chối với thông báo ĐÚNG NGHĨA, KHÔNG bị dán nhãn sai 'XML không hợp lệ'", async () => {
    // Cùng lỗ hổng như phía docx (TRAN_TONG_KY_TU_TRICH không có test, lỗi bị
    // dán nhãn sai) nhưng ĐƯỜNG CODE khác hẳn (xlsx-sax-sheet-builder.ts, kiểm
    // ở </row> chứ không phải ở </w:p>) - cần test riêng, không dùng chung
    // bằng chứng với phía docx.
    const buf = xlsxTuSheetVaChuoi(
      `<row r="1"><c r="A1" t="inlineStr"><is><t>${chuKhoNen(8.5 * 1024 * 1024)}</t></is></c></row>`,
      [],
    );
    await assert.rejects(() => docChuTuFile(buf, "xlsx"), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /vượt quá giới hạn 8 MB/i);
      assert.doesNotMatch(err.message, /XML không hợp lệ/i, "không được dán nhãn sai là lỗi cú pháp XML");
      return true;
    });
  });
});

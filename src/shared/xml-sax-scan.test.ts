import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Module thuần (chỉ đụng saxes) - không chạm env/DB nên import tĩnh được
import { quetXmlTheoLuong } from "./xml-sax-scan.js";

const WORDML_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

async function* tuChuoi(...chunks: string[]): AsyncGenerator<string> {
  for (const c of chunks) yield c;
}

describe("xml-sax-scan - gộp chunk, khớp namespace", () => {
  it("gộp đúng khi 1 node bị chunk cắt làm đôi giữa chừng", async () => {
    // Đây chính là lý do chuVanBan CÓ THỂ gọi nhiều lần cho 1 node - mô
    // phỏng ranh giới chunk từ zip-stream-entry.ts cắt ngay giữa chữ.
    let chu = "";
    await quetXmlTheoLuong(tuChuoi(`<w:t xmlns:w="${WORDML_NS}">Xin ch`, "ào tất cả</w:t>"), {
      chuVanBan: (t) => (chu += t),
    });
    assert.equal(chu, "Xin chào tất cả");
  });

  it("khớp thẻ theo NAMESPACE URI, không phụ thuộc prefix hay namespace mặc định", async () => {
    const uris: string[] = [];
    for (const xml of [
      `<w:t xmlns:w="${WORDML_NS}">a</w:t>`, // prefix w:
      `<la:t xmlns:la="${WORDML_NS}">a</la:t>`, // prefix lạ
      `<t xmlns="${WORDML_NS}">a</t>`, // namespace mặc định, không prefix
    ]) {
      await quetXmlTheoLuong(tuChuoi(xml), { moThe: (tag) => uris.push(tag.uri) });
    }
    assert.deepEqual(uris, [WORDML_NS, WORDML_NS, WORDML_NS]);
  });

  it("CDATA phát qua sự kiện cdata riêng, không lẫn vào chuVanBan", async () => {
    let text = "";
    let cdata = "";
    await quetXmlTheoLuong(tuChuoi("<r>chu<![CDATA[<tho>]]></r>"), {
      chuVanBan: (t) => (text += t),
      cdata: (t) => (cdata += t),
    });
    assert.equal(text, "chu");
    assert.equal(cdata, "<tho>");
  });

  it("thẻ tự đóng phát cả moThe LẪN dongThe, liền nhau", async () => {
    const goi: string[] = [];
    await quetXmlTheoLuong(tuChuoi("<a><b/></a>"), {
      moThe: (t) => goi.push(`mo:${t.local}`),
      dongThe: (t) => goi.push(`dong:${t.local}(${t.isSelfClosing})`),
    });
    assert.deepEqual(goi, ["mo:a", "mo:b", "dong:b(true)", "dong:a(false)"]);
  });
});

describe("xml-sax-scan - trần độ sâu + dịch lỗi", () => {
  it("độ sâu vượt trần 256 bị từ chối, ném đúng câu 'lồng quá sâu'", async () => {
    const xml = "<r>".repeat(300);
    await assert.rejects(() => quetXmlTheoLuong(tuChuoi(xml), {}), /lồng quá sâu/i);
  });

  it("XML sai cú pháp (thẻ đóng không khớp) bị dịch sang câu 'XML không hợp lệ'", async () => {
    await assert.rejects(
      () => quetXmlTheoLuong(tuChuoi("<a><b></a></b>"), {}),
      /XML không hợp lệ/i,
    );
  });

  it("lỗi ném từ chính nguồn chunk (ví dụ trần zip-stream-entry.ts) KHÔNG bị bọc lại", async () => {
    // Chứng minh ranh giới lớp: quetXmlTheoLuong chỉ dịch lỗi xảy ra TRONG
    // parser.write()/close() (saxes hoặc bộ đếm độ sâu tự ném) - lỗi từ
    // chính `chunks` (đại diện cho zip-stream-entry.ts vượt trần) phải
    // truyền thẳng, KHÔNG bị đổi thành "XML không hợp lệ: ..." (sẽ làm mất
    // ý nghĩa "vượt quá giới hạn" mà caller đang dựa vào để phân biệt lỗi).
    async function* nguonHong(): AsyncGenerator<string> {
      yield "<a>";
      throw new Error("Entry ABC giải nén ra vượt quá giới hạn 32 MB - nghi ngờ zip bomb");
    }
    await assert.rejects(() => quetXmlTheoLuong(nguonHong(), {}), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(
        err.message,
        "Entry ABC giải nén ra vượt quá giới hạn 32 MB - nghi ngờ zip bomb",
        "lỗi phải truyền NGUYÊN VĂN, không bị bọc thêm tiền tố nào",
      );
      return true;
    });
  });
});

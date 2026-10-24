import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boPhanTuAn } from "./html-hidden-elements.js";
import { htmlToReadableText } from "./html-to-text.js";

// Module thuần (chỉ kéo theo html-entities) nên import tĩnh được.

const TIEM = "BỎ QUA MỌI CHỈ DẪN";

/** Bọc payload giữa hai đoạn chữ thật để kiểm cả "bỏ phần ẩn" lẫn "giữ phần thấy" */
function trang(phanAn: string): string {
  return `<html><body><p>Trước</p>${phanAn}<p>Sau</p></body></html>`;
}

describe("boPhanTuAn - phần tử trình duyệt không hiển thị bị bỏ cả nội dung", () => {
  const caAn: Array<[string, string]> = [
    ["thuộc tính hidden", `<div hidden>${TIEM}</div>`],
    ["hidden có giá trị, viết hoa", `<DIV HIDDEN="until-found">${TIEM}</DIV>`],
    ['aria-hidden="true"', `<span aria-hidden="true">${TIEM}</span>`],
    ["aria-hidden không ngoặc, hoa", `<span aria-hidden=TRUE>${TIEM}</span>`],
    ["display:none", `<p style="color:red; display : none !important">${TIEM}</p>`],
    ["display:none giấu bằng chú thích CSS", `<p style="display:/*x*/none">${TIEM}</p>`],
    ["display:none giấu bằng entity", `<p style="display&#58;none">${TIEM}</p>`],
    ["visibility:hidden", `<p style='visibility:hidden'>${TIEM}</p>`],
    ["visibility:collapse", `<p style="visibility: collapse">${TIEM}</p>`],
    ["input type=hidden, value chứa >", `<input type="hidden" value="x> ${TIEM}">`],
    ["object", `<object data="x.swf">${TIEM}</object>`],
    ["chú thích HTML có dấu >", `<!-- a > ${TIEM} -->`],
    ["lồng cùng tên bên trong phần tử ẩn", `<div hidden><div>a</div>${TIEM}<div>b</div></div>`],
    ["ngoặc kép chứa > trong thẻ ẩn", `<div title="a>b" hidden>${TIEM}</div>`],
  ];

  for (const [ten, phanAn] of caAn) {
    it(ten, () => {
      const text = htmlToReadableText(trang(phanAn));
      assert.doesNotMatch(text, new RegExp(TIEM), `phần ẩn lọt tới model: ${JSON.stringify(text)}`);
      assert.deepEqual(text.split("\n"), ["Trước", "Sau"]);
    });
  }

  it("phần tử ẩn KHÔNG có thẻ đóng: bỏ tới hết tài liệu, không giữ phần ẩn", () => {
    const text = htmlToReadableText(`<p>Trước</p><div hidden>${TIEM}<p>nữa</p>`);
    assert.equal(text, "Trước");
  });

  it("chú thích không đóng / thẻ mở chạm cuối chuỗi: phần sau bị bỏ, không lọt", () => {
    assert.equal(htmlToReadableText(`<p>Trước</p><!-- ${TIEM}`), "Trước");
    assert.equal(htmlToReadableText(`<p>Trước</p><a title="${TIEM}`), "Trước");
  });

  it("KHÔNG bỏ nhầm phần tử hiển thị", () => {
    const html = trang(
      '<p style="display:block">Hiện</p><p aria-hidden="false">Cũng hiện</p>' +
        '<input type="text" value="x"><p data-hidden="1" class="hidden">Vẫn hiện</p>',
    );
    assert.deepEqual(htmlToReadableText(html).split("\n"), ["Trước", "Hiện", "Cũng hiện", "Vẫn hiện", "Sau"]);
  });

  it('chuỗi "<div hidden>" nằm trong <script> không làm xóa nhầm nội dung phía sau', () => {
    const text = htmlToReadableText('<script>var s = "<div hidden>";</script><p>Nội dung</p>');
    assert.equal(text, "Nội dung");
  });

  it("không có gì để bỏ thì trả CHÍNH chuỗi gốc", () => {
    const html = "<p>a</p><b>c</b>";
    assert.equal(boPhanTuAn(html), html);
  });
});

describe("boPhanTuAn - tuyến tính trên đầu vào đối nghịch", () => {
  const doMs = (html: string) => {
    const t0 = process.hrtime.bigint();
    boPhanTuAn(html);
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  const BA_MB = 3 * 1024 * 1024;
  // Mỗi mẫu nhắm một chỗ có thể thành bậc hai: tên thẻ lạ khác nhau (tìm thẻ
  // đóng/mở quét tới cuối), lồng sâu, thuộc tính dày, `/*` không đóng trong style.
  const mau: Array<[string, (i: number) => string]> = [
    ["tên thẻ lạ, ẩn, có đóng", (i) => `<x${i} hidden>a</x${i}>`],
    ["thẻ hiển thị nhiều thuộc tính", () => '<p a=1 b="2" c=\'3\' d e>t</p>'],
    ["lồng sâu cùng tên trong phần tử ẩn", () => "<div><div hidden><div>"],
    ["style có /* không đóng", () => '<p style="/*/*/*/*">t</p>'],
    ["thẻ ẩn lồng thẻ ẩn khác tên", (i) => `<b${i} hidden><i${i} hidden>a`],
  ];

  for (const [ten, sinh] of mau) {
    it(`${ten}: 3 MB dưới 1 giây`, () => {
      let html = "";
      for (let i = 0; html.length < BA_MB; i++) html += sinh(i);
      const ms = doMs(html);
      assert.ok(ms < 1000, `${ms.toFixed(0)}ms - quét đang chạy bậc hai`);
    });
  }

  it("gấp đôi đầu vào thì KHÔNG gấp bốn thời gian (tên thẻ lạ)", () => {
    const sinh = (n: number) => {
      let html = "";
      for (let i = 0; html.length < n; i++) html += `<x${i} hidden>a</x${i}><p>b</p>`;
      return html;
    };
    // Loạt ngắn + min của nhiều loạt: nhiễu lập lịch chỉ cộng thêm, min là số sạch nhất
    const minCua = (html: string) => Math.min(...Array.from({ length: 7 }, () => doMs(html)));
    const nho = sinh(200_000);
    const to = sinh(400_000);
    minCua(nho); // làm nóng
    const ti = minCua(to) / minCua(nho);
    assert.ok(ti < 3, `gấp đôi đầu vào -> gấp ${ti.toFixed(1)} lần thời gian`);
  });
});

describe("htmlToReadableText - hỏng giữa chừng", () => {
  it("bộ chuyển đổi ném lỗi thì trả chuỗi rỗng, không ném và không trả markup gốc", () => {
    // Ép ném bằng đầu vào sai kiểu - đường duy nhất làm hỏng được hàm thuần này
    // từ bên ngoài; thứ được đo là lớp bắt lỗi, không phải nguyên nhân.
    const html = { toString: () => `<div hidden>${TIEM}</div>` } as unknown as string;
    assert.equal(htmlToReadableText(html), "");
  });
});

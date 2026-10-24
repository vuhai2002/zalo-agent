import { decodeHtmlEntities } from "./html-entities.js";

/**
 * Bỏ phần tử HTML mà trình duyệt KHÔNG hiển thị (cả thẻ lẫn nội dung bên trong)
 * trước khi `web_fetch` đưa chữ của trang cho model.
 *
 * Vì sao: người lạ gửi một link trỏ về trang của họ, model gọi `web_fetch`. Chữ
 * giấu trong `<div hidden>` hay `style="display:none"` thì người xem trang không
 * thấy, chủ bot mở link kiểm tra cũng không thấy - nhưng bản bóc thẻ trần vẫn
 * đưa nó tới model nguyên vẹn. Đó là chỗ đặt chỉ thị tiêm lý tưởng.
 *
 * Bắt: thuộc tính `hidden`, `aria-hidden="true"`, `style` có `display:none` /
 * `visibility:hidden|collapse`, `<input type="hidden">`, chú thích `<!-- -->`.
 * Ẩn bằng CLASS (CSS
 * ngoài) thì KHÔNG bắt được nếu không chạy CSS - ngoài phạm vi, đã biết.
 *
 * QUÉT TUYẾN TÍNH, không regex lồng lượng từ (bài học ReDoS ở
 * `boTheKhongNoiDung`): con trỏ chỉ tiến; gặp chỗ không kết thúc được (ngoặc
 * kép không đóng, phần tử ẩn không có thẻ đóng) thì DỪNG HẲN thay vì thử lại
 * từ vị trí kế tiếp.
 */

/** Ký tự ngay sau tên thẻ phải KHÔNG phải chữ/số - thay cho `\b` của regex */
export function ketThucTenThe(html: string, sau: number): boolean {
  const c = html[sau];
  return c === undefined || !/[A-Za-z0-9]/.test(c);
}

/** Thẻ rỗng (void): không có nội dung, không có thẻ đóng - bỏ mỗi thẻ là đủ */
const THE_RONG = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

const KHOANG_TRANG = /\s/;
const KY_TU_TEN_THE = /[A-Za-z0-9-]/;

type TheMo = { ten: string; het: number; thuocTinh: Map<string, string> };

/**
 * Đọc một thẻ mở bắt đầu ở `i` (ngay ký tự `<`). Tôn trọng ngoặc kép trong giá
 * trị thuộc tính (`title="a>b"` không kết thúc thẻ). Trả `null` khi chạm cuối
 * chuỗi mà chưa thấy `>` - caller dừng hẳn, không thử lại.
 */
function docTheMo(html: string, i: number): TheMo | null {
  const n = html.length;
  let j = i + 1;
  while (j < n && KY_TU_TEN_THE.test(html[j]!)) j++;
  const ten = html.slice(i + 1, j).toLowerCase();
  const thuocTinh = new Map<string, string>();
  for (;;) {
    while (j < n && (KHOANG_TRANG.test(html[j]!) || html[j] === "/")) j++;
    if (j >= n) return null;
    if (html[j] === ">") return { ten, het: j, thuocTinh };
    const dauTen = j;
    j++; // ký tự đầu luôn thuộc tên (kể cả "=" lạc) - bảo đảm luôn tiến
    while (j < n && !/[\s/>=]/.test(html[j]!)) j++;
    const tenTT = html.slice(dauTen, j).toLowerCase();
    while (j < n && KHOANG_TRANG.test(html[j]!)) j++;
    let giaTri = "";
    if (html[j] === "=") {
      j++;
      while (j < n && KHOANG_TRANG.test(html[j]!)) j++;
      const q = html[j];
      if (q === '"' || q === "'") {
        const dong = html.indexOf(q, j + 1);
        if (dong === -1) return null;
        giaTri = html.slice(j + 1, dong);
        j = dong + 1;
      } else {
        const dau = j;
        while (j < n && !KHOANG_TRANG.test(html[j]!) && html[j] !== ">") j++;
        giaTri = html.slice(dau, j);
      }
    }
    if (!thuocTinh.has(tenTT)) thuocTinh.set(tenTT, giaTri);
  }
}

/** Bỏ chú thích CSS bằng indexOf - regex lazy `\/\*[\s\S]*?\*\/` thì bậc hai khi `/*` không đóng */
function boChuThichCss(css: string): string {
  let ra = "";
  let i = 0;
  for (;;) {
    const mo = css.indexOf("/*", i);
    if (mo === -1) return ra + css.slice(i);
    ra += css.slice(i, mo);
    const dong = css.indexOf("*/", mo + 2);
    if (dong === -1) return ra;
    i = dong + 2;
  }
}

/** `style` inline có làm phần tử biến mất không. Giá trị thuộc tính được trình duyệt giải entity TRƯỚC khi đọc CSS. */
function styleAnPhanTu(style: string): boolean {
  const css = boChuThichCss(decodeHtmlEntities(style)).toLowerCase().replace(/\s+/g, "");
  return css.split(";").some((khai) => {
    const [thuocTinh, giaTri = ""] = khai.split(":");
    if (thuocTinh === "display") return giaTri.startsWith("none");
    if (thuocTinh === "visibility") return giaTri.startsWith("hidden") || giaTri.startsWith("collapse");
    return false;
  });
}

function laPhanTuAn(the: TheMo): boolean {
  const tt = the.thuocTinh;
  if (tt.has("hidden")) return true;
  if (tt.get("aria-hidden")?.trim().toLowerCase() === "true") return true;
  if (the.ten === "input" && tt.get("type")?.trim().toLowerCase() === "hidden") return true;
  const style = tt.get("style");
  return style !== undefined && styleAnPhanTu(style);
}

/** Tìm `chuoi` từ `tu`, bỏ qua chỗ tên thẻ chỉ là tiền tố (`<divx` khi tìm `<div`) */
function timThe(thap: string, chuoi: string, tu: number): number {
  for (let i = thap.indexOf(chuoi, tu); i !== -1; i = thap.indexOf(chuoi, i + chuoi.length)) {
    if (ketThucTenThe(thap, i + chuoi.length)) return i;
  }
  return -1;
}

/**
 * Vị trí ngay SAU thẻ đóng khớp với phần tử `ten` mở xong ở `tu`, có đếm lồng
 * cùng tên. -1 nếu không có. Chỉ đếm thẻ mở NẰM TRONG đoạn tới thẻ đóng kế tiếp
 * (cắt `slice` trước khi tìm): tìm thẳng trên cả chuỗi thì với tên thẻ lạ, mỗi
 * phần tử lại quét tới cuối tài liệu - bậc hai.
 */
function sauTheDongKhop(thap: string, ten: string, tu: number): number {
  let sau = 1;
  let pos = tu;
  while (sau > 0) {
    const iDong = timThe(thap, `</${ten}`, pos);
    if (iDong === -1) return -1;
    const doan = thap.slice(pos, iDong);
    for (let k = timThe(doan, `<${ten}`, 0); k !== -1; k = timThe(doan, `<${ten}`, k + 1)) sau++;
    sau--;
    const het = thap.indexOf(">", iDong);
    if (het === -1) return -1;
    pos = het + 1;
  }
  return pos;
}

export function boPhanTuAn(html: string): string {
  const thap = html.toLowerCase();
  let ra = "";
  let cat = 0; // đã ghi ra tới đâu
  let i = 0;
  for (;;) {
    i = html.indexOf("<", i);
    if (i === -1) break;
    // Hai chỗ "không bao giờ kết thúc" dưới đây (chú thích không đóng, thẻ mở
    // chạm cuối chuỗi) trình duyệt đều KHÔNG hiển thị phần còn lại, nên bỏ luôn
    // tới hết tài liệu chứ không giữ nguyên - giữ là đưa model đúng phần người
    // xem không thấy. Dừng hẳn cũng là thứ giữ cho vòng quét tuyến tính.
    if (html.startsWith("<!--", i)) {
      // Chú thích HTML cũng là chữ người xem không thấy. `stripHtmlTags` cắt
      // tới dấu `>` ĐẦU TIÊN nên `<!-- a > chỉ thị -->` lọt phần sau dấu `>`.
      ra += html.slice(cat, i);
      const het = html.indexOf("-->", i + 4);
      if (het === -1) return ra;
      cat = i = het + 3;
      continue;
    }
    if (!/[A-Za-z]/.test(html[i + 1] ?? "")) {
      i++;
      continue;
    }
    const the = docTheMo(html, i);
    if (!the) return ra + html.slice(cat, i);
    if (!laPhanTuAn(the)) {
      i = the.het + 1;
      continue;
    }
    ra += html.slice(cat, i);
    const sau = THE_RONG.has(the.ten) ? the.het + 1 : sauTheDongKhop(thap, the.ten, the.het + 1);
    // Phần tử ẩn KHÔNG có thẻ đóng: trình duyệt ẩn luôn phần còn lại của khối
    // cha, nên kẻ tấn công chỉ cần bỏ thẻ đóng là lọt nếu ta giữ phần sau. Thiên
    // về xóa: bỏ tới hết tài liệu (trang hỏng tới mức đó thì ra ít chữ, tool tự
    // rơi xuống Jina Reader).
    if (sau === -1) return ra;
    cat = sau;
    i = sau;
  }
  return cat === 0 ? html : ra + html.slice(cat);
}

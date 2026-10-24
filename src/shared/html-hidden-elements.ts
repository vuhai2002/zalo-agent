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

/*
 * Kiểm ký tự bằng MÃ (`charCodeAt`), KHÔNG bằng `regex.test(html[j])`. Đo thật:
 * trang 800 KB toàn `<style>` không đóng, bản dùng regex trên từng ký tự chạy
 * nhanh vài lần gọi đầu rồi chậm 100-400 lần (4-14 GIÂY mỗi lần, phần lớn là GC,
 * lúc có lúc không tùy JIT) - mỗi lần đánh giá một regex LITERAL đặt trong vòng
 * lặp là một đối tượng RegExp mới, cộng chuỗi một ký tự cho `html[j]`, nhân với
 * số ký tự của trang. So mã ký tự thì không cấp phát gì và tất định.
 */

/** `[A-Za-z]` */
function laChuCai(ma: number): boolean {
  return (ma >= 65 && ma <= 90) || (ma >= 97 && ma <= 122);
}

/** `[A-Za-z0-9]` */
function laChuHoacSo(ma: number): boolean {
  return laChuCai(ma) || (ma >= 48 && ma <= 57);
}

/** Đúng tập `\s` của JavaScript (ASCII + khoảng trắng Unicode) - giữ nguyên hành vi bản regex */
function laKhoangTrang(ma: number): boolean {
  return (
    (ma >= 9 && ma <= 13) ||
    ma === 32 ||
    ma === 0xa0 ||
    ma === 0x1680 ||
    (ma >= 0x2000 && ma <= 0x200a) ||
    ma === 0x2028 ||
    ma === 0x2029 ||
    ma === 0x202f ||
    ma === 0x205f ||
    ma === 0x3000 ||
    ma === 0xfeff
  );
}

const MA_GACH_NGANG = 45; // -
const MA_GACH_CHEO = 47; // /
const MA_BANG = 61; // =
const MA_DONG_THE = 62; // >

/** Ký tự ngay sau tên thẻ phải KHÔNG phải chữ/số - thay cho `\b` của regex */
export function ketThucTenThe(html: string, sau: number): boolean {
  return sau >= html.length || !laChuHoacSo(html.charCodeAt(sau));
}

/** Thẻ rỗng (void): không có nội dung, không có thẻ đóng - bỏ mỗi thẻ là đủ */
const THE_RONG = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

type TheMo = { ten: string; het: number; thuocTinh: Map<string, string> };

/**
 * Đọc một thẻ mở bắt đầu ở `i` (ngay ký tự `<`). Tôn trọng ngoặc kép trong giá
 * trị thuộc tính (`title="a>b"` không kết thúc thẻ). Trả `null` khi chạm cuối
 * chuỗi mà chưa thấy `>` - caller dừng hẳn, không thử lại.
 */
function docTheMo(html: string, i: number): TheMo | null {
  const n = html.length;
  let j = i + 1;
  while (j < n && (laChuHoacSo(html.charCodeAt(j)) || html.charCodeAt(j) === MA_GACH_NGANG)) j++;
  const ten = html.slice(i + 1, j).toLowerCase();
  const thuocTinh = new Map<string, string>();
  for (;;) {
    while (j < n && (laKhoangTrang(html.charCodeAt(j)) || html.charCodeAt(j) === MA_GACH_CHEO)) j++;
    if (j >= n) return null;
    if (html.charCodeAt(j) === MA_DONG_THE) return { ten, het: j, thuocTinh };
    const dauTen = j;
    j++; // ký tự đầu luôn thuộc tên (kể cả "=" lạc) - bảo đảm luôn tiến
    while (j < n) {
      const ma = html.charCodeAt(j);
      if (laKhoangTrang(ma) || ma === MA_GACH_CHEO || ma === MA_DONG_THE || ma === MA_BANG) break;
      j++;
    }
    const tenTT = html.slice(dauTen, j).toLowerCase();
    while (j < n && laKhoangTrang(html.charCodeAt(j))) j++;
    let giaTri = "";
    if (html.charCodeAt(j) === MA_BANG) {
      j++;
      while (j < n && laKhoangTrang(html.charCodeAt(j))) j++;
      const q = html[j];
      if (q === '"' || q === "'") {
        const dong = html.indexOf(q, j + 1);
        if (dong === -1) return null;
        giaTri = html.slice(j + 1, dong);
        j = dong + 1;
      } else {
        const dau = j;
        while (j < n && !laKhoangTrang(html.charCodeAt(j)) && html.charCodeAt(j) !== MA_DONG_THE) j++;
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
  // Bản chữ thường chỉ dùng để tìm THẺ ĐÓNG của phần tử ẩn - tính LƯỜI, lần đầu
  // gặp phần tử ẩn. ĐỪNG đưa về đầu hàm. Đo trên bản BIÊN DỊCH (`dist`, đúng thứ
  // chạy trong Docker), 30 lượt liên tiếp trang 400-800 KB toàn `<style>` không
  // đóng đưa qua `htmlToReadableText`: tính sẵn ở đầu hàm thì 69-107 GIÂY (vài
  // lượt đầu nhanh rồi tụt, lượt tệ nhất ~14 s; profiler chỉ đúng dòng
  // `toLowerCase` + GC), tính lười thì ~50 ms - lặp lại 3 lần cùng kết quả,
  // kể cả khi trang có `<div hidden>` buộc phải tính. Nguyên nhân tầng V8 chưa
  // xác định. Runner test (`tsx --test`) KHÔNG tái hiện được ổn định nên không
  // có test canh riêng; chỉ ca "gấp đôi đầu vào" của `html-to-text.test.ts` thỉnh
  // thoảng đỏ khi bệnh quay lại. Muốn đo lại: `pnpm build` rồi lặp
  // `htmlToReadableText` từ `dist/src/shared/html-to-text.js` 40 lần.
  let thapDaTinh: string | undefined;
  const thap = (): string => (thapDaTinh ??= html.toLowerCase());
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
    if (!laChuCai(html.charCodeAt(i + 1))) {
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
    const sau = THE_RONG.has(the.ten) ? the.het + 1 : sauTheDongKhop(thap(), the.ten, the.het + 1);
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

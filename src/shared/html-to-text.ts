import { decodeHtmlEntities } from "./html-entities.js";

/**
 * Rút text đọc được từ HTML cho tool web_fetch - không thêm dependency
 * (readability/cheerio) vì nhu cầu chỉ là "agent đọc lướt nội dung trang".
 *
 * Bài học từ vụ dò vé số: trang tin Việt Nam (minhngoc, xoso...) mở đầu bằng
 * cả nghìn ký tự menu, đẩy nội dung thật ra sau cap của tool -> model chỉ thấy
 * menu và tưởng trang không có dữ liệu. GoClaw giải bằng Defuddle (bóc nội dung
 * chính kiểu Readability); mình dùng phiên bản tối giản của đúng tín hiệu đó:
 * list nào text nằm gần hết trong <a> là menu điều hướng, vứt.
 *
 * Trang render bằng JS sẽ ra ít text - chấp nhận, đó là giới hạn đã biết.
 */

/** Block không bao giờ là nội dung */
const THE_KHONG_NOI_DUNG = [
  "script",
  "style",
  "noscript",
  "svg",
  "header",
  "head",
  "nav",
  "footer",
  "aside",
  "form",
  "select",
  "iframe",
  "template",
];

/** Ký tự ngay sau tên thẻ phải KHÔNG phải chữ/số - thay cho `\b` của regex */
function ketThucTenThe(html: string, sau: number): boolean {
  const c = html[sau];
  return c === undefined || !/[A-Za-z0-9]/.test(c);
}

/**
 * Bỏ một loại thẻ và toàn bộ nội dung bên trong, QUÉT TUYẾN TÍNH.
 *
 * Bản trước dùng regex `<(script|style|...)\b[\s\S]*?<\/\1\s*>`. Mỗi thẻ mở
 * KHÔNG đóng khiến `[\s\S]*?` quét tới hết tài liệu rồi thất bại - O(K x n) với
 * K là số thẻ mở. `web-fetch-tool.ts` cho phép trang 3 MB, và người lạ chỉ cần
 * gửi một link trỏ về server của họ để model gọi `web_fetch`.
 *
 * Đo thật trên trang toàn `<script>` không đóng:
 *
 *     256 KB     474 ms
 *     1 MB     7.107 ms
 *     3 MB    63.310 ms   (đúng trần MAX_HTML_BYTES)
 *
 * Tiến trình này MỘT luồng phục vụ mọi account, vòng tick scheduler và cả HTTP
 * dashboard - hơn một phút đứng hình là cả bot chết.
 *
 * Kẹp trần lượng từ (cách vá quen thuộc) KHÔNG đủ ở đây: vẫn còn O(K x trần),
 * mà K với trang 3 MB lên tới hàng chục nghìn. Nên đổi hẳn thuật toán.
 *
 * Mấu chốt để TUYẾN TÍNH: con trỏ chỉ tiến, và khi không tìm thấy thẻ đóng thì
 * DỪNG HẲN loại thẻ đó - `indexOf` vừa quét tới cuối chuỗi rồi, nên chắc chắn
 * phía sau cũng không còn thẻ đóng nào. Tổng công: mỗi loại thẻ một lượt quét.
 *
 * Thẻ mở không có thẻ đóng thì GIỮ NGUYÊN, `stripHtmlTags` dọn sau - thiên về
 * giữ nhầm hơn xóa nhầm, cùng hướng an toàn với `removeLinkDenseLists`.
 */
function boTheKhongNoiDung(html: string, ten: string): string {
  const thap = html.toLowerCase();
  const mo = `<${ten}`;
  const dong = `</${ten}`;

  let ra = "";
  let cat = 0; // đã ghi ra tới đâu
  let tim = 0; // tìm thẻ mở từ đâu

  for (;;) {
    const iMo = thap.indexOf(mo, tim);
    if (iMo === -1) break;
    if (!ketThucTenThe(thap, iMo + mo.length)) {
      // "<header>" khi đang tìm "<head" - bỏ qua, tìm tiếp từ ngay sau
      tim = iMo + mo.length;
      continue;
    }

    const iDong = thap.indexOf(dong, iMo + mo.length);
    // Không còn thẻ đóng nào phía sau -> dừng hẳn loại thẻ này. ĐÂY là chỗ
    // biến thuật toán từ bậc hai thành tuyến tính.
    if (iDong === -1) break;

    const iHet = thap.indexOf(">", iDong);
    if (iHet === -1) break;

    ra += html.slice(cat, iMo);
    cat = iHet + 1;
    tim = cat;
  }

  return cat === 0 ? html : ra + html.slice(cat);
}

function boMoiTheKhongNoiDung(html: string): string {
  let ra = html;
  for (const ten of THE_KHONG_NOI_DUNG) ra = boTheKhongNoiDung(ra, ten);
  return ra;
}

/**
 * Bóc thẻ HTML + giải mã entity (số lẫn tên - xem html-entities.ts).
 *
 * Ở đây chứ không ở `web-search-providers.ts` như trước: đây là module "HTML ->
 * chữ", còn bên kia là module gọi mạng và có logger. Nhập ngược chiều khiến
 * `html-to-text` (vốn thuần) kéo theo cả logger, và logger đọc `DATA_DIR` lúc
 * nạp module - đủ để test của file thuần này đẻ ra file log trong `data/` thật.
 */
export function stripHtmlTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/** Tỉ lệ text-trong-link tối thiểu để coi 1 list là menu điều hướng */
const MENU_LINK_DENSITY = 0.7;
const MENU_MIN_LINKS = 3;

/**
 * Xóa <ul>/<ol> là menu: >= 3 link và >= 70% chữ nằm trong <a> (list nội dung
 * thật thì chữ chủ yếu nằm ngoài link).
 *
 * Regex chỉ match list TRONG CÙNG (content không chứa thẻ mở list khác) rồi
 * chạy lặp: gỡ menu con xong thì menu cha thành trong cùng và được xét ở lượt
 * sau. Match lazy thường sẽ ăn từ thẻ mở ngoài tới thẻ đóng trong - nuốt mất
 * opener của cha, phần còn lại không bao giờ được xét (bug đã dính khi viết).
 * List con được GIỮ (nội dung thật) thì cha không bao giờ thành trong cùng -
 * thiên về giữ nhầm hơn xóa nhầm, đúng hướng an toàn.
 */
function removeLinkDenseLists(html: string): string {
  const listBlock = /<(ul|ol|menu)\b[^>]*>(?:(?!<(?:ul|ol|menu)\b)[\s\S])*?<\/\1\s*>/gi;
  let current = html;
  for (let pass = 0; pass < 5; pass++) {
    let removedAny = false;
    current = current.replace(listBlock, (block) => {
      const totalText = stripHtmlTags(block);
      if (!totalText) {
        removedAny = true;
        return " ";
      }
      const anchors = [...block.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)];
      const anchorText = anchors.map((m) => stripHtmlTags(m[1]!)).join(" ");
      const isMenu =
        anchors.length >= MENU_MIN_LINKS &&
        anchorText.length / totalText.length >= MENU_LINK_DENSITY;
      if (isMenu) removedAny = true;
      return isMenu ? " " : block;
    });
    if (!removedAny) break;
  }
  return current;
}

/**
 * Gộp thẻ viết tràn nhiều dòng về 1 dòng.
 *
 * Bước cuối của hàm dưới tách dòng TRƯỚC rồi mới bóc thẻ từng dòng, nên thẻ bị
 * xuống dòng giữa chừng không còn khớp `<...>` trên dòng nào cả và lọt nguyên
 * vào text gửi model. Lỗi thật ở tuoitre.vn:
 *
 *     <input onfocus="this.removeAttribute('readonly');" class="input-search"
 *     placeholder="Nhập nội dung cần tìm" />
 *
 * Chỉ đụng phần bên trong `<...>`, nội dung văn bản giữ nguyên. Ràng buộc ký tự
 * đầu là chữ / `/` / `!` để dấu nhỏ hơn trong văn xuôi ("a < b") không bị nhận
 * nhầm là thẻ mở.
 */
function collapseMultilineTags(html: string): string {
  return html.replace(/<[a-zA-Z/!][^>]*>/g, (tag) => tag.replace(/\s+/g, " "));
}

export function htmlToReadableText(html: string): string {
  const withoutBlocks = removeLinkDenseLists(
    boMoiTheKhongNoiDung(collapseMultilineTags(html)),
  );

  // Giữ cấu trúc đoạn: thẻ block phổ biến thành xuống dòng trước khi bóc thẻ
  const withBreaks = withoutBlocks
    // Span liền kề phải có khoảng trắng ở ranh giới: xoso.com.vn bọc MỖI CON SỐ
    // kết quả trong 1 span, bóc thẻ trần sẽ ra "836791064644..." dính chùm -
    // model không cách nào tách lại được. Chỉ xử ranh giới </span><span> nên
    // span đơn lẻ giữa từ (kiểu tô màu 1 chữ) không bị chẻ đôi.
    .replace(/<\/span>\s*<span/gi, "</span> <span")
    // Hàng/ô bảng bám theo thẻ MỞ chứ không phải thẻ đóng: HTML5 cho phép bỏ
    // </td></tr> và xoso.com.vn viết đúng kiểu đó - bám thẻ đóng là cả bảng
    // kết quả dính thành 1 dòng "836791064644...". Thẻ đóng </tr> vẫn giữ cho
    // site viết đủ; dòng rỗng sinh thêm bị filter(Boolean) nuốt.
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|tr\b|\/section|\/article)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    // Ranh giới ô trong bảng: bảng kết quả (xổ số, giá) mà dính chữ liền nhau
    // là model đọc sai cột
    .replace(/<t[dh]\b[^>]*>/gi, " | ");

  // stripHtmlTags nuốt cả \n (collapse \s+) nên tách dòng trước, bóc thẻ từng dòng
  return withBreaks
    .split("\n")
    .map((line) => stripHtmlTags(line))
    .filter(Boolean)
    .join("\n");
}

/** Tiêu đề trang từ thẻ <title> - rỗng nếu không có */
export function extractHtmlTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? stripHtmlTags(match[1]!) : "";
}

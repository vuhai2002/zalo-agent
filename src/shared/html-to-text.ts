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

/**
 * Block không bao giờ là nội dung. Thứ tự "header|head" quan trọng: alternation
 * chọn nhánh đầu khớp trước, để "head" đứng trước thì "<header>" bị khớp dở
 * thành "<head" + phần thừa và regex không đóng được đúng thẻ.
 */
const NON_CONTENT_BLOCKS =
  /<(script|style|noscript|svg|header|head|nav|footer|aside|form|select|iframe|template)\b[\s\S]*?<\/\1\s*>/gi;

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
    collapseMultilineTags(html).replace(NON_CONTENT_BLOCKS, " "),
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

import { stripHtmlTags } from "./web-search-providers.js";

/**
 * Rút text đọc được từ HTML cho tool web_fetch - không thêm dependency
 * (readability/cheerio) vì nhu cầu chỉ là "agent đọc lướt nội dung trang".
 * Trang render bằng JS sẽ ra ít text - chấp nhận, đó là giới hạn đã biết.
 */

/** Bỏ hẳn các block không phải nội dung trước khi bóc thẻ */
const NON_CONTENT_BLOCKS = /<(script|style|noscript|svg|head|nav|footer|iframe|template)[\s\S]*?<\/\1>/gi;

export function htmlToReadableText(html: string): string {
  const withoutBlocks = html.replace(NON_CONTENT_BLOCKS, " ");

  // Giữ cấu trúc đoạn: thẻ block phổ biến thành xuống dòng trước khi bóc thẻ
  const withBreaks = withoutBlocks
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section|\/article)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ");

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

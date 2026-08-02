import { tool } from "ai";
import { z } from "zod";
import { getFetchSettings } from "../../config/runtime-tool-settings.js";
import { extractHtmlTitle, htmlToReadableText } from "../../shared/html-to-text.js";
import { fetchViaJinaReader } from "../../shared/jina-reader-fallback.js";
import { createLogger } from "../../shared/logger.js";
import { downloadFromPublicUrl } from "../../shared/safe-remote-download.js";
import { ketQuaLoi } from "./tool-failure-result.js";
import { wrapUntrustedContent } from "./wrap-untrusted-content.js";
import { getTuning } from "../../config/runtime-tuning-settings.js";

// HTML 3MB là quá đủ cho trang tin/bài viết; cap TRƯỚC khi parse để trang
// khổng lồ không ăn RAM. Text trả cho model cap riêng (WEB_FETCH_MAX_CHARS)
// để không phình context.
const MAX_HTML_BYTES = 3 * 1024 * 1024;

/**
 * Dưới ngưỡng này coi như "fetch được nhưng rỗng" - trang render bằng
 * JavaScript hay ra vài chục ký tự khung sườn. Đáng để thử lại qua Jina.
 */
const TOO_LITTLE_TEXT = 200;

const log = createLogger("web-fetch");

type FetchedPage = { text: string; title: string; via: "truc-tiep" | "jina-reader" };

/** Tự fetch: nhanh, riêng tư, miễn phí. Hỏng thì trả null để rơi xuống lưới đỡ. */
async function fetchDirect(url: string): Promise<FetchedPage | null> {
  try {
    const file = await downloadFromPublicUrl(url, { maxBytes: MAX_HTML_BYTES });
    const isHtml = file.mediaType.includes("html") || file.mediaType === "application/octet-stream";
    const raw = file.data.toString("utf-8");
    const text = isHtml ? htmlToReadableText(raw) : raw.trim();
    if (text.length < TOO_LITTLE_TEXT) {
      log.debug({ url, length: text.length }, "Fetch trực tiếp ra quá ít chữ");
      return null;
    }
    return { text, title: isHtml ? extractHtmlTitle(raw) : "", via: "truc-tiep" };
  } catch (err) {
    log.debug({ url, err }, "Fetch trực tiếp thất bại");
    return null;
  }
}

/**
 * Đọc nội dung 1 URL cho agent theo chuỗi 2 tầng (pattern ExtractorChain của
 * GoClaw): tự fetch trước cho nhanh và riêng tư, hỏng hoặc ra quá ít chữ thì
 * đẩy qua Jina Reader - dịch vụ này render được trang JavaScript và qua được
 * một phần chặn bot.
 *
 * Tầng tự fetch đi qua safe-remote-download nên thừa hưởng toàn bộ guard SSRF.
 * Tầng Jina gửi URL ra bên thứ ba, tắt được bằng WEB_FETCH_FALLBACK_ENABLED.
 */
export function createWebFetchTool() {
  return tool({
    description:
      "Đọc nội dung văn bản của 1 trang web theo URL (http/https công khai). Dùng sau web_search để đọc chi tiết, hoặc khi người dùng gửi link. Trang cần đăng nhập thì không đọc được.",
    inputSchema: z.object({
      url: z.string().url().describe("URL đầy đủ, vd https://example.com/bai-viet"),
    }),
    execute: async ({ url }) => {
      const maxChars = getTuning("WEB_FETCH_MAX_CHARS");

      // Đọc lại mỗi lượt - bật/tắt bậc 2 trên dashboard có hiệu lực ngay
      let page = await fetchDirect(url);
      if (!page && getFetchSettings().fallbackEnabled) {
        const jina = await fetchViaJinaReader(url, { maxChars });
        if (jina) page = { ...jina, via: "jina-reader" };
      }

      if (!page) {
        return ketQuaLoi(
          `Không đọc được trang ${url}. Trang có thể chặn bot hoặc yêu cầu đăng nhập - thử một nguồn khác.`,
        );
      }

      log.info({ url, via: page.via, length: page.text.length }, "Đã đọc trang web");

      const truncated = page.text.length > maxChars;
      const body = truncated
        ? `${page.text.slice(0, maxChars)}\n[...đã cắt bớt, trang còn dài]`
        : page.text;

      return wrapUntrustedContent(body, `${url}${page.title ? ` - ${page.title}` : ""}`);
    },
  });
}

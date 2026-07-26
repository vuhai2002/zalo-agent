import { createLogger } from "./logger.js";

/**
 * Lưới đỡ khi tự fetch không lấy được nội dung: đẩy URL qua Jina Reader
 * (r.jina.ai) - dịch vụ render trang rồi trả markdown sạch.
 *
 * Vì sao cần (đo thực tế trên đúng các trang bot đã thất bại):
 * - giavang.doji.vn: tự fetch ECONNRESET, qua Jina ra nội dung (trang render JS)
 * - vnexpress.net: tự fetch 406, qua Jina ra 40k ký tự
 * Đây đúng pattern của GoClaw (ExtractorChain: Defuddle hosted trước, bóc
 * in-process sau) và Hermes (Firecrawl gateway trước, provider khác sau).
 *
 * Đánh đổi phải biết:
 * - Chậm: đo được 1,2s tới 15,8s (tự fetch tính bằng trăm ms)
 * - URL bị gửi qua bên thứ ba -> tắt được bằng WEB_FETCH_FALLBACK_ENABLED
 * - Không key thì có rate limit; site sau Cloudflare vẫn chặn (Jina trả
 *   nguyên văn "Warning: Target URL returned error 403")
 *
 * Module thuần, không import env - caller truyền cấu hình vào.
 */

const log = createLogger("jina-reader");
const ENDPOINT = "https://r.jina.ai/";
const TIMEOUT_MS = 45_000;

/** Jina trả 200 kèm dòng cảnh báo này khi trang đích vẫn chặn nó */
const UPSTREAM_BLOCKED = /^Warning: Target URL returned error \d+/m;

export type JinaFetchOptions = {
  maxChars: number;
  /** Key tuỳ chọn - có key thì hạn mức cao hơn, không có vẫn chạy */
  apiKey?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
};

export type JinaResult = { text: string; title: string };

/** Jina trả "Title: ...\nURL Source: ...\n\nMarkdown Content:\n<nội dung>" */
export function parseJinaResponse(body: string): JinaResult {
  const title = /^Title:\s*(.+)$/m.exec(body)?.[1]?.trim() ?? "";
  const marker = body.indexOf("Markdown Content:");
  const text = marker >= 0 ? body.slice(marker + "Markdown Content:".length).trim() : body.trim();
  return { text, title };
}

/**
 * Trả null (không throw) khi hỏng - caller đang ở nhánh lưới đỡ, hỏng thêm
 * lần nữa thì chỉ việc báo thật cho model.
 */
export async function fetchViaJinaReader(
  url: string,
  options: JinaFetchOptions,
): Promise<JinaResult | null> {
  const doFetch = options.fetchFn ?? fetch;
  try {
    const res = await doFetch(`${ENDPOINT}${url}`, {
      headers: {
        Accept: "text/plain",
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    });
    if (!res.ok) {
      log.debug({ url, status: res.status }, "Jina Reader trả lỗi");
      return null;
    }

    const body = await res.text();
    // Jina trả HTTP 200 kể cả khi trang đích chặn NÓ - phải tự soi dòng cảnh báo
    if (UPSTREAM_BLOCKED.test(body)) {
      log.debug({ url }, "Trang đích chặn cả Jina Reader");
      return null;
    }

    const parsed = parseJinaResponse(body);
    if (!parsed.text) return null;
    return {
      title: parsed.title,
      text: parsed.text.length > options.maxChars ? parsed.text.slice(0, options.maxChars) : parsed.text,
    };
  } catch (err) {
    log.debug({ url, err }, "Gọi Jina Reader thất bại");
    return null;
  }
}

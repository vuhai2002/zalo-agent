import { stripHtmlTags } from "./html-to-text.js";
import { createLogger } from "./logger.js";

/**
 * Web search cho agent theo pattern chuỗi provider của GoClaw/Hermes:
 * Brave trước khi có key (kết quả tốt hơn, free tier 2000 query/tháng),
 * DuckDuckGo LUÔN đứng cuối - không cần key, nên web search không bao giờ
 * "chưa cấu hình". Provider lỗi thì rơi xuống provider sau, không ném ra agent.
 *
 * `fetchFn` tiêm được để test không chạm mạng thật.
 */

const log = createLogger("web-search");

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DDG_ENDPOINT = "https://html.duckduckgo.com/html/";
// DDG chặn UA rỗng/lạ; UA trình duyệt phổ thông là đủ
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TIMEOUT_MS = 10_000;

export type SearchResult = { title: string; url: string; snippet: string };

export type SearchOptions = {
  maxResults: number;
  braveApiKey?: string;
  fetchFn?: typeof fetch;
};

/**
 * DDG bọc link kết quả qua trang redirect: /l/?uddg=<url-encoded>&rut=...
 * Bóc URL thật ra để agent không phải đi vòng.
 */
export function unwrapDdgRedirect(rawUrl: string): string {
  if (!rawUrl.includes("uddg=")) return rawUrl;
  try {
    const decoded = decodeURIComponent(rawUrl);
    const after = decoded.split("uddg=")[1];
    if (!after) return rawUrl;
    const amp = after.indexOf("&");
    return amp === -1 ? after : after.slice(0, amp);
  } catch {
    return rawUrl;
  }
}

/** Parse HTML kết quả DDG (selector result__a / result__snippet như GoClaw dùng) */
export function parseDdgHtml(html: string, maxResults: number): SearchResult[] {
  const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]*class="result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

  const snippets = [...html.matchAll(snippetRe)].map((m) => stripHtmlTags(m[1]!));
  const results: SearchResult[] = [];
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html)) !== null && results.length < maxResults) {
    results.push({
      title: stripHtmlTags(match[2]!),
      url: unwrapDdgRedirect(match[1]!),
      snippet: snippets[results.length] ?? "",
    });
  }
  return results;
}

async function fetchWithTimeout(fetchFn: typeof fetch, url: string, init: RequestInit) {
  return fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

async function searchBrave(query: string, opts: SearchOptions): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, count: String(opts.maxResults) });
  const res = await fetchWithTimeout(opts.fetchFn ?? fetch, `${BRAVE_ENDPOINT}?${params}`, {
    headers: { Accept: "application/json", "X-Subscription-Token": opts.braveApiKey! },
  });
  if (!res.ok) throw new Error(`Brave API trả HTTP ${res.status}`);

  const body = (await res.json()) as {
    web?: { results?: { title?: string; url?: string; description?: string }[] };
  };
  return (body.web?.results ?? [])
    .filter((r) => r.url)
    .slice(0, opts.maxResults)
    .map((r) => ({
      title: stripHtmlTags(r.title ?? ""),
      url: r.url!,
      snippet: stripHtmlTags(r.description ?? ""),
    }));
}

async function searchDuckDuckGo(query: string, opts: SearchOptions): Promise<SearchResult[]> {
  // PHẢI là POST form: GET trần bị DDG trả 202 + trang challenge (kiểm chứng
  // 07/2026). POST là cách form HTML chính thức của trang này submit - vẫn là
  // endpoint public cho client không chạy JS.
  const res = await fetchWithTimeout(opts.fetchFn ?? fetch, DDG_ENDPOINT, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    },
    body: new URLSearchParams({ q: query, b: "" }).toString(),
  });
  if (!res.ok) throw new Error(`DuckDuckGo trả HTTP ${res.status}`);
  return parseDdgHtml(await res.text(), opts.maxResults);
}

/**
 * Chuỗi tìm kiếm: Brave (khi có key) -> DuckDuckGo. Trả mảng rỗng khi mọi
 * provider đều lỗi - caller (tool) tự diễn giải cho model, không throw.
 */
export async function searchWeb(query: string, opts: SearchOptions): Promise<SearchResult[]> {
  if (opts.braveApiKey) {
    try {
      const results = await searchBrave(query, opts);
      if (results.length > 0) return results;
      log.debug({ query }, "Brave không có kết quả - thử DuckDuckGo");
    } catch (err) {
      log.warn({ err }, "Brave search lỗi - rơi về DuckDuckGo");
    }
  }

  try {
    return await searchDuckDuckGo(query, opts);
  } catch (err) {
    log.warn({ err }, "DuckDuckGo search lỗi");
    return [];
  }
}

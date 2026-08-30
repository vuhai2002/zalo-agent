import { readFileSync } from "node:fs";
import { getTuning } from "../config/runtime-tuning-settings.js";

/**
 * Kiểm tra GitHub Releases xem có bản phát hành mới hơn bản đang chạy không, để
 * chân sidebar hiện nút "Cập nhật". Việc so sánh với bản đang chạy nằm ở PHÍA
 * CLIENT (nó đã có `__APP_VERSION__` nhúng lúc build) - module này chỉ lấy bản
 * mới nhất trên GitHub. Tất cả đều fail-soft: có sự cố thì trả `latest: null`,
 * dashboard không bao giờ bị chặn vì một lời nhắc cập nhật.
 */
export type ThongTinBanMoi = {
  /** false khi người vận hành tắt kiểm tra ở trang Cấu hình */
  enabled: boolean;
  /** Tag mới nhất đã bỏ tiền tố "v" (vd "0.3.0"); null nếu chưa lấy được */
  latest: string | null;
  /** URL trang release TỰ DỰNG, không lấy từ response GitHub */
  releaseUrl: string | null;
};

type OwnerRepo = { owner: string; repo: string };

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "zalo-agent-update-check";
const FETCH_TIMEOUT_MS = 5000;
const TTL_THANH_CONG_MS = 6 * 60 * 60 * 1000; // 6h: bản phát hành cả tuần mới đổi
const TTL_LOI_MS = 30 * 60 * 1000; // hỏng thì thử lại sớm hơn, nhưng không dồn dập

let cache: { luc: number; ttl: number; kq: ThongTinBanMoi } | null = null;
let dangChay: Promise<ThongTinBanMoi> | null = null; // single-flight: nhiều tab không gọi song song
let ownerRepoCache: OwnerRepo | null | undefined; // undefined = chưa đọc, null = đọc hỏng

/**
 * Đọc owner/repo từ `package.json` MỘT LẦN. Không hardcode "vuhai2002/zalo-agent"
 * (một nguồn sự thật, theo được nếu repo đổi chủ). Dùng đúng kỹ thuật của
 * `web/vite.config.ts`: `new URL("../../package.json", import.meta.url)` -> repo
 * root khi chạy dev (src/server/) và app root khi chạy bản biên dịch (dist/server/).
 */
function docOwnerRepo(): OwnerRepo | null {
  if (ownerRepoCache !== undefined) return ownerRepoCache;
  ownerRepoCache = null;
  try {
    const noiDung = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(noiDung) as { repository?: { url?: string } | string };
    const url = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    const khop = url?.match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
    if (khop) ownerRepoCache = { owner: khop[1], repo: khop[2] };
  } catch {
    // fail-soft: đọc không được thì tính năng tự tắt (không có nút), không ném
  }
  return ownerRepoCache;
}

export type LayBanMoiOpts = {
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Tiêm owner/repo cho test; bỏ trống thì đọc từ package.json */
  ownerRepo?: OwnerRepo | null;
};

export async function layBanMoiNhat(opts: LayBanMoiOpts = {}): Promise<ThongTinBanMoi> {
  const now = opts.now ?? Date.now;
  if (!getTuning("UPDATE_CHECK_ENABLED")) {
    return { enabled: false, latest: null, releaseUrl: null };
  }
  if (cache && now() - cache.luc < cache.ttl) return cache.kq;
  if (dangChay) return dangChay;

  dangChay = timNguoi(opts, now).finally(() => {
    dangChay = null;
  });
  return dangChay;
}

async function timNguoi(opts: LayBanMoiOpts, now: () => number): Promise<ThongTinBanMoi> {
  const or = opts.ownerRepo !== undefined ? opts.ownerRepo : docOwnerRepo();
  const kq = await goiGitHub(opts.fetchFn ?? fetch, or);
  // Hỏng thì cache ngắn (thử lại sớm), thành công thì cache dài (đỡ rate limit)
  cache = { luc: now(), ttl: kq.latest ? TTL_THANH_CONG_MS : TTL_LOI_MS, kq };
  return kq;
}

async function goiGitHub(fetchFn: typeof fetch, or: OwnerRepo | null): Promise<ThongTinBanMoi> {
  if (!or) return { enabled: true, latest: null, releaseUrl: null };
  try {
    const res = await fetchFn(`${GITHUB_API}/repos/${or.owner}/${or.repo}/releases/latest`, {
      headers: {
        "User-Agent": USER_AGENT, // GitHub trả 403 nếu thiếu
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { enabled: true, latest: null, releaseUrl: null };
    const data = (await res.json()) as { tag_name?: unknown };
    const tag = typeof data.tag_name === "string" ? data.tag_name : null;
    if (!tag) return { enabled: true, latest: null, releaseUrl: null };
    // releaseUrl TỰ DỰNG từ owner/repo/tag - không tin `html_url` trong response
    const releaseUrl = `https://github.com/${or.owner}/${or.repo}/releases/tag/${encodeURIComponent(tag)}`;
    return { enabled: true, latest: tag.replace(/^v/i, ""), releaseUrl };
  } catch {
    return { enabled: true, latest: null, releaseUrl: null };
  }
}

/** Chỉ dùng trong test: xóa cache để mỗi ca độc lập. */
export function _resetCacheChoTest(): void {
  cache = null;
  dangChay = null;
  ownerRepoCache = undefined;
}

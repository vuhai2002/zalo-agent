import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
// Trần thời gian chờ khi lần fetch HỎNG: thử lại sớm hơn (không đợi trọn nhịp),
// nhưng không dồn dập. Nhịp lúc THÀNH CÔNG đọc từ tuning
// UPDATE_CHECK_INTERVAL_MINUTES (chỉnh nóng trên trang Cấu hình).
const TTL_LOI_MS = 30 * 60 * 1000;

let cache: { luc: number; ttl: number; kq: ThongTinBanMoi } | null = null;
let dangChay: Promise<ThongTinBanMoi> | null = null; // single-flight: nhiều tab không gọi song song
let ownerRepoCache: OwnerRepo | null | undefined; // undefined = chưa đọc, null = đọc hỏng

/**
 * Tìm package.json bằng cách đi NGƯỢC từ `startDir` lên thư mục cha tới khi gặp,
 * KHÔNG cứng hoá số cấp `../`. Đây là chỗ đã trả giá thật: layout dev
 * (`src/server/update-check.ts`) và layout BIÊN DỊCH chạy trong Docker
 * (`dist/src/server/update-check.js`, package.json ở `/app`) lệch nhau một cấp
 * thư mục. Đường dẫn cứng `../../package.json` đúng ở dev nhưng trong Docker trỏ
 * vào `/app/dist/package.json` KHÔNG tồn tại -> readFileSync ném -> nuốt lặng ->
 * không biết owner/repo -> KHÔNG BAO GIỜ hỏi GitHub (`latest` mãi null, không
 * hiện nút). Test cũ chạy bằng tsx (layout dev) nên mù; test mới dựng thư mục giả
 * cả hai layout. Hàm THUẦN để test được.
 */
export function timDuongPackageJson(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const p = join(dir, "package.json");
    if (existsSync(p)) return p;
    const cha = dirname(dir);
    if (cha === dir) break; // chạm gốc hệ thống file
    dir = cha;
  }
  return null;
}

/**
 * Đọc owner/repo từ package.json MỘT LẦN. Không hardcode "vuhai2002/zalo-agent"
 * (một nguồn sự thật, theo được nếu repo đổi chủ). Fail-soft: đọc/parse không
 * được thì tính năng tự tắt (không có nút), không ném.
 */
function docOwnerRepo(): OwnerRepo | null {
  if (ownerRepoCache !== undefined) return ownerRepoCache;
  ownerRepoCache = null;
  try {
    const duong = timDuongPackageJson(dirname(fileURLToPath(import.meta.url)));
    if (duong) {
      const pkg = JSON.parse(readFileSync(duong, "utf8")) as { repository?: { url?: string } | string };
      const url = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
      const khop = url?.match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
      if (khop) ownerRepoCache = { owner: khop[1], repo: khop[2] };
    }
  } catch {
    // fail-soft
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
  const intervalMs = getTuning("UPDATE_CHECK_INTERVAL_MINUTES") * 60_000;
  // Thành công thì cache trọn nhịp; hỏng thì cache ngắn hơn (thử lại sớm), và
  // không bao giờ dài hơn nhịp - phòng khi người dùng đặt nhịp dưới 30 phút.
  cache = { luc: now(), ttl: kq.latest ? intervalMs : Math.min(intervalMs, TTL_LOI_MS), kq };
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

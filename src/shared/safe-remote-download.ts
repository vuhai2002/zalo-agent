import dns from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import net, { type LookupFunction } from "node:net";
import zlib from "node:zlib";
import { hostnameToAddress, isPublicAddress } from "./private-address-guard.js";

/**
 * Tải nội dung từ URL bên ngoài một cách an toàn:
 * - chỉ http/https, chỉ IP public (chặn SSRF - xem private-address-guard.ts)
 * - đọc theo stream và dừng NGAY khi vượt hạn mức, không buffer hết rồi mới kiểm
 *   (fetch + res.arrayBuffer() nạp cả response vào RAM trước khi biết nó to cỡ nào)
 * - tự đi theo redirect nhưng mỗi hop đều bị kiểm lại
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

/**
 * Request trần (không header) bị nhiều site trả 403/406 - đo thực tế:
 * vnexpress 406, sjc.com.vn 403. Gửi bộ header trình duyệt tối thiểu là qua
 * được phần lớn. Site sau Cloudflare vẫn chặn - đó là việc của fallback.
 */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
  // node:http KHÔNG tự thêm Accept-Encoding và cũng không tự giải nén (khác
  // fetch/undici). Nhưng nhiều site nén gzip kể cả khi không được hỏi - đo
  // được: znews.vn trả "content-encoding: gzip" với request không hề khai. Vì
  // đằng nào cũng phải giải nén, khai đủ như trình duyệt luôn: tiết kiệm băng
  // thông và bớt một tín hiệu "không phải trình duyệt".
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
};

export type RemoteFile = { data: Buffer; mediaType: string; fileName: string };
export type DownloadOptions = { maxBytes: number; timeoutMs?: number };

/**
 * DNS lookup có kiểm tra, truyền vào option `lookup` của http.request nên chính
 * socket dùng đúng kết quả đã kiểm - chặn được cả DNS rebinding (kiểm một địa
 * chỉ rồi kết nối tới địa chỉ khác).
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  const lookupOptions: dns.LookupAllOptions = { ...options, all: true };
  dns.lookup(hostname, lookupOptions, (err, addresses) => {
    if (err) {
      callback(err, "", 0);
      return;
    }
    const blocked = addresses.find((entry) => !isPublicAddress(entry.address));
    if (blocked) {
      callback(new Error(`Chặn địa chỉ nội bộ: ${hostname} -> ${blocked.address}`), "", 0);
      return;
    }
    if (options.all) {
      callback(null, addresses);
      return;
    }
    const first = addresses[0];
    if (!first) {
      callback(new Error(`Không phân giải được ${hostname}`), "", 0);
      return;
    }
    callback(null, first.address, first.family);
  });
};

const formatMb = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))}MB`;

/**
 * Đọc stream với hạn mức byte. Vượt hạn thì ném lỗi và huỷ stream ngay (thoát
 * sớm khỏi for-await sẽ destroy Readable) nên không tải nốt phần còn lại.
 */
export async function readCappedStream(
  stream: AsyncIterable<Buffer | string>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buffer.byteLength;
    if (total > maxBytes) throw new Error(`Nội dung vượt giới hạn ${formatMb(maxBytes)}`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Giải nén body theo header `content-encoding`.
 *
 * Lỗi thật đã gặp: znews.vn và tienphong.vn trả gzip, code cũ `.toString("utf-8")`
 * thẳng vào buffer nén nên tool web_fetch đẩy 46.000 ký tự rác nhị phân vào
 * context của model - vừa đốt token vừa mất luôn nguồn đó. Rác thì dài nên
 * ngưỡng "quá ít chữ" cũng không kích hoạt được lưới đỡ Jina.
 *
 * `maxOutputLength` chặn zip bomb: file nén 1MB có thể bung thành hàng GB, cap
 * ở tầng stream (dữ liệu nén) không cứu được.
 */
export function decompressBody(
  data: Buffer,
  contentEncoding: string | undefined,
  maxBytes: number,
): Buffer {
  const codec = (contentEncoding ?? "").trim().toLowerCase();
  if (!codec || codec === "identity") return data;

  const options = { maxOutputLength: maxBytes };
  try {
    switch (codec) {
      case "gzip":
      case "x-gzip":
        return zlib.gunzipSync(data, options);
      case "br":
        return zlib.brotliDecompressSync(data, options);
      case "deflate":
        // Một số server gửi deflate thô (không có zlib header) - thử cả 2 kiểu
        try {
          return zlib.inflateSync(data, options);
        } catch {
          return zlib.inflateRawSync(data, options);
        }
      default:
        // Trả nguyên buffer là tái diễn đúng bug cũ (rác nhị phân vào context),
        // báo lỗi để caller rơi xuống nguồn khác
        throw new Error(`Không giải nén được kiểu "${codec}"`);
    }
  } catch (err) {
    throw new Error(`Giải nén nội dung thất bại: ${err instanceof Error ? err.message : err}`);
  }
}

function openGuardedRequest(url: URL, timeoutMs: number): Promise<IncomingMessage> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Chỉ hỗ trợ http/https, không hỗ trợ "${url.protocol}"`);
  }

  // URL ghi thẳng IP thì socket bỏ qua bước DNS -> guardedLookup không chạy,
  // phải tự kiểm ở đây, nếu không "http://127.0.0.1:3900" lọt thẳng qua.
  const address = hostnameToAddress(url.hostname);
  if (net.isIP(address) && !isPublicAddress(address)) {
    throw new Error(`Chặn địa chỉ nội bộ: ${address}`);
  }

  return new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(
      url,
      { lookup: guardedLookup, timeout: timeoutMs, headers: BROWSER_HEADERS },
      resolve,
    );
    req.on("timeout", () => req.destroy(new Error(`Hết thời gian chờ ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end();
  });
}

/** Tên file gợi ý từ URL, đã lọc ký tự để dùng làm tên file trên đĩa */
function fileNameFromUrl(url: URL): string {
  let raw: string;
  try {
    raw = decodeURIComponent(url.pathname.split("/").pop() ?? "");
  } catch {
    raw = url.pathname.split("/").pop() ?? "";
  }
  const safe = raw
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return safe || "tep-tai-ve";
}

/** Ném Error với thông báo tiếng Việt gọn - caller đưa thẳng cho LLM/log được */
export async function downloadFromPublicUrl(
  rawUrl: string,
  options: DownloadOptions,
): Promise<RemoteFile> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("URL không hợp lệ");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await openGuardedRequest(url, timeoutMs);
    const status = res.statusCode ?? 0;
    const location = res.headers.location;

    if (status >= 300 && status < 400 && location) {
      res.destroy();
      url = new URL(location, url); // hop mới đi qua guard ở vòng lặp sau
      continue;
    }

    if (status < 200 || status >= 300) {
      res.destroy();
      throw new Error(`HTTP ${status}`);
    }

    // Có Content-Length thì chặn trước khi đọc byte nào
    const declared = Number(res.headers["content-length"]);
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      res.destroy();
      throw new Error(`Nội dung vượt giới hạn ${formatMb(options.maxBytes)}`);
    }

    const raw = await readCappedStream(res, options.maxBytes);
    if (raw.byteLength === 0) throw new Error("Nội dung rỗng");

    // Giải nén TRƯỚC khi trả về: caller nào cũng đang coi đây là dữ liệu thô
    const data = decompressBody(raw, res.headers["content-encoding"], options.maxBytes);

    return {
      data,
      mediaType: (res.headers["content-type"] ?? "application/octet-stream").split(";")[0]!.trim(),
      fileName: fileNameFromUrl(url),
    };
  }

  throw new Error(`Quá ${MAX_REDIRECTS} lần chuyển hướng`);
}

import dns from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import net, { type LookupFunction } from "node:net";
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
    const req = send(url, { lookup: guardedLookup, timeout: timeoutMs }, resolve);
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

    const data = await readCappedStream(res, options.maxBytes);
    if (data.byteLength === 0) throw new Error("Nội dung rỗng");

    return {
      data,
      mediaType: (res.headers["content-type"] ?? "application/octet-stream").split(";")[0]!.trim(),
      fileName: fileNameFromUrl(url),
    };
  }

  throw new Error(`Quá ${MAX_REDIRECTS} lần chuyển hướng`);
}

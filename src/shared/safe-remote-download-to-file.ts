/**
 * Tải một URL công khai THẲNG RA FILE, không giữ nội dung trong bộ nhớ.
 *
 * Tách khỏi `safe-remote-download.ts` vì hai họ hàm có hình dạng khác hẳn nhau:
 * bên đó gom vào `Buffer` (đúng cho trang HTML vài trăm KB mà tool web đọc),
 * bên này chảy thẳng ra đĩa (đúng cho video vài chục MB - gom vào RAM là một
 * người gửi link đủ đẩy tiến trình chạm trần bộ nhớ).
 *
 * Chung nguyên một lớp bảo vệ: `openGuardedRequest` chặn IP nội bộ, chống DNS
 * rebinding, kiểm LẠI từng hop chuyển hướng. Đó là lý do file này mượn hàm đó
 * chứ không tự mở kết nối - hai đường tải riêng là hai lớp bảo vệ phải nhớ sửa
 * cùng lúc, và cái bị quên luôn là cái ít người đọc hơn.
 */

import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

import {
  DEFAULT_TIMEOUT_MS,
  MAX_REDIRECTS,
  formatMb,
  openGuardedRequest,
  type DownloadOptions,
} from "./safe-remote-download.js";

/**
 * Hạn chót TỔNG cho một lượt tải.
 *
 * 5 phút: đủ cho 100 MB trên đường truyền chậm, mà vẫn chặn được kiểu nhỏ giọt.
 */
const TRAN_TONG_MS = 5 * 60_000;

/**
 * Ghi một stream ra file, DỪNG NGAY khi vượt trần.
 *
 * Tách khỏi `downloadToFileFromPublicUrl` để test được: hàm kia chặn mọi địa chỉ
 * nội bộ (đó là việc của nó), nên dựng server thật trên `127.0.0.1` để thử là
 * bị chính lớp bảo vệ chặn - không có cách nào chạm tới phần đếm byte. Cùng nếp
 * `readCappedStream` trong file này.
 *
 * Đếm lúc CHẢY chứ không tin `content-length`: header đó do bên kia khai, và
 * bên kia ở đây là CDN của TikTok/Facebook trả về từ một link do người lạ gửi.
 */
export async function ghiStreamRaFileCoTran(
  nguon: NodeJS.ReadableStream & { destroy: () => void },
  filePath: string,
  maxBytes: number,
  hanChotMs = TRAN_TONG_MS,
): Promise<number> {
  let bytes = 0;
  const batDau = Date.now();
  const dich = createWriteStream(filePath, { mode: 0o600 });
  try {
    await pipeline(nguon, async function* (dong) {
      for await (const khuc of dong) {
        bytes += (khuc as Buffer).byteLength;
        // `pipeline` ném ở đây sẽ hủy cả socket lẫn file stream.
        if (bytes > maxBytes) {
          throw new Error(`Nội dung vượt giới hạn ${formatMb(maxBytes)}`);
        }
        // HẠN CHÓT TỔNG, khác hẳn `timeout` của `http.request` vốn chỉ là
        // timeout NHÀN RỖI (`socket.setTimeout`): nó chỉ bắn khi socket im lặng
        // đủ lâu. Một host nhỏ giọt 1 byte mỗi 14 giây thì không bao giờ chạm
        // timeout nhàn rỗi, cũng không bao giờ chạm `maxBytes` - kết nối sống
        // vô hạn trong khi giữ một trong HAI suất tải song song. Hai link như
        // vậy là khoá tính năng tải video của cả bot, không riêng một thread.
        if (Date.now() - batDau > hanChotMs) {
          throw new Error(`Tải quá ${Math.round(hanChotMs / 1000)} giây, đã dừng`);
        }
        yield khuc as Buffer;
      }
    }, dich);
  } catch (err) {
    // `pipeline` đã tự hủy cả ba stream khi nhánh trên ném - đo được: bỏ dòng
    // này đi thì `nguon.destroyed` vẫn `true`. Giữ lại là thắt lưng ĐÃ có dây
    // đeo quần, và `destroy()` gọi hai lần không sao. Đừng đọc nó thành "đây là
    // thứ chặn CDN đẩy tiếp" - thứ đó là `pipeline`.
    nguon.destroy();
    throw err;
  }

  // File RỖNG là hỏng, không phải thành công cỡ 0: gửi lên Zalo một file 0 byte
  // thì người nhận thấy một video không mở được, tệ hơn hẳn một câu báo lỗi.
  if (bytes === 0) throw new Error("Nội dung rỗng");
  return bytes;
}

export async function downloadToFileFromPublicUrl(
  rawUrl: string,
  filePath: string,
  options: DownloadOptions,
): Promise<{ bytes: number; mediaType: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("URL không hợp lệ");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // XIN `identity`: `BROWSER_HEADERS` mặc định xin `gzip, deflate, br` (đúng
    // cho đường đọc HTML vì bên đó có giải nén), nhưng đường này NÉM khi thấy
    // nội dung nén. Không đè lại thì ta đang xin đúng thứ mình sắp từ chối, và
    // CDN nào nghe lời là giết luôn đường tải.
    const res = await openGuardedRequest(url, timeoutMs, "GET", { "Accept-Encoding": "identity" });
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

    const encoding = res.headers["content-encoding"];
    if (encoding && encoding !== "identity") {
      res.destroy();
      throw new Error(`Nội dung bị nén (${encoding}) - không ghi thẳng ra file được`);
    }

    // Có Content-Length thì chặn TRƯỚC khi tải byte nào. Header này nói dối
    // được, nên vẫn phải đếm lúc chảy - đây chỉ là cửa rẻ chặn sớm.
    const declared = Number(res.headers["content-length"]);
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      res.destroy();
      throw new Error(`Nội dung vượt giới hạn ${formatMb(options.maxBytes)}`);
    }

    const mediaType = (res.headers["content-type"] ?? "application/octet-stream")
      .split(";")[0]!
      .trim();

    const bytes = await ghiStreamRaFileCoTran(res, filePath, options.maxBytes);
    return { bytes, mediaType };
  }

  throw new Error(`Quá ${MAX_REDIRECTS} lần chuyển hướng`);
}

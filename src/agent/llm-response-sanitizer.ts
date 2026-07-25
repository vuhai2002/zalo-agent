/**
 * Phòng thủ trước response lỗi từ router proxy (9Router): có ca router trả lời
 * request NON-streaming bằng body là JSON hoàn chỉnh nhưng dính thêm đuôi SSE
 * `data: [DONE]` (và header content-type: text/event-stream). AI SDK parse JSON
 * sẽ fail ở ký tự đầu tiên sau dấu `}` đóng - toàn bộ lượt agent chết dù câu
 * trả lời đã được sinh ra và token đã tốn.
 *
 * Module này thuần (không import env/logger) để test import tĩnh được.
 */

const SSE_DONE_TRAILER = /(?:\s*data:\s*\[DONE\]\s*)+$/;

/**
 * Cắt đuôi `data: [DONE]` nếu phần còn lại là JSON object hoàn chỉnh.
 * Trả về body đã làm sạch, hoặc null nếu body không khớp đúng ca lỗi này
 * (không có đuôi, hoặc phần còn lại không phải JSON - vd stream SSE thật).
 */
export function stripSseDoneTrailer(body: string): string | null {
  if (!SSE_DONE_TRAILER.test(body)) return null;

  const cleaned = body.replace(SSE_DONE_TRAILER, "").trim();
  // Stream SSE thật có dạng "data: {...}\n\ndata: [DONE]" - sau khi cắt đuôi
  // phần còn lại bắt đầu bằng "data:", không phải "{" -> không đụng vào
  if (!cleaned.startsWith("{")) return null;

  try {
    JSON.parse(cleaned);
  } catch {
    return null;
  }
  return cleaned;
}

export type SanitizingFetchOptions = {
  /** Gọi khi phát hiện + sửa response lỗi - dùng để log cảnh báo */
  onSanitized?: () => void;
  /** Cho test inject fetch giả; mặc định fetch toàn cục */
  baseFetch?: typeof globalThis.fetch;
};

/**
 * Bọc fetch cho AI SDK provider: response non-streaming nào dính đuôi SSE thì
 * cắt sạch rồi trả về như JSON bình thường. Response streaming thật (request
 * có "stream":true) không bị đụng tới - đọc body ở đây sẽ phá stream.
 */
export function createSanitizingFetch(options: SanitizingFetchOptions = {}): typeof globalThis.fetch {
  const baseFetch = options.baseFetch ?? globalThis.fetch;

  return async (input, init) => {
    const res = await baseFetch(input, init);
    if (!res.ok) return res;
    if (typeof init?.body === "string" && /"stream"\s*:\s*true/.test(init.body)) return res;

    const text = await res.text();
    const cleaned = stripSseDoneTrailer(text);

    // Body đã bị đọc nên phải dựng lại Response dù có sửa hay không.
    // Xóa content-length/content-encoding: undici đã giải nén sẵn, giữ header
    // cũ sẽ sai lệch với body mới.
    const headers = new Headers(res.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    if (cleaned !== null) {
      headers.set("content-type", "application/json; charset=utf-8");
      options.onSanitized?.();
    }

    return new Response(cleaned ?? text, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
}

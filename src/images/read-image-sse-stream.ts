/**
 * Đọc stream SSE của endpoint vẽ ảnh, trả về base64 của ảnh hoàn chỉnh.
 *
 * Vì sao phải đi đường stream thay vì lấy thẳng JSON/binary: router nằm sau
 * Cloudflare, mà Cloudflare cắt kết nối (HTTP 524) khi origin im lặng quá lâu.
 * Đường không stream chỉ trả byte đầu tiên LÚC VẼ XONG nên vẽ lâu là chết. Đo
 * thật cùng một prompt chạy song song:
 *   binary: byte đầu sau 125.4s -> HTTP 524
 *   SSE:    byte đầu sau   1.8s -> HTTP 200, xong ở 62.7s
 * Router bắn event `progress` liên tục nên Cloudflare luôn thấy có dữ liệu chảy.
 *
 * Định dạng (đọc stream thật để đối chiếu, không theo tài liệu):
 *   event: progress      - tiến độ, bỏ qua
 *   event: partial_image - ảnh DỞ DANG, bỏ qua (lấy nhầm là gửi ảnh chưa vẽ xong)
 *   event: done          - {created, data:[{b64_json}]}
 *   event: error         - {message}
 */

const BLOCK_SEPARATOR = "\n\n";

type SseBlock = { event: string; data: string };

function parseBlock(raw: string): SseBlock | null {
  let event = "";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    // Cộng dồn: chuẩn SSE cho phép 1 block có nhiều dòng data
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  return event ? { event, data } : null;
}

/** Rút b64 ảnh từ block done; trả null nếu block không phải done hợp lệ */
function imageFromDone(block: SseBlock): string | null {
  if (block.event !== "done") return null;
  try {
    const parsed = JSON.parse(block.data) as { data?: { b64_json?: string }[] };
    return parsed.data?.[0]?.b64_json ?? null;
  } catch {
    return null;
  }
}

function errorFrom(block: SseBlock): string | null {
  if (block.event !== "error") return null;
  try {
    const parsed = JSON.parse(block.data) as { message?: string };
    return parsed.message || "Provider báo lỗi trong lúc vẽ";
  } catch {
    return "Provider báo lỗi trong lúc vẽ";
  }
}

export async function readImageFromSseStream(response: Response): Promise<string> {
  if (!response.body) throw new Error("Provider không trả về ảnh (stream rỗng)");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  // Buffer bắt buộc: một block SSE có thể bị chẻ làm đôi giữa 2 chunk mạng,
  // xử lý từng chunk rời là mất event done của những ảnh lớn
  let buffer = "";
  let imageB64: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf(BLOCK_SEPARATOR)) !== -1) {
      const block = parseBlock(buffer.slice(0, sep));
      buffer = buffer.slice(sep + BLOCK_SEPARATOR.length);
      if (!block) continue;

      const failure = errorFrom(block);
      if (failure) throw new Error(failure);

      imageB64 = imageFromDone(block) ?? imageB64;
    }
  }

  if (!imageB64) {
    // Stream chạy hết mà không có done: đừng trả chuỗi rỗng rồi ghi ra file 0 byte
    throw new Error("Provider không trả về ảnh (stream kết thúc mà thiếu sự kiện done)");
  }
  return imageB64;
}

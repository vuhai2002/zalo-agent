/**
 * Lỗi của provider bị 9Router ĐỔI THÀNH CHỮ trả lời.
 *
 * `open-sse/translator/response/openai-responses.js` của router nhận sự kiện
 * `error`/`response.failed` từ Responses API (Codex) rồi phát một chunk
 * `content: "[Error] <thông báo>"` kèm `finish_reason: stop` - với SDK đó là một
 * câu trả lời thành công, không ném gì. Ca thật 2026-11-23: OpenAI chặn lượt vì
 * "cybersecurity risk" SAU khi model đã viết xong (lịch sử có câu nhờ hack tài
 * khoản ngân hàng), và câu lỗi tiếng Anh đi thẳng xuống Zalo, 5 tin.
 *
 * Nhận bằng HAI dấu hiệu cùng lúc: chữ có `[Error] ` (lấy lần CUỐI - router luôn
 * nối vào cuối) VÀ step đó 0 token đầu ra (chunk lỗi của router không mang
 * usage). Chỉ dựa vào chữ thì người lạ bắt model gõ "[Error] ..." là cắt được
 * câu trả lời thật; lượt đó có token nên bị loại.
 *
 * `null` = không phải ca này.
 */
const DAU_LOI = "[Error]";

export function tachLoiRouterDoiLotChu(p: {
  text: string;
  outputTokens: number;
}): { phanTruoc: string; loi: string } | null {
  if (p.outputTokens !== 0) return null;
  const viTri = p.text.lastIndexOf(DAU_LOI);
  if (viTri < 0) return null;
  return { phanTruoc: p.text.slice(0, viTri).trimEnd(), loi: p.text.slice(viTri + DAU_LOI.length).trim() };
}

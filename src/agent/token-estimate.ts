import { asSchema, type ModelMessage } from "ai";

import { KY_TU_MOI_TOKEN } from "../shared/ky-tu-moi-token.js";

/**
 * Ước lượng số token của input TRƯỚC khi gọi model.
 *
 * Vì sao là ước lượng chứ không phải đếm thật: đếm đúng cần tokenizer của
 * chính model đang chạy, mà model đổi được từ dashboard (router có thể âm thầm
 * route sang model khác nữa). Kéo một tokenizer vào chỉ để rồi sai kiểu khác là
 * không đáng - xem `docs/` và ghi chú "không thêm dependency cho thứ đo được".
 *
 * Vì sao BẢNG `agent_turns` không đủ để hiệu chỉnh (đã thử 02/08/2026, 78 lượt):
 * `agent_turns.input_tokens` là `totalUsage` - TỔNG qua mọi step, không phải kích
 * thước một lần gọi; và bảng không lưu số ký tự -> thiếu vế còn lại của tỉ lệ.
 *
 * ĐƯỜNG HIỆU CHỈNH (log "Hoàn thành lượt agent" ở MỌI lượt, `agent-loop.ts`):
 * - `uocLuong.that` = `steps[0].usage.inputTokens` - trên ai@7.0.37 đây ĐÃ là
 *   TỔNG token input (gồm cả phần đọc cache; `inputTokenDetails.{noCacheTokens,
 *   cacheReadTokens}` chỉ là phần rã ra), nên KHÔNG cộng thêm cacheRead.
 * - `kyTuInput` = `demKyTuInputDayDu(system, tools, messages)` - vế ký tự phủ
 *   ĐÚNG phạm vi của `that` (system + tools schema + messages), vì `system:` và
 *   `tools:` gửi TÁCH khỏi `messages`.
 * Trên lượt KHÔNG ảnh (`imageMode` khác native/hybrid) và `soTinChen=0`, tỉ lệ
 * `kyTuInput / uocLuong.that` là số ĐO ĐƯỢC để chỉnh `KY_TU_MOI_TOKEN`. Ảnh cộng
 * token vào `that` mà không có ký tự đối ứng nên phải loại lượt có ảnh.
 *
 * Số đo tham chiếu 02/08/2026: system prompt thật 5.858 ký tự; lượt nặng nhất
 * từng ghi 184.835 token cộng dồn qua 8 step.
 */

// Hằng số quy đổi ký tự -> token nằm ở `shared/ky-tu-moi-token.ts` (kèm phép
// đo và lý do). Ở riêng vì luật chéo bên `config/` và trang Cấu hình trên
// trình duyệt cũng cần nó, mà cả hai không được kéo file này vào. Re-export để
// nơi đang dùng không phải sửa đường import.
export { KY_TU_MOI_TOKEN } from "../shared/ky-tu-moi-token.js";

/**
 * Chi phí mỗi ảnh, tính bằng token - theo CỠ ẢNH ĐANG CẤU HÌNH.
 *
 * Ảnh KHÔNG tính theo độ dài chuỗi base64: chuỗi đó phản ánh độ nén của file
 * chứ không phải số token thị giác, lấy nó làm thước sẽ thổi phồng ước lượng
 * tới mức cắt sạch lịch sử.
 *
 * Số lấy từ `estimateImageTokens` sẵn có (`zalo-image-variant.ts`, công thức
 * (w*h)/750 của Anthropic) áp lên đúng ba cỡ mà `ZALO_IMAGE_QUALITY` cho chọn.
 * Trước đây chỗ này là MỘT hằng số phẳng 800 - đúng cho cỡ `normal` nhưng hụt
 * 3,5 lần với `hd` (977x2128 = 2772 token). Hụt là hướng nguy hiểm: ảnh của
 * lượt hiện tại nằm trong vùng bảo vệ nên trimmer không đỡ được, mà một album
 * gửi liên tục gộp thành một batch dài tùy ý.
 */
export const TOKEN_MOI_ANH_THEO_CO = {
  thumb: 180,
  normal: 700,
  hd: 2_800,
} as const;

export type CoAnh = keyof typeof TOKEN_MOI_ANH_THEO_CO;

/** Phụ phí mỗi tin: vai trò, dấu phân cách, khung định dạng của provider */
const PHU_PHI_MOI_TIN = 4;

/** Ước lượng token của một phần nội dung */
function tokenCuaPhan(part: unknown, tokenMoiAnh: number): number {
  if (typeof part === "string") return Math.ceil(part.length / KY_TU_MOI_TOKEN);
  if (!part || typeof part !== "object") return 0;
  const p = part as { type?: string; text?: string };
  if (p.type === "text" && typeof p.text === "string") {
    return Math.ceil(p.text.length / KY_TU_MOI_TOKEN);
  }
  if (p.type === "file" || p.type === "image") return tokenMoiAnh;
  // Phần còn lại (`tool-call`, `tool-result`, `reasoning`...) đo bằng độ dài
  // JSON. Trả 0 như bản đầu là sai NGUY HIỂM: một tool result của web_fetch dài
  // 60.000 ký tự sẽ được báo là 4 token, nên đúng những tin NẶNG NHẤT lại được
  // coi là nhẹ nhất và không bao giờ bị cắt.
  try {
    return Math.ceil((JSON.stringify(part)?.length ?? 0) / KY_TU_MOI_TOKEN);
  } catch {
    return 0;
  }
}

/** Ước lượng token của một `ModelMessage` (kể cả tin nhiều phần có ảnh) */
export function uocLuongTokenTin(
  tin: ModelMessage,
  tokenMoiAnh: number = TOKEN_MOI_ANH_THEO_CO.normal,
): number {
  const noiDung = tin.content;
  if (typeof noiDung === "string") {
    return Math.ceil(noiDung.length / KY_TU_MOI_TOKEN) + PHU_PHI_MOI_TIN;
  }
  if (!Array.isArray(noiDung)) return PHU_PHI_MOI_TIN;
  let tong = PHU_PHI_MOI_TIN;
  for (const phan of noiDung) tong += tokenCuaPhan(phan, tokenMoiAnh);
  return tong;
}

/** Ước lượng token của cả mảng tin */
export function uocLuongTokenTinNhan(
  tins: ModelMessage[],
  tokenMoiAnh: number = TOKEN_MOI_ANH_THEO_CO.normal,
): number {
  let tong = 0;
  for (const t of tins) tong += uocLuongTokenTin(t, tokenMoiAnh);
  return tong;
}

/** Số ký tự văn bản của một phần nội dung (ảnh trả 0 - ảnh không phải ký tự) */
function kyTuCuaPhan(part: unknown): number {
  if (typeof part === "string") return part.length;
  if (!part || typeof part !== "object") return 0;
  const p = part as { type?: string; text?: string };
  if (p.type === "text" && typeof p.text === "string") return p.text.length;
  if (p.type === "file" || p.type === "image") return 0;
  try {
    return JSON.stringify(part)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Đếm số KÝ TỰ văn bản của cả mảng tin (ảnh trả 0). Xem `demKyTuInputDayDu`. */
export function demKyTuTinNhan(tins: ModelMessage[]): number {
  let tong = 0;
  for (const t of tins) {
    const c = t.content;
    if (typeof c === "string") {
      tong += c.length;
      continue;
    }
    if (!Array.isArray(c)) continue;
    for (const phan of c) tong += kyTuCuaPhan(phan);
  }
  return tong;
}

/**
 * Đếm ký tự schema tools như provider NHẬN: mỗi tool = tên + mô tả + JSON schema
 * của `inputSchema` (zod -> JSON qua `asSchema`, đúng bộ chuyển AI SDK dùng khi
 * gửi). Đây là phần CỐ ĐỊNH lớn của input mà `messages` không có.
 */
export function demKyTuTools(
  tools: Record<string, { description?: string; inputSchema?: unknown }> | null | undefined,
): number {
  if (!tools) return 0;
  let tong = 0;
  for (const [ten, t] of Object.entries(tools)) {
    tong += ten.length + (t.description?.length ?? 0);
    try {
      tong += JSON.stringify(asSchema(t.inputSchema as never).jsonSchema).length;
    } catch {
      // schema lạ (không zod/không JSON schema) - bỏ phần schema, tên+mô tả vẫn tính
    }
  }
  return tong;
}

/**
 * Vế "ký tự" phủ ĐÚNG phạm vi mà `steps[0].usage.inputTokens` đếm: system prompt
 * + tools schema + messages. Chia cho số token thật (`that`) trên lượt KHÔNG ảnh
 * + `soTinChen=0` ra tỉ lệ ký-tự/token SẠCH để chỉnh `KY_TU_MOI_TOKEN`.
 *
 * Vì sao phải gộp cả ba: `system:` và `tools:` gửi TÁCH khỏi `messages`
 * (`agent-loop.ts`), nên chỉ đếm `messages` thì tử số hụt hẳn system (~vài nghìn
 * ký tự) + tools -> tỉ lệ lệch thấp một cách hệ thống.
 */
export function demKyTuInputDayDu(
  systemPrompt: string,
  tools: Record<string, { description?: string; inputSchema?: unknown }> | null | undefined,
  messages: ModelMessage[],
): number {
  return systemPrompt.length + demKyTuTools(tools) + demKyTuTinNhan(messages);
}

/**
 * Hệ số an toàn: chỉ dùng tới ngần này phần trần.
 *
 * Trần khai báo là CỬA SỔ CỦA MODEL (tài liệu và ô nhập đều nói vậy). Phần chừa
 * lại dành cho những thứ ước lượng không thấy: phần model viết ra
 * (`LLM_MAX_OUTPUT_TOKENS` tới 16.384), kết quả tool cộng dồn qua từng step, và
 * sai số của chính hằng số ký-tự-trên-token.
 */
const HE_SO_AN_TOAN = 0.7;

/**
 * Ngân sách thật sự được dùng, suy từ trần khai báo.
 *
 * MỘT hàm cho MỌI nơi - đây là chỗ từng sai: cắt trước lượt lấy 70% trần, còn
 * điều kiện dừng trong lượt lại so với 100% trần. Hệ quả là nếu người dùng đặt
 * trần đúng bằng cửa sổ model (như tài liệu dặn), provider trả 400 TRƯỚC khi
 * usage kịp về, nên điều kiện dừng không bao giờ chạy - nửa tính năng thành
 * vô dụng.
 */
export function nganSachAnToan(tranToken: number): number {
  if (!Number.isFinite(tranToken) || tranToken <= 0) return 0;
  return Math.floor(tranToken * HE_SO_AN_TOAN);
}

/**
 * Ước lượng cạnh số thật, để đọc trong log mà chỉnh dần hai hằng số ở trên.
 *
 * Không có số thật (step đầu chưa trả usage) thì trả `null` - đừng bịa ra một
 * tỉ lệ từ số 0.
 */
export function soSanhUocLuong(
  uocLuong: number,
  that: number | undefined,
): { uocLuong: number; that: number; lechPhanTram: number } | null {
  if (!that || that <= 0) return null;
  return { uocLuong, that, lechPhanTram: Math.round(((uocLuong - that) / that) * 100) };
}

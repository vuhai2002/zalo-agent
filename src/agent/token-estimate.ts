import type { ModelMessage } from "ai";

/**
 * Ước lượng số token của input TRƯỚC khi gọi model.
 *
 * Vì sao là ước lượng chứ không phải đếm thật: đếm đúng cần tokenizer của
 * chính model đang chạy, mà model đổi được từ dashboard (router có thể âm thầm
 * route sang model khác nữa). Kéo một tokenizer vào chỉ để rồi sai kiểu khác là
 * không đáng - xem `docs/` và ghi chú "không thêm dependency cho thứ đo được".
 *
 * Vì sao KHÔNG hiệu chỉnh được từ dữ liệu sẵn có (đã thử ngày 02/08/2026 trên
 * DB thật, 78 lượt):
 * - `agent_turns.input_tokens` là `totalUsage` - TỔNG qua mọi step của lượt,
 *   không phải kích thước context của một lần gọi.
 * - Prompt cache đang bật mặc định nên số đó có thể không gồm phần prefix đã
 *   được cache.
 * - Bảng không lưu số ký tự đầu vào nên không có vế còn lại của tỉ lệ.
 *
 * Nên hằng số dưới đây chọn theo phía THẬN TRỌNG (ước lượng cao hơn thực tế thì
 * cắt sớm, hại là bot quên hơi nhiều; ước lượng thấp hơn thì tràn context và
 * hỏng cả lượt). `logDoLech` ở agent-loop ghi ước lượng cạnh số thật để chỉnh
 * dần - đó mới là đường hiệu chỉnh đúng.
 *
 * Số đo tham chiếu cùng ngày: system prompt thật 5.858 ký tự; lượt nặng nhất
 * từng ghi 184.835 token cộng dồn qua 8 step.
 */

/**
 * Ký tự trên một token, phía thận trọng cho tiếng Việt.
 *
 * Tiếng Việt tách token tệ hơn tiếng Anh vì dấu thanh và nguyên âm có dấu phụ
 * thường tách thành nhiều token con. Tiếng Anh khoảng 4; lấy 2.5 để ước lượng
 * nghiêng về phía CAO.
 */
const KY_TU_MOI_TOKEN = 2.5;

/**
 * Chi phí cố định mỗi ảnh, tính bằng token.
 *
 * Ảnh KHÔNG tính theo độ dài chuỗi base64 - chuỗi đó dài gấp nhiều lần số token
 * thị giác thật, lấy nó làm thước sẽ thổi phồng ước lượng tới mức cắt sạch lịch
 * sử. Lấy một con số phẳng theo cỡ ảnh phổ thông của model vision.
 */
const TOKEN_MOI_ANH = 800;

/** Phụ phí mỗi tin: vai trò, dấu phân cách, khung định dạng của provider */
const PHU_PHI_MOI_TIN = 4;

/** Ước lượng token của một phần nội dung */
function tokenCuaPhan(part: unknown): number {
  if (typeof part === "string") return Math.ceil(part.length / KY_TU_MOI_TOKEN);
  if (!part || typeof part !== "object") return 0;
  const p = part as { type?: string; text?: string };
  if (p.type === "text" && typeof p.text === "string") {
    return Math.ceil(p.text.length / KY_TU_MOI_TOKEN);
  }
  // "file" và "image": pixel, tính theo cỡ phẳng chứ không theo độ dài base64
  if (p.type === "file" || p.type === "image") return TOKEN_MOI_ANH;
  return 0;
}

/** Ước lượng token của một `ModelMessage` (kể cả tin nhiều phần có ảnh) */
export function uocLuongTokenTin(tin: ModelMessage): number {
  const noiDung = tin.content;
  if (typeof noiDung === "string") {
    return Math.ceil(noiDung.length / KY_TU_MOI_TOKEN) + PHU_PHI_MOI_TIN;
  }
  if (!Array.isArray(noiDung)) return PHU_PHI_MOI_TIN;
  let tong = PHU_PHI_MOI_TIN;
  for (const phan of noiDung) tong += tokenCuaPhan(phan);
  return tong;
}

/** Ước lượng token của cả mảng tin */
export function uocLuongTokenTinNhan(tins: ModelMessage[]): number {
  let tong = 0;
  for (const t of tins) tong += uocLuongTokenTin(t);
  return tong;
}

/** Ước lượng token của một chuỗi thuần (system prompt, mô tả tool...) */
export function uocLuongTokenChuoi(s: string): number {
  return Math.ceil(s.length / KY_TU_MOI_TOKEN);
}

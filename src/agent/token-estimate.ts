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
 * `agent-loop.ts` ghi ước lượng cạnh số thật (`soSanhUocLuong`, dòng log "Hoàn
 * thành lượt agent", trường `uocLuong`) ở MỌI lượt - đó là đường hiệu chỉnh.
 *
 * Số đo tham chiếu cùng ngày: system prompt thật 5.858 ký tự; lượt nặng nhất
 * từng ghi 184.835 token cộng dồn qua 8 step.
 */

/**
 * Ký tự trên một token cho tiếng Việt.
 *
 * ĐÃ ĐO bằng `gpt-tokenizer` (bảng BPE gốc của OpenAI) trên 4 mẫu tiếng Việt
 * thật - hội thoại, tin tức, kỹ thuật, khối `<noi_dung_ngoai>`:
 *
 *   họ o200k (GPT-4o/5):  3,1 - 3,8 ký tự/token
 *   họ cl100k (GPT-4):    2,1 - 2,2 ký tự/token
 *   tiếng Anh đối chứng:  4,5
 *
 * Lấy 2.5 nên ước CAO hơn thực tế (khoảng 24-52% nếu tính trên số thật) với họ o200k, nhưng vẫn HỤT 12-17%
 * với họ cl100k. Tokenizer của Anthropic không công khai nên không đo được cho
 * chính model mặc định của repo. Biên `HE_SO_AN_TOAN` (chừa 30%) nuốt được mức
 * hụt đó, nhưng đây là chỗ phải theo dõi qua log `uocLuong.lechPhanTram` chứ
 * không phải hằng số đã yên.
 */
export const KY_TU_MOI_TOKEN = 2.5;

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

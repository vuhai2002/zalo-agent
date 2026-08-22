/**
 * Các mốc chọn nhanh cho những ô SỐ mà người vận hành khó tự nghĩ ra con số,
 * dùng chung cho trang Cấu hình và trang Agents.
 *
 * VÌ SAO LÀ FILE RIÊNG: hai trang đó lấy dữ liệu theo hai đường khác hẳn nhau -
 * trang Cấu hình nhận `TUNING_DEFS` qua JSON của `GET /api/tuning`, còn trang
 * Agents dựng form từ hằng số cục bộ (nếp của `MUC_SUY_NGHI`). Để danh sách ở
 * mỗi bên một bản thì hai trang sẽ lệch nhau sau vài lần đời model đổi, mà
 * lệch kiểu đó không có gì báo. File này KHÔNG import gì cả nên trình duyệt
 * nạp được thẳng, không kéo theo module Node nào.
 *
 * VÌ SAO TÁCH `label` VỚI `hint`: `SelectMenu` giữ `label` nguyên vẹn và cắt
 * bớt `hint` (`label` có `shrink-0`, `hint` gánh toàn bộ phần thiếu). Nhét cả
 * số lẫn chú thích vào một chuỗi thì ô hẹp cắt mất phần đuôi và ra "128.000 -
 * phổ thông, an toàn cho mọ..." - đã dính thật.
 *
 * ĐÂY LÀ MỐC GỢI Ý, KHÔNG PHẢI DANH SÁCH ĐÓNG. Ô nhập tay vẫn còn (mục "Tùy
 * chỉnh"), nhận mọi giá trị trong khoảng `min`..`max` của schema env. Tên model
 * sẽ lạc hậu - khi đó sửa NHÃN, đừng bỏ mốc đi: người đang dùng mốc cũ mà mốc
 * biến mất thì ô của họ rơi về chế độ tùy chỉnh không rõ lý do.
 */

export type MocSoGoiY = {
  value: number;
  /** CHỈ con số. Đây là phần phải sống sót khi ô hẹp. */
  label: string;
  /** Chú thích ngắn - được phép cắt bớt khi hẹp. */
  hint: string;
};

/**
 * Trần độ dài `hint`, có TEST canh.
 *
 * Popup của `SelectMenu` là `min-w-max` nên nó rộng bằng mục dài nhất. Đo trên
 * trang Agents: hint 38-39 ký tự làm popup 323px, mà cột phải của form nằm sát
 * mép cửa sổ nên popup chạm đúng biên và bị `overflow:auto` của `<main>` cắt
 * mất 1px - lặp y hệt ở cả 1280px lẫn 1500px, không phải ngẫu nhiên.
 *
 * Trần 22 ký tự đo ra popup khoảng 220px. Con số này lấy từ ô CHẬT NHẤT trong
 * hai chỗ dùng, là hàng trên trang Cấu hình: ô đóng chỉ 176px mà nằm sát mép
 * phải của panel, nên popup chỉ được phép thò thêm khoảng 57px. Trần 28 ký tự
 * (popup 244px) vẫn còn thò 11px ra ngoài cửa sổ - đã đo.
 *
 * Thêm mốc mới mà viết hint dài hơn là mở lại đúng lỗi đó, nên có test chặn.
 */
export const TRAN_KY_TU_HINT = 22;

/**
 * Cửa sổ ngữ cảnh - trần token cho phần VÀO của một lần gọi model.
 *
 * Số tra ngày 2026-08-22:
 * - Claude Opus 5 / Sonnet 5: 1M; Haiku 4.5: 200K (tài liệu chính thức
 *   Anthropic - vài trang tổng hợp bên thứ ba ghi Haiku 4.5 là 256K, lấy theo
 *   tài liệu gốc)
 * - GPT-5.6 Sol / Terra / Luna: 1,05M
 * - Gemini 3.1 Pro / 3 Flash / 3.1 Flash-Lite: 1M
 * - 256K là TRUNG VỊ của mọi model được theo dõi tính tới 19/08/2026, nên nó ở
 *   đây với tư cách mốc phổ biến chứ không phải của riêng một model: Mistral
 *   Large 3 và Medium 3.5, Kimi K2.6, Qwen3, GLM, ERNIE, Doubao, Hunyuan.
 */
export const MOC_CUA_SO_NGU_CANH: readonly MocSoGoiY[] = [
  { value: 32_000, label: "32.000", hint: "model nhỏ, máy riêng" },
  { value: 128_000, label: "128.000", hint: "phổ thông, an toàn" },
  { value: 200_000, label: "200.000", hint: "Claude Haiku 4.5" },
  { value: 256_000, label: "256.000", hint: "Mistral 3, Qwen3, GLM" },
  { value: 1_000_000, label: "1.000.000", hint: "Claude 5, Gemini 3.1" },
  { value: 1_050_000, label: "1.050.000", hint: "GPT-5.6" },
  { value: 2_000_000, label: "2.000.000", hint: "tối đa cho phép" },
];

/**
 * Trần token bot VIẾT RA trong một bước.
 *
 * Khác với cửa sổ ngữ cảnh, mốc ở đây KHÔNG chọn tự do được: hai luật chéo
 * trong `runtime-tuning-settings.ts` kẹp nó từ hai phía, và với bộ mặc định
 * (cửa sổ 128.000, `DOCUMENT_MAX_CHARS` 20.000) khoảng hợp lệ chỉ là
 * 7.143 - 38.399.
 *
 *   dưới  -> `DOCUMENT_MAX_CHARS / 4 > tran * 0,7` chặn: bot viết cả nội dung
 *            file vào lệnh gọi công cụ, trần quá thấp là bị cắt giữa chừng và
 *            mất cả lượt.
 *   trên  -> `cửa sổ * 0,3 <= tran` chặn: bot chừa 30% cửa sổ cho phần viết ra,
 *            trần vượt phần chừa đó thì không còn chỗ cho ngữ cảnh.
 *
 * Mốc 4.096 / 64.000 / 128.000 CỐ Ý vẫn nằm đây dù bộ mặc định từ chối chúng:
 * chúng hợp lệ khi người dùng chỉnh kèm tham số đi cặp, và câu báo lỗi của luật
 * chéo nói thẳng phải chỉnh cái nào. Bỏ chúng đi là giấu mất một nửa dải hợp lệ
 * của những cấu hình không mặc định.
 *
 * Số tra ngày 2026-08-22: Claude Opus 5 / Sonnet 5 / Fable 5 và GPT-5.6 đều
 * 128.000; Claude Haiku 4.5 64.000; Gemini 3.1 Pro 65.536.
 */
export const MOC_TRAN_TOKEN_VIET_RA: readonly MocSoGoiY[] = [
  { value: 4_096, label: "4.096", hint: "trả lời ngắn, rẻ" },
  { value: 8_192, label: "8.192", hint: "đủ cho chat thường" },
  { value: 16_384, label: "16.384", hint: "mặc định, đủ tạo file" },
  { value: 32_000, label: "32.000", hint: "viết dài, báo cáo" },
  { value: 64_000, label: "64.000", hint: "trần Haiku 4.5, Gemini" },
  { value: 128_000, label: "128.000", hint: "trần Claude 5, GPT-5.6" },
];

/** Giá trị đang đặt có trùng một mốc trong danh sách không */
export function laMocCoSan(danhSach: readonly MocSoGoiY[], so: number): boolean {
  return danhSach.some((m) => m.value === so);
}

/**
 * Ô đang phải hiện Ô NHẬP TAY, hay chỉ cần menu mốc?
 *
 * Dùng chung cho trang Cấu hình và trang Agents - hai bên từng viết riêng cùng
 * một biểu thức này, mà lệch nhau ở đây thì ô rơi về chế độ sai và không có gì
 * báo.
 *
 * `daBamTuyChinh` phải THẮNG mọi thứ khác: suy hoàn toàn từ giá trị thì vừa
 * bấm "Tùy chỉnh" xong ô lại nhảy về menu (giá trị hiện tại vẫn đang trùng một
 * mốc), tức là không bao giờ vào được chế độ nhập tay.
 *
 * Chuỗi RỖNG không phải nhập tay: ở trang Agents nó mang nghĩa "theo Cấu hình
 * chung" và menu có sẵn một mục cho nghĩa đó.
 *
 * Chuỗi RÁC thì có: giá trị hỏng phải lộ ra trong ô nhập để người ta còn sửa,
 * giấu nó sau một menu là người dùng thấy menu trống mà không hiểu vì sao.
 */
export function dangNhapTayCuaSo(
  danhSach: readonly MocSoGoiY[],
  giaTri: string,
  daBamTuyChinh: boolean,
): boolean {
  if (daBamTuyChinh) return true;
  const s = giaTri.trim();
  if (s === "") return false;
  return !laMocCoSan(danhSach, Number(s));
}

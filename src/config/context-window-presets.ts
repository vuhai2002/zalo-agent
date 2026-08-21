/**
 * Các mốc cửa sổ ngữ cảnh chọn nhanh, dùng chung cho trang Cấu hình và trang
 * Agents.
 *
 * VÌ SAO LÀ FILE RIÊNG: hai trang đó lấy dữ liệu theo hai đường khác hẳn nhau -
 * trang Cấu hình nhận `TUNING_DEFS` qua JSON của `GET /api/tuning`, còn trang
 * Agents dựng form từ hằng số cục bộ (nếp của `MUC_SUY_NGHI`). Để danh sách ở
 * mỗi bên một bản thì hai trang sẽ lệch nhau sau vài lần đời model đổi, mà
 * lệch kiểu đó không có gì báo. File này KHÔNG import gì cả nên trình duyệt
 * nạp được thẳng, không kéo theo module Node nào.
 *
 * VÌ SAO TÁCH `label` VỚI `hint`: `SelectMenu` cắt bớt `hint` TRƯỚC và giữ
 * `label` nguyên vẹn (`label` có `flex-1`, `hint` chỉ `shrink`). Nhét cả số lẫn
 * tên model vào một chuỗi thì ô hẹp cắt mất phần đuôi và ra "128.000 - phổ
 * thông, an toàn cho mọ..." - đã dính thật. Để số ở `label` thì số luôn đọc
 * được, còn tên model là chú thích, cắt bớt cũng không sao.
 *
 * ĐÂY LÀ MỐC GỢI Ý, KHÔNG PHẢI DANH SÁCH ĐÓNG. Ô nhập tay vẫn còn (mục "Tùy
 * chỉnh"), nhận mọi giá trị trong khoảng 4.000 - 2.000.000 đúng như schema env.
 * Tên model sẽ lạc hậu - khi đó sửa NHÃN, đừng bỏ mốc đi: người đang dùng mốc
 * cũ mà mốc biến mất thì ô của họ rơi về chế độ tùy chỉnh không rõ lý do.
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

export type MocCuaSoNguCanh = {
  value: number;
  /** CHỈ con số. Đây là phần phải sống sót khi ô hẹp. */
  label: string;
  /** Model tiêu biểu - chú thích, được phép cắt bớt khi hẹp. */
  hint: string;
};

export const MOC_CUA_SO_NGU_CANH: readonly MocCuaSoNguCanh[] = [
  { value: 32_000, label: "32.000", hint: "model nhỏ, máy riêng" },
  { value: 128_000, label: "128.000", hint: "phổ thông, an toàn" },
  { value: 200_000, label: "200.000", hint: "Claude Haiku 4.5" },
  { value: 256_000, label: "256.000", hint: "Mistral 3, Qwen3, GLM" },
  { value: 1_000_000, label: "1.000.000", hint: "Claude 5, Gemini 3.1" },
  { value: 1_050_000, label: "1.050.000", hint: "GPT-5.6" },
  { value: 2_000_000, label: "2.000.000", hint: "tối đa cho phép" },
];

/**
 * Trần độ dài `hint`, có TEST canh.
 *
 * Popup của `SelectMenu` là `min-w-max` nên nó rộng bằng mục dài nhất. Đo trên
 * trang Agents: hint 38-39 ký tự làm popup 323px, mà cột phải của form nằm sát
 * mép cửa sổ nên popup chạm đúng biên và bị `overflow:auto` của `<main>` cắt
 * mất 1px - lặp y hệt ở cả 1280px lẫn 1500px, không phải ngẫu nhiên.
 *
 * Trần 22 ký tự đo ra popup khoảng 225px. Con số này lấy từ ô CHẬT NHẤT trong
 * hai chỗ dùng, là hàng trên trang Cấu hình: ô đóng chỉ 176px mà nằm sát mép
 * phải của panel, nên popup chỉ được phép thò thêm khoảng 57px. Trần 28 ký tự
 * (popup 244px) vẫn còn thò 11px ra ngoài cửa sổ - đã đo.
 *
 * Thêm mốc mới mà viết hint dài hơn là mở lại đúng lỗi đó, nên có test chặn.
 */
export const TRAN_KY_TU_HINT = 22;

/** Giá trị đang đặt có trùng một mốc gợi ý không */
export function laMocCoSan(so: number): boolean {
  return MOC_CUA_SO_NGU_CANH.some((m) => m.value === so);
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
export function dangNhapTayCuaSo(giaTri: string, daBamTuyChinh: boolean): boolean {
  if (daBamTuyChinh) return true;
  const s = giaTri.trim();
  if (s === "") return false;
  return !laMocCoSan(Number(s));
}

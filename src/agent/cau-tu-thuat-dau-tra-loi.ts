/**
 * Bỏ câu "nhận xét dữ liệu" model lỡ viết ở ĐẦU câu trả lời chốt.
 *
 * Nguồn gốc: khối "kể tiến trình" của persona dạy model mở đầu bước sau khi tool
 * trả về bằng một câu nhận xét ("Đủ 2 nguồn khớp nhau - giờ đối chiếu và trả
 * lời."). Bước đó thường CHÍNH là bước viết câu trả lời, nên câu nhận xét dính
 * vào đầu tin gửi Zalo: đo prod 30 ngày, 17/94 lượt có tool - phần lớn là bản
 * tin theo lịch gửi chủ động ("Đã đọc ba nguồn; mình chọn ba tin..."). Persona
 * đã sửa; đây là lưới đỡ cho lần model vẫn viết, vì persona không tất định.
 *
 * CHẶT có chủ ý - cắt nhầm là mất nội dung thật: chỉ lượt có gọi tool, chỉ MỘT
 * đoạn đầu (tới dấu xuống dòng đầu tiên), đoạn đó ngắn, có dấu hiệu nhận xét
 * nguồn/dữ liệu, KHÔNG gọi người dùng hay mang định dạng (câu trả lời thật trên
 * prod luôn mở bằng "Dạ/... ơi/nhé", tiêu đề, in đậm hoặc emoji), và phía sau
 * còn nội dung. Hàm thuần.
 */

/** Đoạn dài hơn thế nhiều khả năng là nội dung thật, không phải một câu nhận xét */
const DO_DAI_TOI_DA = 400;

// `\b` của JS chỉ hiểu chữ ASCII - ranh giới từ tiếng Việt phải tự dựng
const CUOI_TU = "(?=[\\s,.;:!?)]|$)";
const DAU_TU = "(?:^|[\\s,.;:(])";

const DAU_HIEU_NHAN_XET = new RegExp(
  [
    "đã đọc",
    "đã đủ",
    `đủ (?:để|dữ|nội dung|hai|ba|bốn|năm|\\d)`,
    "đối chiếu",
    "nguồn",
    "ngày đăng",
    "đăng ngày",
    `mình (?:sẽ|chọn|giữ)${CUOI_TU}`,
  ].join("|"),
  "iu",
);

const DAU_HIEU_TRA_LOI = new RegExp(
  [
    "^(?:Dạ|Vâng|Chào)" + CUOI_TU,
    `${DAU_TU}(?:ơi|nhé|nha|ạ|nè)${CUOI_TU}`,
    "\\*\\*",
    "^(?:#|[-*•>]\\s|\\d+[.)]\\s)",
    "\\p{Extended_Pictographic}",
  ].join("|"),
  "u",
);

export function boCauTuThuatDau(text: string, p: { coGoiTool: boolean }): { text: string; daBo: boolean } {
  const giuNguyen = { text, daBo: false };
  if (!p.coGoiTool) return giuNguyen;
  const xuongDong = text.indexOf("\n");
  if (xuongDong < 0) return giuNguyen;
  const doanDau = text.slice(0, xuongDong).trim().normalize("NFC");
  const phanSau = text.slice(xuongDong + 1).trim();
  if (!doanDau || !phanSau || doanDau.length > DO_DAI_TOI_DA) return giuNguyen;
  if (!DAU_HIEU_NHAN_XET.test(doanDau) || DAU_HIEU_TRA_LOI.test(doanDau)) return giuNguyen;
  return { text: phanSau, daBo: true };
}

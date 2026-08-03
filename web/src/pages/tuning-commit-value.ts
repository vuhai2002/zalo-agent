/**
 * Giá trị THẬT SỰ gửi lên server khi người dùng đổi một tham số cấu hình.
 *
 * Chọn đúng giá trị mặc định thì gửi `null` (xóa dòng đè) chứ KHÔNG ghi lại
 * giá trị đó.
 *
 * Lỗi đã gặp: tắt một công tắc rồi bật lại. Lần tắt ghi `false` vào DB, lần bật
 * ghi `true` - trùng y hệt mặc định, nhưng dòng DB vẫn còn nên cờ `fromEnv` vẫn
 * false và giao diện báo "đã chỉnh" mãi. Người dùng nhìn thấy công tắc đúng
 * như lúc đầu mà nhãn cứ nói ngược lại.
 *
 * Xóa dòng đè chứ không giữ lại một dòng trùng giá trị còn để giữ đúng ngữ
 * nghĩa "không đè = đi theo mặc định": sau này đổi giá trị mặc định trong
 * schema thì ô đó đi theo, chứ không bị ghim âm thầm vào con số cũ.
 *
 * Hàm thuần, không import gì.
 */

export type GiaTriTuning = number | boolean | string;

export function giaTriGuiDi(chon: GiaTriTuning, macDinh: GiaTriTuning): GiaTriTuning | null {
  // So sánh chặt (`===`) là đúng ở đây: cả hai vế đều đã qua schema nên cùng
  // kiểu. So lỏng sẽ coi 0 bằng false và "7" bằng 7 - đủ để một ô số nhận nhầm
  // là "đang ở mặc định" rồi im lặng xóa mất lựa chọn của người dùng.
  return chon === macDinh ? null : chon;
}

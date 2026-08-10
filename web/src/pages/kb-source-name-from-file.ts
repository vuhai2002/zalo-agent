import { DINH_DANG_HO_TRO } from "../shared/kb-formats";

/**
 * Tên nguồn gợi ý từ tên file: bỏ phần mở rộng, gọn khoảng trắng, cắt theo trần
 * của server.
 *
 * 200 là trần THẬT ở `tenNguonSchema` (`kb-route-guards.ts`) - cắt ở client để
 * người dùng không thả file xong mới ăn 400. Tên file dài quá 200 ký tự là bất
 * thường nhưng có thật (tài liệu xuất từ hệ thống khác hay đặt tên rất dài).
 */
const TRAN_TEN = 200;

/**
 * Chỉ bỏ đuôi khi nó là MỘT TRONG 5 ĐỊNH DẠNG được hỗ trợ, không bỏ mọi thứ
 * trông giống đuôi file.
 *
 * Một mẫu chung kiểu `\.[a-zA-Z0-9]{1,8}$` cắt nhầm những tên hợp lệ mà dấu
 * chấm là một phần của TÊN: "Công ty TNHH A.B.C" thành "Công ty TNHH A.B",
 * "Báo cáo Q1.2026" thành "Báo cáo Q1". Ô chọn file chỉ nhận đúng 5 đuôi này
 * (`accept`) nên không có gì để mất khi bó hẹp lại, mà cắt nhầm tên thì tên sai
 * đó đi vào MỌI kết quả kb_search về sau.
 */
const DUOI_HO_TRO = new RegExp(`\\.(${DINH_DANG_HO_TRO.join("|")})$`, "i");

export function tenNguonTuTenFile(tenFile: string): string {
  const khongDuoi = tenFile.replace(DUOI_HO_TRO, "");
  const gon = khongDuoi.replace(/\s+/g, " ").trim();
  return gon.slice(0, TRAN_TEN);
}

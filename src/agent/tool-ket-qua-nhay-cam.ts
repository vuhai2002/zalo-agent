import { laKetQuaLoi } from "./tools/tool-failure-result.js";

/**
 * Tool có kết quả là DỮ LIỆU NHẠY CẢM của người dùng (tệp họ gửi: sao kê ngân
 * hàng, giấy tờ có số hộ chiếu, hợp đồng). Kết quả của chúng KHÔNG được vào
 * log (300 ký tự đầu mỗi kết quả tool) hay trace (lưu nhiều ngày, hiện trên
 * dashboard) - chỉ còn độ dài.
 *
 * Kết quả HỎNG (`ketQuaLoi`) giữ nguyên: câu lỗi do máy chủ viết, không chứa
 * chữ của tệp, và cần cho chẩn đoán + `tool-loop-guard`.
 */
export const TOOL_KET_QUA_NHAY_CAM: ReadonlySet<string> = new Set(["doc_file"]);

export function anKetQuaNhayCam(toolName: string | undefined, output: unknown): unknown {
  if (!toolName || !TOOL_KET_QUA_NHAY_CAM.has(toolName) || laKetQuaLoi(output)) return output;
  const doDai = typeof output === "string" ? output.length : (JSON.stringify(output) ?? "").length;
  return `[nội dung tệp - không ghi log, ${doDai} ký tự]`;
}

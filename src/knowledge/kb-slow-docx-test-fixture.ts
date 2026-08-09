import { docxTuXml } from "./ooxml-zip-test-helper.js";

/**
 * docx HỢP LỆ - nằm TRONG mọi trần của `ooxml-limits.ts` - nhưng đủ NHIỀU đoạn
 * để trích xuất tốn hàng trăm mili-giây CPU THẬT. Dùng để test worker bị
 * `terminate()` khi quá hạn (phase 02: trích xuất trong worker thread).
 *
 * SAU phase 01 (đọc docx bằng SAX tuyến tính, thay cặp regex O(n^2) cũ),
 * không còn cách nào dựng bom ReDoS bậc hai nữa - đây là cách DUY NHẤT còn lại
 * để có một file "trong giới hạn hợp lệ" mà vẫn tốn CPU thật đo được: **đo
 * trên máy dev** (script trong báo cáo phase này), 500.000 đoạn nhỏ mất
 * khoảng 900 ms trích xuất tuyến tính - đủ margin so với `hanMs` nhỏ (100-300
 * ms) dùng ở test, vì `worker.terminate()` cắt NGAY tại `hanMs` bất kể tổng
 * thời gian thật của bom dài bao nhiêu.
 */
export function bomQuayCpuDocx(soDoan = 500_000): Buffer {
  const body = Array.from({ length: soDoan }, (_, i) => `<w:p><w:r><w:t>abc${i}</w:t></w:r></w:p>`).join("");
  return docxTuXml(body);
}

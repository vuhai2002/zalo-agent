import assert from "node:assert/strict";
import { laKetQuaLoi } from "./tool-failure-result.js";

/**
 * Trợ giúp cho test của các tool. KHÔNG dùng ở code chạy thật.
 *
 * Có hai hàm vì test tool có đúng hai kiểu khẳng định, và trộn chúng lại là
 * cách chắc chắn nhất để đánh mất bất biến vừa dựng.
 */

/**
 * Khẳng định kết quả là nhánh HỎNG rồi trả câu bên trong để `assert.match` tiếp.
 *
 * Dùng ở mọi test vốn viết `assert.match(result, /...)` cho một nhánh lỗi. Cách
 * lười hơn là bóc `.loi` ra rồi so chuỗi - nhưng làm vậy thì test xanh kể cả khi
 * tool quên đánh dấu, tức là bất biến "nhánh hỏng phải đánh dấu được" không có
 * ai canh. Ở đây kiểm hình dạng TRƯỚC.
 */
export function loiCuaTool(ketQua: unknown): string {
  assert.ok(
    laKetQuaLoi(ketQua),
    `Mong nhánh hỏng có đánh dấu (ketQuaLoi), nhận: ${JSON.stringify(ketQua)?.slice(0, 200)}`,
  );
  return ketQua.loi;
}

/**
 * Khẳng định kết quả là nhánh THÀNH CÔNG (chuỗi trần) rồi trả chính nó.
 *
 * Cần cặp đôi với hàm trên: đánh dấu nhầm một nhánh thành công thành hỏng thì
 * guard đếm oan và chặn lượt đang chạy tốt - hỏng theo hướng ngược lại nhưng
 * cũng tệ ngang.
 */
export function ketQuaThanhCong(ketQua: unknown): string {
  assert.equal(
    typeof ketQua,
    "string",
    `Mong nhánh thành công trả chuỗi trần, nhận: ${JSON.stringify(ketQua)?.slice(0, 200)}`,
  );
  return ketQua as string;
}

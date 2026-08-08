/**
 * Hợp nhất Reciprocal Rank Fusion (RRF): trộn N danh sách ĐÃ XẾP HẠNG thành
 * một, theo THỨ HẠNG chứ không theo điểm số gốc của từng danh sách.
 *
 * Lý do trộn theo hạng chứ không theo điểm: các bộ xếp hạng khác nhau dùng
 * thang điểm không so được với nhau (bm25 ra số ÂM không có trần, cosine của
 * vector ra 0-1) - cộng thẳng điểm là cộng hai đơn vị khác nhau. Đợt này chỉ
 * có MỘT danh sách (bm25) nên hàm này là phép đồng nhất (giữ nguyên thứ tự,
 * không tốn gì); đợt sau thêm danh sách vector chỉ là thêm một phần tử vào
 * mảng `ds`, không phải sửa công thức.
 *
 * Công thức: diem(item) = tổng theo từng danh sách của 1 / (k + hạng), hạng
 * đếm từ 1. `k` nhỏ làm top của mỗi danh sách có trọng lượng hơn.
 *
 * Module THUẦN - không import gì, không biết gì về SQLite hay bất kỳ nguồn
 * dữ liệu nào. `khoaCua` cho phép gọi hợp nhất trên bất kỳ kiểu item nào,
 * miễn có cách rút ra một khóa để nhận biết "cùng một item" giữa các danh sách.
 */

export type DanhSachXepHang<T> = T[];

export function hopNhatRrf<T>(
  ds: DanhSachXepHang<T>[],
  khoaCua: (x: T) => string,
  k: number,
): { item: T; diem: number }[] {
  const diemTheoKhoa = new Map<string, number>();
  const itemTheoKhoa = new Map<string, T>();

  for (const danhSach of ds) {
    danhSach.forEach((item, chiSo) => {
      const khoa = khoaCua(item);
      const hang = chiSo + 1; // đếm từ 1, không từ 0
      diemTheoKhoa.set(khoa, (diemTheoKhoa.get(khoa) ?? 0) + 1 / (k + hang));
      if (!itemTheoKhoa.has(khoa)) itemTheoKhoa.set(khoa, item);
    });
  }

  return [...diemTheoKhoa.entries()]
    .map(([khoa, diem]) => ({ item: itemTheoKhoa.get(khoa)!, diem }))
    .sort((a, b) => b.diem - a.diem);
}

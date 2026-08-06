import type { EvalCase } from "./eval-case-type.js";

/**
 * Kiểm tra TIỀN ĐỀ: dịch vụ tra cứu web có còn sống không, TRƯỚC khi chạy case.
 *
 * Vì sao cần một bước riêng thay vì để case tự đỏ: khi tra cứu trả 0 kết quả,
 * case nghiên cứu vẫn đỏ - nhưng đỏ với lý do "không gọi web_fetch". Người đọc
 * bảng kết quả sẽ đi sửa persona, sửa model, sửa luật, trong khi thứ hỏng nằm ở
 * chỗ khác hẳn. Đã mất gần một giờ vì đúng chuyện này ngày 06/08/2026, và suýt
 * kết luận nhầm là luật persona vừa sửa làm model tệ đi.
 *
 * Cùng nếp với `dungEvalEnv` khi thiếu API key: thiếu tiền đề thì DỪNG HẲN,
 * không chạy nửa vời rồi đưa ra một bảng kết quả sai.
 *
 * Module THUẦN: hàm tìm kiếm tiêm từ ngoài vào nên test được mà không chạm mạng.
 */

/** Case này có phụ thuộc tra cứu web không - chỉ chúng mới cần tiền đề */
export function canTraCuuWeb(c: EvalCase): boolean {
  const ten = [
    ...(c.mongDoi.goiTool ?? []),
    ...Object.keys(c.mongDoi.goiToolItNhat ?? {}),
  ];
  return ten.some((t) => t === "web_search" || t === "web_fetch");
}

export type KetQuaTienDe = { ok: true } | { ok: false; loi: string };

/**
 * `timKiem` trả về SỐ kết quả. Chạy 2 truy vấn khác nhau rồi mới kết luận: một
 * truy vấn rỗng có thể chỉ là truy vấn xấu, hai truy vấn thường mà cùng rỗng
 * thì là dịch vụ chết.
 */
export async function kiemTraTienDeTraCuu(
  timKiem: (query: string) => Promise<number>,
  nhaCungCap: string,
): Promise<KetQuaTienDe> {
  const truyVan = ["tin kinh tế hôm nay", "thời tiết Hà Nội"];
  const soKetQua: number[] = [];

  for (const q of truyVan) {
    try {
      soKetQua.push(await timKiem(q));
    } catch {
      soKetQua.push(0);
    }
  }

  if (soKetQua.some((n) => n > 0)) return { ok: true };

  return {
    ok: false,
    loi:
      `Dịch vụ tra cứu web (${nhaCungCap}) trả về 0 kết quả cho cả ${truyVan.length} truy vấn thử.\n` +
      "  DỪNG bộ eval: mọi case tra cứu sẽ đỏ với lý do \"không gọi web_fetch\", mà đó là\n" +
      "  chẩn đoán SAI - model có tìm, chỉ là không nhận được URL nào để mở.\n" +
      "  Kiểm tra cấu hình tra cứu ở trang Tools trên dashboard (DuckDuckGo hay bị chặn;\n" +
      "  Brave cần API key), rồi chạy lại.",
  };
}

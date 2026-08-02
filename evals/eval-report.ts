/**
 * In bảng kết quả eval ra terminal.
 *
 * Tách khỏi runner vì đây là phần TRÌNH BÀY thuần: nhận kết quả đã có, không
 * quyết định gì. Module THUẦN nên test được mà không cần chạy model.
 *
 * Không dùng mã màu ANSI: bảng này chủ yếu đọc trên terminal Windows và hay bị
 * chép vào báo cáo, mà mã màu lọt vào đó thành rác. Nhãn chữ đọc rõ như nhau.
 */

export type KetQuaCase = {
  ten: string;
  dat: boolean;
  /** Vì sao hỏng - rỗng khi đạt */
  lyDoHong: string[];
  toolDaGoi: string[];
  tokens: number;
  giay: number;
  /** Chữ người dùng THẬT SỰ nhận (sau lớp làm sạch) */
  traLoi: string;
};

const cot = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}~` : s.padEnd(n));

export function inBang(kq: KetQuaCase[]): void {
  console.log("");
  console.log(`${cot("CASE", 16)} ${cot("KẾT QUẢ", 8)} ${cot("TOOL ĐÃ GỌI", 34)} ${cot("TOKEN", 8)} GIÂY`);
  console.log("-".repeat(80));
  for (const r of kq) {
    console.log(
      `${cot(r.ten, 16)} ${cot(r.dat ? "ĐẠT" : "HỎNG", 8)} ${cot(r.toolDaGoi.join(", ") || "(không)", 34)} ${cot(String(r.tokens), 8)} ${r.giay.toFixed(1)}`,
    );
  }
  console.log("-".repeat(80));

  const hong = kq.filter((r) => !r.dat);
  console.log(`${kq.length - hong.length}/${kq.length} đạt`);

  for (const r of hong) {
    console.log("");
    console.log(`HỎNG: ${r.ten}`);
    for (const l of r.lyDoHong) console.log(`  - ${l}`);
    // In cả câu trả lời: gần như lần nào cũng cần đọc nó để biết model đang
    // nghĩ gì, mà đi tìm trong log thì mất công
    console.log(`  Bot trả lời: ${JSON.stringify(r.traLoi.slice(0, 300))}`);
  }
}

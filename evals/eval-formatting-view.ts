/**
 * Cách eval NHÌN THẤY định dạng của câu trả lời.
 *
 * VÌ SAO CÓ FILE NÀY - lỗ hổng đã trả giá thật ngày 2026-08-05. `kiemTraText`
 * chỉ nhận CHỮ TRẦN sau khi đã dịch markdown, mà lúc đó dấu `**` biến mất rồi.
 * Nghĩa là mọi ca eval chỉ khẳng định được "không rò ký tự markdown ra chữ",
 * TUYỆT ĐỐI không đo được có in đậm hay không.
 *
 * Hệ quả: máy không có cách nào bắt lỗi định dạng, nên mọi lần đầu ra xấu đều do
 * người dùng phát hiện rồi báo lại. Luật persona vì thế cứ đắp thêm theo từng ca
 * lẻ thay vì được kiểm trên nhiều dạng tin.
 *
 * Kèm ĐOẠN CHỮ mà mỗi span tô, không chỉ mã style: khẳng định "có 5 span đậm"
 * gần như vô nghĩa, còn "span đậm phủ đúng mấy chữ đầu của mỗi mục" mới là thứ
 * người đọc cảm nhận được.
 */

/** Một vùng được tô, kèm đúng đoạn chữ nằm trong nó */
export type SpanDaGui = {
  /** Mã style của Zalo: `b`, `i`, `u`, `s`, `f_18`, `c_f27806`... */
  st: string;
  /** Đoạn chữ mà span này phủ - thứ người đọc thật sự thấy được tô */
  chu: string;
  /** Tin thứ mấy (đếm từ 1) - câu trả lời dài bị cắt nhiều tin */
  tin: number;
};

export type DinhDangDaGui = {
  /** Mọi span của mọi tin, theo thứ tự gửi */
  span: SpanDaGui[];
  /** Số tin Zalo thật sự nhận */
  soTin: number;
};

/** Mọi đoạn chữ được tô bằng một kiểu nhất định */
export function doanTheoKieu(dd: DinhDangDaGui, st: string): string[] {
  return dd.span.filter((s) => s.st === st).map((s) => s.chu);
}

/** Có bao nhiêu span kiểu này */
export function demKieu(dd: DinhDangDaGui, st: string): number {
  return dd.span.filter((s) => s.st === st).length;
}

/** Mã style hay dùng trong khẳng định - khỏi rải chuỗi ma thuật khắp các ca */
export const KIEU = {
  dam: "b",
  nghieng: "i",
  gachChan: "u",
  to: "f_18",
  do: "c_db342e",
  cam: "c_f27806",
  vang: "c_f7b503",
  xanh: "c_15a85f",
} as const;

/**
 * Dựng góc nhìn định dạng từ những gì fake API ghi lại.
 *
 * Cắt `chu` NGAY TẠI ĐÂY thay vì để từng ca tự cắt: `start`/`len` là đơn vị
 * UTF-16, cắt sai một chỗ là mọi khẳng định sau đó nói dối mà vẫn xanh.
 */
export function dungGocNhinDinhDang(
  tin: { msg: string; styles?: { start: number; len: number; st: string }[] }[],
): DinhDangDaGui {
  const span: SpanDaGui[] = [];
  for (const [i, t] of tin.entries()) {
    for (const s of t.styles ?? []) {
      span.push({ st: s.st, chu: t.msg.slice(s.start, s.start + s.len), tin: i + 1 });
    }
  }
  return { span, soTin: tin.length };
}

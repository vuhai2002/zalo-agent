/**
 * Ba ngưỡng của `tool-loop-guard` và hai phép suy ra chúng.
 *
 * Tách khỏi `tool-loop-guard.ts` vì đây là phần TÍNH SỐ, không phải phần đếm:
 * hai hàm dưới đây thuần túy nhận số trả số, không đụng tới trạng thái bộ đếm,
 * và cả hai đều có bẫy riêng cần giải thích dài (quan hệ với trần step, sàn 2).
 */

export type NguongGuard = {
  /** Cùng tool + cùng tham số + lại lỗi */
  chanLoiGiongHet: number;
  /** Cùng tool lỗi, tham số khác nhau */
  chanCungToolLoi: number;
  /** Tool đọc trả cùng kết quả lặp lại */
  chanKhongTienTrien: number;
};

/**
 * Ngưỡng cảnh báo suy ra từ ngưỡng chặn thay vì thêm 3 biến cấu hình nữa.
 * Tối thiểu 2 để lần lỗi ĐẦU không bao giờ bị cảnh báo - lỗi một lần là chuyện
 * thường, chưa phải vòng lặp.
 */
export function canhBaoTu(nguongChan: number): number {
  return Math.max(2, Math.floor(nguongChan / 2));
}

/**
 * Kẹp ngưỡng xuống dưới trần step, vì một ngưỡng cao bằng trần step là ngưỡng
 * KHÔNG BAO GIỜ tới lượt.
 *
 * Ba số mặc định (5/8/5) bê nguyên từ `tool_guardrails.py` của Hermes - nhưng bê
 * thiếu ngữ cảnh: ở Hermes `max_iterations` mặc định là **90**, nên 8 chỉ là 9%
 * ngân sách. Ở đây `LLM_MAX_STEPS` mặc định là **8**, nên ngưỡng 8 đứng đúng
 * bằng trần: mỗi step một lệnh gọi thì `stepCountIs` luôn dừng trước, bộ đếm
 * chạm 8 là chuyện không thể xảy ra.
 *
 * Kẹp ở đây chứ không hạ mặc định trong env: người đặt `LLM_MAX_STEPS=30` vẫn
 * được đúng ba con số của Hermes, còn người để mặc định thì guard vẫn nổ được.
 * Sàn 2 để không kẹp xuống 1 - chặn ngay lần lỗi đầu là quá tay.
 *
 * Nói cho đúng mức lợi: với trần mặc định 8 thì phép kẹp chỉ đưa
 * `chanCungToolLoi` từ 8 xuống 7, tức sớm hơn ĐÚNG một step, và lượt hết step
 * vốn đã đi vào lượt chốt sẵn. Giá trị thật của guard nằm ở chỗ nó ĐẾM ĐƯỢC
 * nhánh hỏng không-ném; kẹp chỉ để ngưỡng không nằm ngoài tầm với.
 */
export function nguongTheoTranStep(nguong: NguongGuard, tranStep: number): NguongGuard {
  const kep = (n: number) => Math.max(2, Math.min(n, tranStep - 1));
  return {
    chanLoiGiongHet: kep(nguong.chanLoiGiongHet),
    chanCungToolLoi: kep(nguong.chanCungToolLoi),
    chanKhongTienTrien: kep(nguong.chanKhongTienTrien),
  };
}

import type { EvalCase } from "./eval-case-type.js";

/**
 * Chấm một case: so kết quả quan sát được với mong đợi.
 *
 * Tách khỏi runner và giữ THUẦN có chủ đích - đây là chỗ dễ sai nhất mà lại
 * không thể kiểm bằng chính bộ eval (chạy model thật thì mỗi lần một kết quả).
 * Tách ra thì `pnpm test` chấm được nó bằng dữ liệu dựng tay.
 */

export type QuanSat = {
  /** Tên tool đã gọi, theo thứ tự, có lặp */
  toolDaGoi: string[];
  /** Chữ người dùng thật sự nhận */
  traLoi: string;
  /** Lượt ném lỗi thì đây là thông báo; null nếu chạy trót lọt */
  loiChay: string | null;
};

/**
 * Lượt này có THẬT SỰ chạy tới model không.
 *
 * BẮT BUỘC phải có, và đây là bài học từ lần chạy thật đầu tiên: bộ eval đi qua
 * `processBatch` - đúng đường production - mà hàm đó BẮT lỗi rồi nhắn câu "trục
 * trặc kỹ thuật" thay vì ném ra. Nên khi router từ chối (404 thiếu credential),
 * `loiChay` là null, không tool nào được gọi, và 3 trong 5 case báo ĐẠT:
 *
 *   - `khong-tra-thua`  mong "không gọi tool nào" -> lượt chết nên đúng là không
 *   - `cong-cu-hep`     mong "trả lời dài hơn 10 ký tự" -> câu báo lỗi dài hơn
 *   - `dinh-dang`       mong "không có markdown" -> câu báo lỗi không có
 *
 * Xanh đúng lúc hệ thống hỏng là kiểu xanh giả nguy hiểm nhất: nó nói ngược
 * hoàn toàn với sự thật.
 *
 * Nhận biết bằng HAI dấu hiệu độc lập, trúng cái nào cũng là hỏng:
 *
 *   - `totalTokens === 0`: nhánh lỗi của `message-turn-processor` chốt lượt bằng
 *     usage {0,0,0}. Lượt chạy thật không bao giờ 0 token.
 *   - Câu trả lời TRÙNG một trong các câu báo lỗi hệ thống. Dùng chính hằng số
 *     production truyền vào, không dò chữ tự chế.
 */
export function phatHienLuotHong(input: {
  tokens: number;
  traLoi: string;
  cauLoiHeThong: string[];
}): string | null {
  const sach = input.traLoi.trim();
  if (input.cauLoiHeThong.some((c) => sach === c.trim())) {
    return `Bot trả câu báo lỗi hệ thống - lượt agent đã hỏng, không phải hành vi của model`;
  }
  if (input.tokens === 0) {
    return "Lượt tiêu 0 token - chưa từng gọi được tới model";
  }
  return null;
}

export type KetQuaCham = { dat: boolean; lyDoHong: string[] };

export function chamCase(c: EvalCase, qs: QuanSat): KetQuaCham {
  const lyDoHong: string[] = [];

  // Lượt ném lỗi là HỎNG, không phải "không gọi tool nào nên đạt". Thiếu nhánh
  // này thì một case `khongGoiTool` sẽ XANH khi provider chết - đúng kiểu xanh
  // giả nguy hiểm nhất, vì nó xanh chính lúc hệ thống hỏng.
  if (qs.loiChay) {
    lyDoHong.push(`Lượt agent ném lỗi: ${qs.loiChay}`);
    return { dat: false, lyDoHong };
  }

  const daGoi = new Set(qs.toolDaGoi);

  for (const t of c.mongDoi.goiTool ?? []) {
    if (!daGoi.has(t)) {
      lyDoHong.push(`Phải gọi "${t}" nhưng không gọi (đã gọi: ${qs.toolDaGoi.join(", ") || "không tool nào"})`);
    }
  }

  for (const t of c.mongDoi.khongGoiTool ?? []) {
    if (daGoi.has(t)) lyDoHong.push(`Không được gọi "${t}" nhưng đã gọi`);
  }

  const kt = c.mongDoi.kiemTraText;
  if (kt && !kt.dat(qs.traLoi)) {
    lyDoHong.push(`Câu trả lời không đạt yêu cầu cấu trúc: ${kt.moTa}`);
  }

  // Không có mong đợi nào là case vô nghĩa - nó LUÔN xanh nên chỉ tổ làm bảng
  // kết quả trông đầy đặn hơn thực chất
  if (
    !c.mongDoi.goiTool?.length &&
    !c.mongDoi.khongGoiTool?.length &&
    !c.mongDoi.kiemTraText
  ) {
    lyDoHong.push("Case không khai mong đợi nào - luôn xanh nên vô nghĩa");
  }

  return { dat: lyDoHong.length === 0, lyDoHong };
}

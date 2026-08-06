import type { EvalCase } from "./eval-case-type.js";
import type { DinhDangDaGui } from "./eval-formatting-view.js";

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
  /** Tên + tham số JSON của từng lời gọi - cho `kiemTraToolArgs` */
  toolDaGoiKemArgs?: { name: string; input: string }[];
  /** Chữ người dùng thật sự nhận */
  traLoi: string;
  /**
   * Định dạng thật sự tới Zalo - cho `kiemTraDinhDang`.
   *
   * Tùy chọn để mọi chỗ dựng `QuanSat` bằng tay trong test cũ không phải sửa;
   * ca nào khẳng định định dạng mà thiếu trường này thì chấm HỎNG chứ không bỏ
   * qua - im lặng bỏ qua là đúng kiểu xanh giả mà cả file này sinh ra để chặn.
   */
  dinhDang?: DinhDangDaGui;
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

  // Đếm trên MẢNG chứ không trên Set - cả điểm của phép đo này là số lần
  for (const [t, soLanCan] of Object.entries(c.mongDoi.goiToolItNhat ?? {})) {
    const soLanThuc = qs.toolDaGoi.filter((x) => x === t).length;
    if (soLanThuc < soLanCan) {
      lyDoHong.push(`Phải gọi "${t}" ít nhất ${soLanCan} lần, thực tế ${soLanThuc} lần`);
    }
  }

  const kt = c.mongDoi.kiemTraText;
  if (kt && !kt.dat(qs.traLoi)) {
    lyDoHong.push(`Câu trả lời không đạt yêu cầu cấu trúc: ${kt.moTa}`);
  }

  const kdd = c.mongDoi.kiemTraDinhDang;
  if (kdd) {
    if (!qs.dinhDang) {
      lyDoHong.push(`Case khẳng định định dạng nhưng người chạy không cung cấp - xem QuanSat.dinhDang`);
    } else if (!kdd.dat(qs.dinhDang)) {
      lyDoHong.push(`Định dạng không đạt yêu cầu: ${kdd.moTa}`);
    }
  }

  const kta = c.mongDoi.kiemTraToolArgs;
  if (kta) {
    const cacLoiGoi = (qs.toolDaGoiKemArgs ?? []).filter((g) => g.name === kta.tool);
    if (cacLoiGoi.length === 0) {
      lyDoHong.push(`Phải gọi "${kta.tool}" để kiểm tham số nhưng không gọi lần nào`);
    } else if (!cacLoiGoi.some((g) => kta.dat(g.input))) {
      // Đạt khi CÓ ÍT NHẤT MỘT lời gọi đúng: model có thể gọi tool nhiều lần
      // trong một lượt, đòi mọi lời gọi đều đúng là nguồn đỏ ngẫu nhiên.
      const ds = cacLoiGoi.map((g) => g.input).join(" | ");
      lyDoHong.push(`Tham số "${kta.tool}" không đạt: ${kta.moTa} (đã gọi với: ${ds})`);
    }
  }

  // Không có mong đợi nào là case vô nghĩa - nó LUÔN xanh nên chỉ tổ làm bảng
  // kết quả trông đầy đặn hơn thực chất
  if (
    !c.mongDoi.goiTool?.length &&
    !c.mongDoi.khongGoiTool?.length &&
    !Object.keys(c.mongDoi.goiToolItNhat ?? {}).length &&
    !c.mongDoi.kiemTraText &&
    !c.mongDoi.kiemTraDinhDang &&
    !c.mongDoi.kiemTraToolArgs
  ) {
    lyDoHong.push("Case không khai mong đợi nào - luôn xanh nên vô nghĩa");
  }

  return { dat: lyDoHong.length === 0, lyDoHong };
}

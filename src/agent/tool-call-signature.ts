import { createHash } from "node:crypto";

/**
 * Chữ ký ổn định cho một lệnh gọi tool - nền của việc nhận ra "gọi y hệt lần
 * trước" trong `tool-loop-guard.ts`.
 *
 * Tách riêng vì đây là một mối quan tâm độc lập với việc ĐẾM: chuẩn hóa JSON và
 * băm có bẫy riêng (thứ tự khóa lồng nhau, giá trị không phải object), và có
 * bất biến riêng phải test (không được lộ tham số thô).
 */

/**
 * JSON chuẩn hóa: khóa sắp thứ tự ở MỌI cấp, không khoảng trắng.
 *
 * TRÁNH NÉM HẾT MỨC. Hàm này chạy trong `onStepFinish`, mà `notify()` của
 * ai@7.0.37 gọi callback trong `try { ... } catch (e) {}` - một catch RỖNG (đọc
 * ở `node_modules/ai/dist/index.js`). Ném ở đây không làm lượt đỏ lên: nó bị
 * nuốt sạch, guard ngừng đếm và trace ngừng ghi từ step đó trở đi, còn nhìn từ
 * ngoài thì mọi thứ vẫn xanh. Hỏng im lặng khó truy hơn hỏng ồn ào nhiều.
 *
 * Ba đường đã bịt - nói thẳng là chúng CHƯA tới được bằng dữ liệu thật của repo
 * (input tool đã qua Zod, không schema nào dùng `z.date()`/`z.bigint()`; output
 * tool chỉ là `string | KetQuaLoiTool`). Bịt vì rẻ và vì hàm này là hạ tầng
 * chung, không phải vì đã quan sát thấy:
 *
 *   - `bigint`: `JSON.stringify` ném TypeError thẳng.
 *   - Tham chiếu vòng: đệ quy không đáy, tràn stack.
 *   - Object KHÔNG THUẦN (Date, Map, Set): `Object.entries` trả rỗng nên mọi
 *     giá trị loại đó băm ra `{}` giống hệt nhau - hai lệnh gọi khác nhau bị
 *     coi là trùng, guard chặn oan. Date đi qua `toJSON` nên giữ được mốc giờ.
 *
 * CÒN đường ném chưa bịt, và đây mới là đường tới được: `input` của phần
 * `tool-error` là JSON THÔ do model sinh, chưa qua Zod - lồng sâu vài chục nghìn
 * cấp là `RangeError`. Cũng còn getter tự ném và `toJSON` tự ném (không tới được
 * bằng dữ liệu thật). Cả ba do `try/catch` bao ngoài trong `taoQuanSatStep` bắt,
 * hậu quả gói lại thành mất trace của đúng step đó kèm một dòng ERROR.
 */
export function chuanHoaJson(v: unknown, dangDuyet = new WeakSet<object>()): string {
  if (typeof v === "bigint") return JSON.stringify(`${v}n`);
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";

  if (dangDuyet.has(v)) return '"[vòng]"';
  dangDuyet.add(v);
  try {
    if (Array.isArray(v)) return `[${v.map((x) => chuanHoaJson(x, dangDuyet)).join(",")}]`;

    const proto: unknown = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      const toJSON = (v as { toJSON?: unknown }).toJSON;
      if (typeof toJSON === "function") {
        return chuanHoaJson((toJSON as () => unknown).call(v), dangDuyet);
      }
      return JSON.stringify(Object.prototype.toString.call(v));
    }

    const cap = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${cap.map(([k, val]) => `${JSON.stringify(k)}:${chuanHoaJson(val, dangDuyet)}`).join(",")}}`;
  } finally {
    // Xóa sau khi duyệt xong nhánh: cùng một object xuất hiện hai lần ở hai
    // nhánh SONG SONG là hợp lệ, chỉ vòng lặp mới là vấn đề.
    dangDuyet.delete(v);
  }
}

/** 16 ký tự đầu của SHA-256 - đủ để không đụng nhau trong phạm vi một lượt */
export function bamNgan(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/**
 * Chữ ký một lệnh gọi: tên tool + băm tham số đã chuẩn hóa.
 *
 * BĂM chứ không giữ tham số thô: guard sống suốt lượt, mà tham số tool chứa
 * nội dung người dùng gửi (đường dẫn file, câu hỏi, nội dung tài liệu). Giữ thô
 * là để dữ liệu riêng tư nằm trong bộ nhớ lâu hơn cần thiết, và dễ lọt vào log
 * khi ai đó in bộ đếm ra để chẩn đoán.
 */
export function chuKyLenhGoi(tenTool: string, args: unknown): string {
  return `${tenTool}#${bamNgan(chuanHoaJson(args ?? {}))}`;
}

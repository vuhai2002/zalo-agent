import { createHash } from "node:crypto";

/**
 * Chữ ký ổn định cho một lệnh gọi tool - nền của việc nhận ra "gọi y hệt lần
 * trước" trong `tool-loop-guard.ts`.
 *
 * Tách riêng vì đây là một mối quan tâm độc lập với việc ĐẾM: chuẩn hóa JSON và
 * băm có bẫy riêng (thứ tự khóa lồng nhau, giá trị không phải object), và có
 * bất biến riêng phải test (không được lộ tham số thô).
 */

/** JSON chuẩn hóa: khóa sắp thứ tự ở MỌI cấp, không khoảng trắng */
export function chuanHoaJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(chuanHoaJson).join(",")}]`;
  const cap = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${cap.map(([k, val]) => `${JSON.stringify(k)}:${chuanHoaJson(val)}`).join(",")}}`;
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

/** Lỗi tải có mã + kiểm host theo danh sách cho phép - dùng bởi `safe-remote-download.ts`. Module thuần. */

export type MaLoiTaiVe = "host-la" | "http" | "qua-lon" | "rong" | "chuyen-huong" | "khac";

/**
 * Lỗi tải có MÃ để caller rẽ nhánh không cần so chữ. `message` giữ đúng câu
 * tiếng Việt cũ nên caller cũ (đưa thẳng cho LLM/log) không đổi gì.
 */
export class LoiTaiVe extends Error {
  constructor(
    readonly ma: MaLoiTaiVe,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LoiTaiVe";
  }
}

/**
 * Lý do chặn một URL theo danh sách host (null = cho qua). Khớp `host === d`
 * hoặc `host` kết thúc bằng `.` + d - KHÔNG khớp đuôi trơn, nếu không
 * `notdlfl.vn` lọt qua danh sách `dlfl.vn`.
 */
export function kiemHostDuocPhep(url: URL, hostDuocPhep?: readonly string[], chiHttps?: boolean): string | null {
  if (chiHttps && url.protocol !== "https:") return "Chỉ nhận đường tải https";
  if (!hostDuocPhep) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const ok = hostDuocPhep.some((d) => host === d || host.endsWith(`.${d}`));
  return ok ? null : `Máy chủ "${host}" không được phép tải tệp`;
}

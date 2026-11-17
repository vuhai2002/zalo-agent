import { phucVuTienTrinhCon } from "../shared/phuc-vu-tien-trinh-con.js";
import { renderTrangJpeg, type AnhTrang } from "./render-trang-pdf.js";

/**
 * Thân TIẾN TRÌNH CON render trang PDF quét thành JPEG, dựng bởi
 * `trich-xuat-tep.ts`. Tách khỏi tiến trình đọc chữ: chỉ việc render mới cần
 * nạp `@napi-rs/canvas`. Chỉ import module THUẦN, không gọi mạng.
 */
export type DuLieuRender = { buf: Buffer; soTrang: number[]; canhDaiPx: number; chatLuong: number };

phucVuTienTrinhCon<DuLieuRender, AnhTrang[]>(({ buf, soTrang, canhDaiPx, chatLuong }) =>
  // View thay vì Buffer.from(): không nhân đôi tệp trong RAM của con
  renderTrangJpeg(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength), soTrang, { canhDaiPx, chatLuong }),
);

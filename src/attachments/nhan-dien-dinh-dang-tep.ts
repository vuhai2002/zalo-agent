import { listZipEntries } from "../shared/read-zip-entry.js";
import { readImageSize } from "../zalo/zalo-image-variant.js";
import type { DinhDangTep } from "./attachment-extract-types.js";

/**
 * Nhận diện loại tệp bằng BYTE THẬT, không tin đuôi tên hay MIME.
 *
 * `href`, `fileSize`, `fileExt` của tin `share.file` đều do client người gửi
 * tự khai; MIME của CDN Zalo cũng không tin được (đo trên kho lưu trữ thật:
 * 121/990 tệp trả `application/octet-stream`). Một "x.pdf" có thể là trang
 * HTML báo link hết hạn, một "x.docx" có thể là zip bất kỳ.
 *
 * Trả `"cfb"` cho container OLE (Word 97-2003, hoặc Office có mật khẩu - Excel/
 * Word mã hóa đều bọc trong CFB): bước kiểm cấu trúc sau quyết đọc được là
 * `doc` hay báo có mật khẩu. Chỉ đọc vài byte đầu + mục lục zip, không giải nén gì.
 */

const MAGIC_CFB = Buffer.from("d0cf11e0a1b11ae1", "hex");
const DUOI_VAN_BAN = new Set(["txt", "csv", "md"]);
const CUA_SO_VAN_BAN = 64 * 1024;

function laUtf8(mau: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(mau);
    return true;
  } catch {
    // Cửa sổ 64 KB có thể cắt ngang một ký tự nhiều byte ở CUỐI - chỉ chấp
    // nhận khi phần hỏng nằm trong 3 byte chót.
    if (mau.length < CUA_SO_VAN_BAN) return false;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(mau.subarray(0, mau.length - 3));
      return true;
    } catch {
      return false;
    }
  }
}

const laBomUtf16 = (b: Buffer) => b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff));

/**
 * Chữ đọc được: UTF-16 có BOM (Excel "Unicode Text"), hoặc không có byte NUL
 * (UTF-8, hoặc mã 8-bit cũ như cp1258 - "CSV (Comma delimited)" mặc định của
 * Excel trên Windows tiếng Việt KHÔNG phải UTF-8).
 */
function laVanBan(mau: Buffer): boolean {
  return laBomUtf16(mau) || !mau.includes(0);
}

/** Giải mã tệp chữ: theo BOM, rồi UTF-8, cuối cùng cp1258. Bỏ BOM khỏi kết quả. */
export function giaiMaVanBan(buf: Buffer): string {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf-8");
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  if (laUtf8(buf.subarray(0, Math.min(buf.length, 4 * 1024 * 1024)))) return buf.toString("utf-8");
  return new TextDecoder("windows-1258").decode(buf);
}

function loaiZip(buf: Buffer): DinhDangTep {
  let ten: string[];
  try {
    ten = listZipEntries(buf);
  } catch {
    return "khong-ro";
  }
  if (ten.includes("word/document.xml")) return "docx";
  if (ten.includes("xl/workbook.xml")) return "xlsx";
  return "khong-ro";
}

export function nhanDienDinhDang(buf: Buffer, duoiKhai: string): DinhDangTep | "cfb" {
  if (buf.length === 0) return "khong-ro";
  // Magic nhị phân ở ĐẦU tệp trước, rồi mới quét "%PDF-" (cho phép rác đứng
  // trước header như pdf.js), cuối cùng mới tới chữ - tệp chữ nhắc "%PDF-1.7"
  // không được bị đẩy sang trình đọc PDF.
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return loaiZip(buf);
  if (buf.length >= 8 && buf.subarray(0, 8).equals(MAGIC_CFB)) return "cfb";
  if (readImageSize(buf)) return "anh";
  const laDuoiChu = DUOI_VAN_BAN.has(duoiKhai.toLowerCase());
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (laDuoiChu && laVanBan(buf.subarray(0, CUA_SO_VAN_BAN))) return "van-ban";
  if (buf.subarray(0, 1024).includes("%PDF-")) return "pdf";
  return "khong-ro";
}

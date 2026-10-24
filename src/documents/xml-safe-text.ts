/**
 * Bỏ ký tự mà XML 1.0 CẤM xuất hiện (kể cả dạng escape `&#1;`) khỏi chữ do
 * model đưa vào tài liệu.
 *
 * Vì sao: `docx` ghi thẳng ký tự điều khiển C0 vào `word/document.xml`, `exceljs`
 * lọc C0 nhưng vẫn ghi U+FFFE/U+FFFF vào `sharedStrings.xml` - đo bằng file thật
 * (docx 9.14, exceljs). XML hỏng thì Word/Excel từ chối mở CẢ FILE, người dùng
 * chỉ thấy "file bị lỗi". Chữ model sinh ra thường lẫn mấy ký tự này khi chép từ
 * trang web hay từ tin nhắn người khác dán vào.
 *
 * Bộ cấm (XML 1.0 mục 2.2 `Char`): U+0000-U+0008, U+000B, U+000C,
 * U+000E-U+001F, U+FFFE, U+FFFF, và nửa surrogate đứng lẻ (không ghép thành
 * cặp thì không phải ký tự Unicode nào cả). GIỮ tab, xuống dòng, CR. Không bỏ
 * C1 (U+0080-U+009F): XML 1.0 vẫn cho phép.
 *
 * Regex KHÔNG cờ `u` là cố ý: phải nhìn từng code unit mới thấy được surrogate lẻ.
 * Mỗi nhánh khớp đúng một code unit, không lượng từ - tuyến tính.
 */
const KY_TU_XML_CAM_RE =
  /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function boKyTuXmlCam(text: string): string {
  return text.replace(KY_TU_XML_CAM_RE, "");
}

/**
 * Áp `boKyTuXmlCam` lên MỌI chuỗi trong dữ liệu tài liệu (mảng/object lồng nhau),
 * giữ nguyên số, boolean, cấu trúc.
 *
 * Làm một lần ở cửa vào của renderer thay vì rải vào từng chỗ dựng TextRun/ô:
 * renderer có hàng chục chỗ đọc chữ (tiêu đề, ô bảng, hai cột, ghi chú, tên
 * sheet...), sót một chỗ là file hỏng, và thêm block mới sau này tự được che.
 */
export function lamSachChuTaiLieu<T>(value: T): T {
  if (typeof value === "string") return boKyTuXmlCam(value) as T;
  if (Array.isArray(value)) return value.map((v) => lamSachChuTaiLieu(v)) as T;
  if (value !== null && typeof value === "object") {
    const ra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) ra[k] = lamSachChuTaiLieu(v);
    return ra as T;
  }
  return value;
}

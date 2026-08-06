import { z } from "zod";
import { XLSX_THEME_NAMES } from "./xlsx-themes.js";

/**
 * Schema nội dung tài liệu - hợp đồng giữa MODEL và renderer.
 *
 * Cố tình KHÔNG giống API của `docx`/`exceljs`: model chỉ cần hiểu vài khái niệm
 * quen thuộc (tiêu đề, đoạn văn, gạch đầu dòng, bảng), không phải biết DXA,
 * WidthType hay numFmt là gì. Đổi thư viện sau này chỉ sửa renderer - schema và
 * cách model gọi tool giữ nguyên.
 */

// ===== Tài liệu văn bản (.docx) =====

const headingBlock = z.object({
  type: z.literal("heading"),
  text: z.string().min(1),
  /**
   * Cấp tiêu đề 1-3. CỐ Ý dùng khoảng số chứ KHÔNG dùng union của literal, dù
   * union diễn tả đúng ý hơn: schema này bay thẳng sang nhà cung cấp LLM, mà
   * union literal số dịch ra `enum: [1]` - trong khi `Schema.enum` của Google
   * là `repeated string`, chỉ nhận chuỗi. Nó chối cả request bằng 400
   * "(TYPE_STRING), 1", và vì bộ tool đi kèm mọi lượt nên bot câm hoàn toàn
   * (đã dính thật 06/08/2026, cùng họ với vụ `z.tuple()` ở ô công thức Excel).
   * Khoảng số ra `{"type":"integer","minimum":1,"maximum":3}` - không có `enum`
   * nên không vướng, mà vẫn chặn 0, 4 và số lẻ y như union.
   */
  level: z.number().int().min(1).max(3).default(2),
});

const paragraphBlock = z.object({
  type: z.literal("paragraph"),
  text: z.string().min(1).describe("Bôi đậm giữa dòng bằng **chữ đậm**"),
  align: z
    .enum(["left", "center", "right", "justify"])
    .optional()
    .describe("center/right cho dòng lạc khoản (địa danh, ngày tháng); bỏ trống = justify"),
});

const bulletsBlock = z.object({
  type: z.literal("bullets"),
  items: z.array(z.string().min(1)).min(1),
});

const tableBlock = z.object({
  type: z.literal("table"),
  headers: z.array(z.string()).min(1).max(8),
  rows: z.array(z.array(z.string())).min(1),
});

/**
 * Hai cột đặt cạnh nhau, không viền - dành cho bố cục mà văn bản Việt Nam
 * dùng nhiều nhất: phần đầu văn bản hành chính (tên cơ quan bên trái, quốc
 * hiệu - tiêu ngữ bên phải) và khối ký tên cuối văn bản (nơi nhận bên trái,
 * chức vụ + tên người ký bên phải). Không có block này thì model phải fake
 * bằng khoảng trắng và bố cục vỡ ngay khi mở file.
 */
const twoColumnsBlock = z.object({
  type: z.literal("two_columns"),
  left: z.array(z.string()).min(1).describe("Các dòng cột trái, canh giữa trong cột"),
  right: z.array(z.string()).min(1).describe("Các dòng cột phải, canh giữa trong cột"),
});

export const documentBlockSchema = z.discriminatedUnion("type", [
  headingBlock,
  paragraphBlock,
  bulletsBlock,
  tableBlock,
  twoColumnsBlock,
]);

export type DocumentBlock = z.infer<typeof documentBlockSchema>;

// ===== Bảng tính (.xlsx) =====

/**
 * Ô công thức chỉ nhận PHÉP CÓ SẴN, không nhận công thức tự do.
 *
 * Lý do: file phải kèm giá trị đã tính (`<v>`) thì công cụ xem trước mới hiện số
 * thay vì ô trống. Bot chỉ tính được kết quả khi biết chính xác phép đang làm -
 * cho model gõ "=SUMIFS(...)" thì không tính nổi.
 */
const columnLetter = z
  .string()
  .regex(/^[A-Za-z]{1,2}$/)
  .transform((s) => s.toUpperCase());

const multiplyFormula = z.object({
  kind: z.literal("formula"),
  op: z.literal("multiply"),
  /**
   * Chữ cái 2 cột cùng dòng cần nhân, vd ["B", "C"].
   *
   * CỐ Ý dùng `array().length(2)` chứ KHÔNG dùng `z.tuple()`, dù tuple diễn tả
   * đúng ý hơn: schema này bay thẳng sang nhà cung cấp LLM, mà `z.tuple()` dịch
   * ra JSON Schema kiểu draft-07 với `items` là một MẢNG. Lớp OpenAI-compatible
   * của Google chỉ nhận 2020-12, ở đó `items` bắt buộc là object hoặc boolean,
   * nên nó chối CẢ REQUEST bằng 400 - và vì bộ tool đi kèm mọi lượt, bot câm
   * hoàn toàn chứ không riêng lượt nào nhờ làm Excel (đã dính thật 06/08/2026).
   * Ràng buộc lúc chạy y hệt tuple: đúng 2 phần tử, mỗi phần tử đúng dạng cột.
   */
  columns: z.array(columnLetter).length(2),
});

const sumFormula = z.object({
  kind: z.literal("formula"),
  op: z.literal("sum"),
  /** Cột cần cộng, vd "D" */
  column: columnLetter,
  /** Cộng từ dòng nào tới dòng nào (số dòng như hiện trên Excel, tính cả header) */
  fromRow: z.number().int().min(1),
  toRow: z.number().int().min(1),
});

const textCell = z.object({
  kind: z.literal("text"),
  value: z.string(),
});

const numberCell = z.object({
  kind: z.literal("number"),
  value: z.number(),
  /** money = #,##0 (đơn vị ghi ở header) · percent = 0.0% (lưu dạng phân số) */
  format: z.enum(["plain", "money", "percent"]).default("plain"),
});

const MULTIPLY_RE = /^=\s*([A-Za-z]{1,2})\d+\s*\*\s*([A-Za-z]{1,2})\d+\s*$/;
const SUM_RE = /^=\s*SUM\(\s*([A-Za-z]{1,2})(\d+)\s*:\s*([A-Za-z]{1,2})(\d+)\s*\)\s*$/i;

/**
 * Công thức viết dạng chuỗi "=B2*C2" / "=SUM(D2:D9)" - đây là cách model viết
 * TỰ NHIÊN nhất (đã thấy DeepSeek làm đúng vậy khi test), nên phải nhận thay vì
 * bắt nó học cấu trúc object riêng. Chuỗi "=" khác 2 dạng này bị từ chối kèm
 * hướng dẫn để model đổi sang số tính sẵn.
 */
const formulaString = z
  .string()
  .regex(/^=/)
  .transform((raw, ctx) => {
    const mul = raw.match(MULTIPLY_RE);
    if (mul) {
      return {
        kind: "formula",
        op: "multiply",
        columns: [mul[1]!.toUpperCase(), mul[2]!.toUpperCase()],
      } as const;
    }
    const sum = raw.match(SUM_RE);
    if (sum && sum[1]!.toUpperCase() === sum[3]!.toUpperCase()) {
      return {
        kind: "formula",
        op: "sum",
        column: sum[1]!.toUpperCase(),
        fromRow: Number(sum[2]),
        toRow: Number(sum[4]),
      } as const;
    }
    ctx.addIssue({
      code: "custom",
      message: `Chỉ hỗ trợ công thức "=B2*C2" (nhân 2 ô cùng dòng) hoặc "=SUM(D2:D9)" (cộng 1 cột). Công thức khác hãy tự tính rồi gửi số.`,
    });
    return z.NEVER;
  });

/**
 * Một ô nhận được NHIỀU dạng - chuỗi/số thuần là cách model gửi tự nhiên nhất
 * (giống bảng của tài liệu Word), object là dạng đầy đủ khi cần format.
 *
 * Dùng z.union thường, TUYỆT ĐỐI không discriminatedUnion theo "kind": hai
 * schema công thức cùng kind="formula" làm zod ném "Duplicate discriminator
 * value" ở MỌI lần parse - lỗi này từng làm create_excel_file chết 100% trên
 * Zalo thật trong khi toàn bộ test vẫn xanh (test gọi thẳng execute, không
 * qua tầng validate). Xem test hồi quy trong document-content-schema.test.ts.
 */
export const spreadsheetCellSchema = z.union([
  textCell,
  numberCell,
  multiplyFormula,
  sumFormula,
  formulaString,
  // Chuỗi "=" phải rơi vào formulaString ở trên - lọt xuống đây thành text là
  // công thức sai âm thầm biến thành chữ, người dùng không bao giờ biết
  z
    .string()
    .refine((s) => !s.startsWith("="))
    .transform((value) => ({ kind: "text", value }) as const),
  z.number().transform((value) => ({ kind: "number", value, format: "plain" }) as const),
]);

export type SpreadsheetCell = z.output<typeof spreadsheetCellSchema>;

export const sheetSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe('Tên sheet GIỮ NGUYÊN dấu tiếng Việt, vd "Tổng quan" (không viết "Tong quan")'),
  /** Bảng màu - model chọn theo ngữ cảnh tài liệu, không tự do hex */
  theme: z
    .enum(XLSX_THEME_NAMES)
    .optional()
    .describe(
      "Tông màu hợp nội dung: navy (trang trọng, mặc định) · blue (tài chính, báo giá) · " +
        "green (tăng trưởng, nông nghiệp, môi trường) · burgundy (rủi ro, pháp lý, sự cố) · " +
        "slate (kỹ thuật, vận hành) · teal (y tế, giáo dục, dịch vụ)",
    ),
  /** Banner tiêu đề nổi bật ở đầu sheet - nên có với báo cáo */
  title: z.string().optional().describe('Tiêu đề lớn đầu sheet, vd "BÁO CÁO TỔNG HỢP..."'),
  subtitle: z.string().optional().describe("Dòng phụ đề nhỏ dưới tiêu đề (phạm vi, khoảng thời gian)"),
  headers: z.array(z.string()).min(1).max(20),
  rows: z.array(z.array(spreadsheetCellSchema)).min(1),
  /** Ghi chú đỏ nghiêng cuối bảng - dùng cho lưu ý quan trọng, nguồn số liệu */
  note: z.string().optional().describe("Ghi chú/lưu ý quan trọng hiện cuối bảng"),
});

export type Sheet = z.output<typeof sheetSchema>;

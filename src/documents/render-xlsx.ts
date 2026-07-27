import ExcelJS from "exceljs";
import type { Sheet, SpreadsheetCell } from "./document-content-schema.js";
import { computeSheetValues } from "./spreadsheet-formula-values.js";
import {
  addNoteRow,
  addSubtitleRow,
  addTitleRow,
  cellBorder,
  FONT_NAME,
  FONT_SIZE,
  styleHeaderRow,
} from "./render-xlsx-styles.js";
import { resolveTheme, type XlsxTheme } from "./xlsx-themes.js";

/**
 * Dựng file .xlsx từ nội dung model cung cấp.
 *
 * LUẬT BẤT DI BẤT DỊCH: mọi ô công thức phải kèm `result`. Thiếu nó thì file chỉ
 * có `<f>` mà không có `<v>`, và mọi công cụ xem trước sẽ hiện ô TRỐNG. Đó là lý
 * do duy nhất project chọn exceljs thay vì thư viện nhẹ hơn - xem test hồi quy
 * trong render-xlsx.test.ts.
 *
 * Style (banner navy, header trắng trên navy, số xanh, ghi chú đỏ) bóc từ file
 * mẫu của skill xlsx Anthropic - nằm ở `render-xlsx-styles.ts`.
 */

// Đo trên file mẫu được chấm là đẹp: cột STT 5, cột nội dung 34-42.
// Rộng hơn 42 thì dòng chữ dài quá tầm mắt, hẹp hơn 5 thì số 2 chữ số bị ###
const MIN_COLUMN_WIDTH = 5;
const MAX_COLUMN_WIDTH = 42;

const NUMBER_FORMAT = {
  plain: "#,##0",
  money: "#,##0",
  // Lưu dạng phân số: 0.15 hiện thành 15.0%
  percent: "0.0%",
} as const;

/** Excel cấm : \ / ? * [ ] trong tên sheet và giới hạn 31 ký tự */
export function safeSheetName(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31);
  return cleaned || fallback;
}

/**
 * Ô chữ có marker `**đậm**` -> rich text của exceljs. Model được dạy marker này
 * (tool Word) nên ô Excel cũng phải hiểu - không parse thì dấu sao lọt nguyên
 * vào file. Font phải khai lại từng đoạn vì rich text ghi đè font của ô.
 */
function textCellValue(text: string): ExcelJS.CellValue {
  if (!text.includes("**")) return text;
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  const richText = parts
    .map((part, index) => ({
      text: part,
      font: { name: FONT_NAME, size: FONT_SIZE, bold: index % 2 === 1 },
    }))
    .filter((run) => run.text.length > 0);
  return richText.length > 0 ? { richText } : "";
}

/**
 * Giá trị đưa cho exceljs; ô công thức luôn kèm result đã tính sẵn.
 *
 * `rowOffset`: model đánh số dòng coi header là dòng 1, nhưng banner/subtitle
 * đẩy bảng xuống dưới - mọi tham chiếu dòng trong công thức phải cộng thêm
 * offset, không thì công thức trỏ nhầm vào banner.
 */
function cellValue(
  cell: SpreadsheetCell,
  excelRow: number,
  rowOffset: number,
  computed: number | null,
): ExcelJS.CellValue {
  if (cell.kind === "text") return textCellValue(cell.value);
  if (cell.kind === "number") return cell.value;

  const formula =
    cell.op === "multiply"
      ? `${cell.columns[0]}${excelRow}*${cell.columns[1]}${excelRow}`
      : `SUM(${cell.column}${cell.fromRow + rowOffset}:${cell.column}${cell.toRow + rowOffset})`;

  // result phải là số; không tính được thì để 0 còn hơn để trống (ô trống trong
  // preview trông như lỗi, số 0 thì người đọc biết ngay là chưa có dữ liệu)
  return { formula, result: computed ?? 0 };
}

/**
 * Style ô dữ liệu. Theo quy ước skill xlsx: số NHẬP TAY tô màu, ô công thức để
 * đen - người đọc phân biệt được đâu là dữ liệu gốc, đâu là kết quả tính. Màu
 * số lấy từ theme (đậm cùng tông) thay vì xanh thuần cho hài hòa cả trang.
 */
function styleDataCell(
  target: ExcelJS.Cell,
  cell: SpreadsheetCell,
  theme: XlsxTheme,
  isStripe: boolean,
): void {
  target.border = cellBorder(theme);
  // Sọc xen kẽ rất nhạt - mắt dò ngang bảng dài không bị lạc dòng
  if (isStripe) {
    target.fill = { type: "pattern", pattern: "solid", fgColor: { argb: theme.stripe } };
  }
  if (cell.kind === "text") {
    target.font = { name: FONT_NAME, size: FONT_SIZE };
    target.alignment = { wrapText: true, vertical: "top" };
    return;
  }
  if (cell.kind === "number") {
    target.font = { name: FONT_NAME, size: FONT_SIZE, color: { argb: theme.number } };
    target.numFmt = NUMBER_FORMAT[cell.format];
    return;
  }
  target.font = { name: FONT_NAME, size: FONT_SIZE };
  target.numFmt = NUMBER_FORMAT.money;
}

/** Bề rộng cột theo nội dung dài nhất, kẹp trong khoảng dễ đọc (dài thì wrap) */
function columnWidth(header: string, rows: SpreadsheetCell[][], colIndex: number): number {
  let longest = header.length;
  for (const row of rows) {
    const cell = row[colIndex];
    if (!cell) continue;
    const text =
      cell.kind === "text"
        ? cell.value
        : cell.kind === "number"
          ? cell.value.toLocaleString("vi-VN")
          : "0.000.000";
    longest = Math.max(longest, text.length);
  }
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, longest + 2));
}

export async function renderXlsx(sheets: Sheet[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>();

  sheets.forEach((sheet, sheetIndex) => {
    // exceljs THROW khi 2 sheet trùng tên (kể cả trùng sau khi sanitize) -
    // đánh số phía sau thay vì để chết cả file
    let name = safeSheetName(sheet.name, `Sheet${sheetIndex + 1}`);
    for (let n = 2; usedNames.has(name.toLowerCase()); n++) {
      name = `${safeSheetName(sheet.name, `Sheet${sheetIndex + 1}`).slice(0, 28)} ${n}`;
    }
    usedNames.add(name.toLowerCase());
    const ws = workbook.addWorksheet(name);
    const columnCount = sheet.headers.length;
    const computedValues = computeSheetValues(sheet);
    const theme = resolveTheme(sheet.theme);

    // Đặt bề rộng cột TRƯỚC khi thêm dòng để addNoteRow ước lượng được chiều cao
    ws.columns = sheet.headers.map((h, i) => ({ width: columnWidth(h, sheet.rows, i) }));

    if (sheet.title) addTitleRow(ws, sheet.title, columnCount, theme);
    if (sheet.subtitle) addSubtitleRow(ws, sheet.subtitle, columnCount, theme);
    if (sheet.title || sheet.subtitle) ws.addRow([]); // dòng thở giữa banner và bảng

    // Header vốn đã đậm - chỉ cần bỏ marker ** nếu model lỡ đặt
    const headerRow = ws.addRow(sheet.headers.map((h) => h.replaceAll("**", "")));
    styleHeaderRow(headerRow, theme);
    const headerRowNumber = headerRow.number;
    // Model đánh số dòng coi header = dòng 1; banner đẩy bảng xuống thì mọi
    // tham chiếu trong công thức phải dịch theo
    const rowOffset = headerRowNumber - 1;

    sheet.rows.forEach((row, rowIndex) => {
      const excelRow = headerRowNumber + 1 + rowIndex;
      const added = ws.addRow(
        row.map((cell, colIndex) =>
          cellValue(cell, excelRow, rowOffset, computedValues[rowIndex]?.[colIndex] ?? null),
        ),
      );
      row.forEach((cell, colIndex) =>
        styleDataCell(added.getCell(colIndex + 1), cell, theme, rowIndex % 2 === 1),
      );
    });

    if (sheet.note) addNoteRow(ws, sheet.note, columnCount);

    // Cuộn dài vẫn thấy banner + tên cột
    ws.views = [{ state: "frozen", ySplit: headerRowNumber }];
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

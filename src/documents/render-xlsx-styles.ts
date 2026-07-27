import type ExcelJS from "exceljs";
import type { XlsxTheme } from "./xlsx-themes.js";

/**
 * Cách trình bày file .xlsx - bóc từ file mẫu do Claude (skill xlsx) tạo mà
 * user chấm là "đẹp": banner tiêu đề chữ trắng trên nền đậm, header bảng wrap
 * + border, số liệu tô màu, ghi chú đỏ nghiêng.
 *
 * MÀU đến từ theme (model chọn theo ngữ cảnh - xem `xlsx-themes.ts`); mọi thứ
 * còn lại (cỡ chữ, chiều cao dòng, cách merge, wrap) cố định ở đây để 2 file
 * cùng theme luôn ra cùng một chất lượng.
 */

export const NOTE_RED = "FFC00000";
export const SUBTITLE_GRAY = "FFD9D9D9";
export const FONT_NAME = "Arial";
export const FONT_SIZE = 10;

export function cellBorder(theme: XlsxTheme): Partial<ExcelJS.Borders> {
  const thin = { style: "thin" as const, color: { argb: theme.border } };
  return { top: thin, bottom: thin, left: thin, right: thin };
}

/** Dòng banner tiêu đề: merge hết bề ngang, nền theme, chữ trắng 16pt */
export function addTitleRow(
  ws: ExcelJS.Worksheet,
  title: string,
  columnCount: number,
  theme: XlsxTheme,
): void {
  const row = ws.addRow([title]);
  // Chiều cao lấy đúng file mẫu đo được (25.5 / 15.75 / 30), không áng chừng
  row.height = 25.5;
  ws.mergeCells(row.number, 1, row.number, columnCount);
  const cell = row.getCell(1);
  cell.font = { name: FONT_NAME, size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: theme.header } };
  cell.alignment = { vertical: "middle" };
}

/** Dòng phụ đề dưới banner: nghiêng, xám nhạt trên cùng nền theme */
export function addSubtitleRow(
  ws: ExcelJS.Worksheet,
  subtitle: string,
  columnCount: number,
  theme: XlsxTheme,
): void {
  const row = ws.addRow([subtitle]);
  row.height = 15.75;
  ws.mergeCells(row.number, 1, row.number, columnCount);
  const cell = row.getCell(1);
  cell.font = { name: FONT_NAME, size: FONT_SIZE, italic: true, color: { argb: SUBTITLE_GRAY } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: theme.header } };
  cell.alignment = { vertical: "middle" };
}

/** Dòng header bảng: chữ trắng đậm trên nền theme, wrap, canh giữa, đủ viền */
export function styleHeaderRow(row: ExcelJS.Row, theme: XlsxTheme): void {
  row.height = 30;
  const border = cellBorder(theme);
  row.eachCell((cell) => {
    cell.font = { name: FONT_NAME, size: FONT_SIZE, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: theme.header } };
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
    cell.border = border;
  });
}

/** Dòng ghi chú cuối bảng: đỏ, nghiêng, merge hết bề ngang, wrap */
export function addNoteRow(ws: ExcelJS.Worksheet, note: string, columnCount: number): void {
  ws.addRow([]);
  const row = ws.addRow([note]);
  ws.mergeCells(row.number, 1, row.number, columnCount);
  const cell = row.getCell(1);
  cell.font = { name: FONT_NAME, size: FONT_SIZE, italic: true, color: { argb: NOTE_RED } };
  cell.alignment = { wrapText: true, vertical: "top" };
  // Ghi chú dài phải có chỗ thở - ước lượng số dòng theo tổng bề ngang
  const totalWidth = ws.columns.reduce((sum, c) => sum + (Number(c.width) || 10), 0);
  row.height = Math.max(16, Math.ceil(note.length / Math.max(20, totalWidth * 0.9)) * 14);
}

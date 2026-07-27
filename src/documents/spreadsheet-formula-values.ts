import type { Sheet, SpreadsheetCell } from "./document-content-schema.js";

/**
 * Tính sẵn KẾT QUẢ cho mọi ô công thức.
 *
 * Vì sao phải tự tính: file .xlsx lưu công thức ở `<f>` và kết quả đã tính ở
 * `<v>`. Excel mở lên tự tính lại nên không cần `<v>`, nhưng MỌI công cụ xem
 * trước (Zalo, Google Drive, Outlook) chỉ đọc `<v>` - thiếu là ô hiện trống.
 * Skill Anthropic giải bằng cách chạy LibreOffice recalc; bot tự tính được vì
 * chính nó sinh ra dữ liệu nên không cần thêm phần mềm nào.
 */

/** "A" -> 0, "B" -> 1, "AA" -> 26 */
export function columnLetterToIndex(letter: string): number {
  let index = 0;
  for (const ch of letter.toUpperCase()) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA" */
export function columnIndexToLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - rem) / 26);
  }
  return out;
}

/** Chuỗi công thức Excel (KHÔNG kèm dấu "=" - exceljs tự thêm khi ghi) */
export function formulaText(cell: SpreadsheetCell): string | null {
  if (cell.kind !== "formula") return null;
  if (cell.op === "multiply") {
    // Dòng thật trong Excel được điền lúc dựng bảng, chỗ này chỉ giữ cột
    return `${cell.columns[0]}{row}*${cell.columns[1]}{row}`;
  }
  return `SUM(${cell.column}${cell.fromRow}:${cell.column}${cell.toRow})`;
}

/**
 * Ma trận giá trị số của sheet, index theo [dòng dữ liệu][cột].
 * Ô chữ hoặc ô chưa tính được để `null`.
 *
 * Tính theo thứ tự từ trên xuống nên ô SUM ở dòng cuối cộng được cả những ô
 * multiply phía trên (trường hợp phổ biến nhất: cột "thành tiền" rồi dòng tổng).
 */
export function computeSheetValues(sheet: Sheet): (number | null)[][] {
  const values: (number | null)[][] = [];

  sheet.rows.forEach((row, rowIndex) => {
    const computed: (number | null)[] = [];
    row.forEach((cell, colIndex) => {
      computed[colIndex] = evaluateCell(cell, rowIndex, values, computed);
    });
    values.push(computed);
  });

  return values;
}

function evaluateCell(
  cell: SpreadsheetCell,
  rowIndex: number,
  doneRows: (number | null)[][],
  currentRow: (number | null)[],
): number | null {
  if (cell.kind === "number") return cell.value;
  if (cell.kind === "text") return null;

  if (cell.op === "multiply") {
    const a = currentRow[columnLetterToIndex(cell.columns[0])];
    const b = currentRow[columnLetterToIndex(cell.columns[1])];
    return typeof a === "number" && typeof b === "number" ? a * b : null;
  }

  // SUM: fromRow/toRow là số dòng như hiện trên Excel (dòng 1 là header),
  // nên dòng dữ liệu thứ i nằm ở dòng Excel i + 2
  const colIndex = columnLetterToIndex(cell.column);
  let total = 0;
  let counted = 0;
  for (let excelRow = cell.fromRow; excelRow <= cell.toRow; excelRow++) {
    const dataIndex = excelRow - 2;
    if (dataIndex < 0) continue;
    // Chỉ cộng dòng đã tính xong (phía trên); dòng dưới thì chưa có giá trị
    const value = dataIndex === rowIndex ? currentRow[colIndex] : doneRows[dataIndex]?.[colIndex];
    if (typeof value === "number") {
      total += value;
      counted++;
    }
  }
  return counted > 0 ? total : null;
}

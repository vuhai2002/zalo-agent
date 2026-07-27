import { env } from "../config/env.js";
import type { DocumentBlock, Sheet } from "./document-content-schema.js";

/**
 * Chặn nội dung quá khổ TRƯỚC khi dựng file. Bot đọc tin người lạ nên đây là
 * chốt chặn thật, không phải phòng xa: dựng file là việc tốn CPU nhất trong một
 * lượt agent.
 *
 * Trả về lý do bằng tiếng Việt thay vì throw - tool sẽ đưa nguyên câu đó cho
 * model đọc để nó tự rút gọn rồi gọi lại (cùng luật với web_search/read_image).
 */

export type LimitCheck = { ok: true } | { ok: false; reason: string };

const ok: LimitCheck = { ok: true };
const fail = (reason: string): LimitCheck => ({ ok: false, reason });

function countBlockChars(block: DocumentBlock): number {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return block.text.length;
    case "bullets":
      return block.items.reduce((sum, item) => sum + item.length, 0);
    case "table":
      return (
        block.headers.reduce((sum, h) => sum + h.length, 0) +
        block.rows.reduce((sum, row) => sum + row.reduce((s, cell) => s + cell.length, 0), 0)
      );
    case "two_columns":
      return [...block.left, ...block.right].reduce((sum, line) => sum + line.length, 0);
  }
}

export function checkDocumentLimits(blocks: DocumentBlock[]): LimitCheck {
  if (blocks.length > env.DOCUMENT_MAX_BLOCKS) {
    return fail(
      `Tài liệu có ${blocks.length} phần, vượt trần ${env.DOCUMENT_MAX_BLOCKS}. Hãy rút gọn rồi gọi lại.`,
    );
  }

  for (const block of blocks) {
    if (block.type === "table" && block.rows.length > env.DOCUMENT_MAX_ROWS) {
      return fail(
        `Bảng có ${block.rows.length} dòng, vượt trần ${env.DOCUMENT_MAX_ROWS}. Hãy bớt dòng rồi gọi lại.`,
      );
    }
    // Bảng lệch số cột so với header thì file dựng ra méo mó - chặn ngay
    if (block.type === "table") {
      const bad = block.rows.findIndex((row) => row.length !== block.headers.length);
      if (bad >= 0) {
        return fail(
          `Dòng ${bad + 1} của bảng có ${block.rows[bad]!.length} ô nhưng bảng có ${block.headers.length} cột. Mọi dòng phải đủ số ô.`,
        );
      }
    }
  }

  const chars = blocks.reduce((sum, block) => sum + countBlockChars(block), 0);
  if (chars > env.DOCUMENT_MAX_CHARS) {
    return fail(
      `Nội dung dài ${chars} ký tự, vượt trần ${env.DOCUMENT_MAX_CHARS}. Hãy tóm gọn lại rồi gọi lại.`,
    );
  }

  return ok;
}

export function checkSpreadsheetLimits(sheets: Sheet[]): LimitCheck {
  if (sheets.length > env.DOCUMENT_MAX_SHEETS) {
    return fail(`Có ${sheets.length} sheet, vượt trần ${env.DOCUMENT_MAX_SHEETS}.`);
  }

  let chars = 0;
  for (const sheet of sheets) {
    if (sheet.rows.length > env.DOCUMENT_MAX_ROWS) {
      return fail(
        `Sheet "${sheet.name}" có ${sheet.rows.length} dòng, vượt trần ${env.DOCUMENT_MAX_ROWS}.`,
      );
    }
    const bad = sheet.rows.findIndex((row) => row.length !== sheet.headers.length);
    if (bad >= 0) {
      return fail(
        `Sheet "${sheet.name}" dòng ${bad + 1} có ${sheet.rows[bad]!.length} ô nhưng có ${sheet.headers.length} cột. Mọi dòng phải đủ số ô.`,
      );
    }
    chars += sheet.headers.reduce((sum, h) => sum + h.length, 0);
    for (const row of sheet.rows) {
      for (const cell of row) {
        if (cell.kind === "text") chars += cell.value.length;
      }
    }
  }

  if (chars > env.DOCUMENT_MAX_CHARS) {
    return fail(`Nội dung dài ${chars} ký tự, vượt trần ${env.DOCUMENT_MAX_CHARS}.`);
  }

  return ok;
}

/**
 * Tên file an toàn: bỏ đường dẫn, bỏ ký tự lạ, ép đúng đuôi. Model có thể gửi
 * "../../data/accounts/credentials" hoặc "bao gia.exe" - cả hai đều phải về
 * dạng vô hại trước khi chạm đĩa.
 */
export function safeFileName(raw: string, extension: "docx" | "xlsx"): string {
  const base = raw
    .replace(/[\\/]/g, " ") // chặn path traversal ngay từ đầu
    .replace(/\.[^.]*$/, "") // bỏ đuôi cũ (kể cả .exe)
    .replace(/[^\p{L}\p{N}\s._-]/gu, "") // giữ chữ (có dấu), số, khoảng trắng, . _ -
    // Gộp chuỗi dấu chấm liên tiếp rồi cắt dấu chấm ở hai đầu: "../.." sau các
    // bước trên còn ".. .." - không thoát được thư mục (đã có path.basename) nhưng
    // là tên file bẩn, và dấu chấm đầu tên tạo file ẩn trên Linux
    .replace(/\.{2,}/g, ".")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .trim()
    .slice(0, 80);
  return `${base || "tai-lieu"}.${extension}`;
}

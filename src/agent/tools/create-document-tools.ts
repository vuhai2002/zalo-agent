import { tool } from "ai";
import { z } from "zod";
import {
  documentBlockSchema,
  sheetSchema,
  type DocumentBlock,
  type Sheet,
} from "../../documents/document-content-schema.js";
import { checkDocumentRateLimit } from "../../documents/document-rate-limit.js";
import {
  checkDocumentLimits,
  checkSpreadsheetLimits,
  safeFileName,
} from "../../documents/document-limits.js";
import { renderDocx } from "../../documents/render-docx.js";
import { renderXlsx } from "../../documents/render-xlsx.js";
import { enqueueSend } from "../../middleware/rate-limiter.js";
import { createLogger } from "../../shared/logger.js";
import { withNamedTempFile } from "../../shared/temp-file-store.js";
import type { ToolContext } from "./index.js";
import { ketQuaLoi, type KetQuaLoiTool } from "./tool-failure-result.js";
import { capTionSach } from "./clean-tool-caption.js";
import { ghiChuDaGuiFile } from "./sent-by-tool-note.js";

/**
 * Tool tạo file .docx/.xlsx rồi GỬI LUÔN cho cuộc trò chuyện.
 *
 * Tự gửi thay vì để model gọi tiếp send_file, vì 2 lý do: file nằm ở thư mục tạm
 * (send_file chỉ nhận shared-files hoặc URL), và tách 2 bước tốn thêm một lượt
 * gửi lại toàn bộ hội thoại. Học pattern `deliver` của GoClaw - kể cả câu trả về
 * cũng phải dặn model đừng gửi lại, nếu không nó rất dễ gọi send_file lần nữa và
 * người dùng nhận file 2 lần.
 *
 * An toàn: tool chỉ nhận DỮ LIỆU (tiêu đề, đoạn văn, bảng), không nhận code và
 * không đọc file nào từ đĩa theo yêu cầu của model.
 */

const log = createLogger("create-document");

const DELIVERED_NOTE =
  "Đã tạo và GỬI file cho người dùng rồi. KHÔNG gọi send_file để gửi lại file này.";

type Ctx = Pick<ToolContext, "api" | "account" | "message" | "ghiNhanDaGui">;

/** Dựng buffer -> gửi kèm caption -> xóa file tạm. Trả câu cho model đọc. */
async function deliverFile(
  ctx: Ctx,
  fileName: string,
  data: Buffer,
  caption: string | undefined,
): Promise<string> {
  const threadKey = `${ctx.account.id}:${ctx.message.threadId}`;
  await withNamedTempFile(fileName, data, (filePath) =>
    enqueueSend(threadKey, () =>
      ctx.api.sendMessage(
        { msg: capTionSach(caption) ?? "", attachments: [filePath] },
        ctx.message.threadId,
        ctx.message.threadType,
      ),
    ),
  );
  // Vào history: tin này KHÔNG đi qua `deliverChatReply` nên không ai ghi hộ.
  // Thiếu nó thì dashboard không thấy, và lượt sau bot không nhớ đã gửi file.
  ctx.ghiNhanDaGui?.(ghiChuDaGuiFile(fileName, caption));
  log.info(
    { accountId: ctx.account.id, threadId: ctx.message.threadId, fileName, bytes: data.length },
    "Đã gửi file tự tạo",
  );
  return `${DELIVERED_NOTE} (tên file: ${fileName}, ${Math.round(data.length / 1024)} KB)`;
}

/** Gói mọi nhánh lỗi thành câu cho model đọc - không throw ra agent loop */
async function guard(
  work: () => Promise<string | KetQuaLoiTool>,
): Promise<string | KetQuaLoiTool> {
  try {
    return await work();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.warn({ err }, "Tạo/gửi file thất bại");
    return ketQuaLoi(
      `Không tạo được file (${reason}). Nói thật với người dùng và trả lời nội dung trực tiếp trong chat.`,
    );
  }
}

export function createWordDocumentTool(ctx: Ctx) {
  return tool({
    description:
      "Tạo file Word (.docx) chuẩn văn bản Việt Nam (Times New Roman 13pt) rồi gửi luôn cho người dùng. " +
      "Dùng khi người dùng yêu cầu file, hoặc khi nội dung dài/có bảng mà đọc trong chat sẽ rối. " +
      "Văn bản hành chính: mở đầu bằng two_columns (cơ quan bên trái, quốc hiệu **CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM** bên phải), " +
      "dòng địa danh - ngày tháng dùng paragraph align right, kết bằng two_columns (nơi nhận | chức vụ + tên người ký). " +
      "Nội dung ngắn thì trả lời thẳng, đừng tạo file.",
    inputSchema: z.object({
      fileName: z.string().min(1).describe('Tên file, vd "bao-gia-thang-7.docx"'),
      title: z.string().optional().describe("Tiêu đề canh giữa, đậm, ở đầu trang"),
      blocks: z
        .array(documentBlockSchema)
        .min(1)
        .describe("Nội dung theo thứ tự: heading, paragraph, bullets, table, two_columns"),
      caption: z.string().optional().describe("Lời nhắn gửi kèm file"),
    }),
    execute: ({ fileName, title, blocks, caption }) =>
      guard(async () => {
        const limit = checkDocumentLimits(blocks as DocumentBlock[]);
        if (!limit.ok) return ketQuaLoi(limit.reason);

        const rate = checkDocumentRateLimit(`${ctx.account.id}:${ctx.message.threadId}`);
        if (!rate.ok) return ketQuaLoi(rate.reason);

        const data = await renderDocx(blocks as DocumentBlock[], { title });
        return deliverFile(ctx, safeFileName(fileName, "docx"), data, caption);
      }),
  });
}

export function createExcelFileTool(ctx: Ctx) {
  return tool({
    description:
      "Tạo file Excel (.xlsx) trình bày sẵn đẹp (banner, header nổi, sọc xen kẽ, số liệu tô màu) rồi gửi luôn cho người dùng. " +
      "Hợp với báo giá, danh sách, bảng số liệu, báo cáo tổng hợp.\n" +
      'Ô trong rows: chuỗi, số, hoặc công thức dạng chuỗi "=B2*C2" (nhân 2 ô cùng dòng) / "=SUM(D2:D9)" (cộng 1 cột, đánh số coi header là dòng 1). ' +
      "Dùng công thức cho ô tính toán để người nhận sửa số là tự tính lại.\n" +
      "VIẾT ĐẦY ĐỦ như một báo cáo thật, đừng tóm tắt cụt lủn: báo cáo tổng hợp nên tách nhiều sheet " +
      "(tổng quan, chi tiết từng mục, số liệu, rủi ro/kết luận, nguồn tham khảo), mỗi sheet có title + subtitle + note, " +
      "mỗi ô mô tả trọn ý chứ không phải vài chữ. Đã bỏ công tạo file thì nội dung phải đáng để mở ra đọc.\n" +
      'MỌI chữ (tên sheet, tên file, header, nội dung) GIỮ NGUYÊN dấu tiếng Việt - viết "Tổng quan" chứ không "Tong quan".',
    inputSchema: z.object({
      fileName: z.string().min(1).describe('Tên file, vd "bao-gia.xlsx"'),
      sheets: z.array(sheetSchema).min(1).describe("Danh sách sheet, mỗi sheet có tên + cột + dòng"),
      caption: z.string().optional().describe("Lời nhắn gửi kèm file"),
    }),
    execute: ({ fileName, sheets, caption }) =>
      guard(async () => {
        const limit = checkSpreadsheetLimits(sheets as Sheet[]);
        if (!limit.ok) return ketQuaLoi(limit.reason);

        const rate = checkDocumentRateLimit(`${ctx.account.id}:${ctx.message.threadId}`);
        if (!rate.ok) return ketQuaLoi(rate.reason);

        const data = await renderXlsx(sheets as Sheet[]);
        return deliverFile(ctx, safeFileName(fileName, "xlsx"), data, caption);
      }),
  });
}

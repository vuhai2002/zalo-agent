import { locKyTuAn } from "../agent/tools/tag-ky-tu-an.js";
import { wrapUntrustedContent } from "../agent/tools/wrap-untrusted-content.js";

/**
 * Hạ kết quả / câu lỗi của MỘT lời gọi tool MCP ngoài thành chuỗi an toàn để
 * đưa model. Tách khỏi `mcp-tool-definition.ts` để file đó giữ phần "dựng
 * ToolDefinition + cửa gán", còn ở đây là phần "chuỗi của server đi tới model
 * bằng hình dạng nào".
 *
 * Mọi chuỗi ở đây do SERVER NGOÀI soạn - kể cả câu lỗi JSON-RPC (`error.message`)
 * và thân HTTP mà `@ai-sdk/mcp` nhét nguyên vào `MCPClientError.message`
 * ("MCP HTTP Transport Error: POSTing to endpoint (HTTP 500): <thân trang>").
 * Nên cả nhánh hỏng cũng phải qua đúng ba bước như nhánh thành công: lọc dải
 * Tags, cắt trần, bọc ranh giới nonce.
 *
 * Module THUẦN: không log, không đọc env (trần được TRUYỀN vào), không chạm DB.
 */

/**
 * Trần cho câu lỗi lấy từ ngoại lệ. Hằng số chứ không phải tham số dashboard:
 * đây không phải dữ liệu người dùng cần đọc mà chỉ là manh mối cho model nói
 * "server báo lỗi gì" - 1000 ký tự đủ cho mọi câu JSON-RPC thật, còn thân
 * trang lỗi HTML vài MB của reverse proxy thì không có lý do gì đi tiếp.
 */
export const TRAN_CAU_LOI_SERVER = 1000;

/**
 * Kết quả `aiTool.execute` của `@ai-sdk/mcp` có thể ở 3 dạng tùy server:
 * chuỗi trần, `{content:[{type:'text',text}]}` (dạng chuẩn MCP content block),
 * hoặc bất kỳ giá trị JSON nào khác (server không tuân thủ chuẩn) - dạng cuối
 * hạ về `JSON.stringify` để không đánh rơi dữ liệu.
 *
 * `null`/`undefined` (tool chạy xong nhưng không trả gì) hạ về chuỗi RỖNG
 * tường minh - KHÔNG để lọt xuống `JSON.stringify(undefined)`, vì hàm đó trả
 * đúng giá trị `undefined` (không phải chuỗi `"undefined"`) dù kiểu khai báo
 * của `JSON.stringify` nói là `string`. Sai kiểu ngầm đó, nếu không chặn ở
 * đây, sẽ làm caller gọi `.length` trên `undefined` rồi ném - biến một kết quả
 * RỖNG HỢP LỆ thành một "lỗi giả".
 */
export function trichVanBanKetQuaMcp(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { content?: unknown }).content)) {
    const parts = (raw as { content: unknown[] }).content
      .filter(
        (c): c is { type: string; text: string } =>
          !!c && typeof c === "object" && (c as { type?: unknown }).type === "text" && typeof (c as { text?: unknown }).text === "string",
      )
      .map((c) => c.text);
    if (parts.length) return parts.join("\n");
  }
  // Lưới cuối: giá trị nào cũng khiến JSON.stringify trả `undefined` (hàm,
  // symbol...) thì vẫn phải ra CHUỖI - cùng lý do ở đoạn docstring trên.
  return JSON.stringify(raw) ?? "";
}

/**
 * Server báo tool chạy HỎNG bằng `isError: true` trong kết quả - KHÔNG ném.
 * `@ai-sdk/mcp` trả nguyên object đó (`if (result.isError) return result`),
 * nên không kiểm ở đây thì nhánh hỏng đi ra như kết quả thành công: model
 * tưởng tool đã làm xong, còn `tool-loop-guard` không đếm được lần hỏng nào.
 *
 * So `=== true` (không truthy): `isError` là trường do server tự khai, một
 * server lệch chuẩn gửi `"false"` (chuỗi) thì không được tính là hỏng.
 */
export function laKetQuaBaoLoiMcp(raw: unknown): boolean {
  return !!raw && typeof raw === "object" && (raw as { isError?: unknown }).isError === true;
}

/**
 * Lọc dải Tags rồi cắt ĐẦU về `tran` ký tự, kèm câu báo đã cắt (cùng nếp
 * `web_fetch`).
 *
 * Lọc TRƯỚC khi cắt: ký tự Tags không hiện ra mà vẫn chiếm chỗ trong trần,
 * cắt trước thì một kết quả nhồi Tags đẩy được nội dung thật ra khỏi phần còn
 * giữ. Cắt TRƯỚC khi bọc: cắt chuỗi đã bọc là cắt mất thẻ đóng mang nonce.
 */
export function catTranVanBanMcp(text: string, tran: number): string {
  const sach = locKyTuAn(text);
  if (sach.length <= tran) return sach;
  // Lùi 1 đơn vị nếu điểm cắt rơi giữa cặp surrogate (emoji, chữ ngoài BMP):
  // để lại nửa cặp mồ côi là chuỗi UTF-16 hỏng gửi tới provider.
  const cuoi = sach.charCodeAt(tran - 1);
  const diemCat = cuoi >= 0xd800 && cuoi <= 0xdbff ? tran - 1 : tran;
  return `${sach.slice(0, diemCat)}\n[...đã cắt bớt, kết quả của tool ngoài còn dài]`;
}

/**
 * Câu cho `ketQuaLoi` khi phần mô tả lỗi do server soạn: câu dẫn của bot nằm
 * NGOÀI ranh giới, chữ của server nằm TRONG `wrapUntrustedContent` - cùng một
 * hàng rào nonce như nhánh thành công, vì chữ trong `loi` tới model y hệt chữ
 * trong kết quả thường.
 *
 * Rỗng sau khi lọc thì không bọc gì (bọc chuỗi rỗng trả rỗng, xem
 * `wrapUntrustedContent`) - chỉ còn câu dẫn.
 */
export function cauLoiKemNoiDungServer(cauDan: string, noiDungServer: string, tran: number, nguon: string): string {
  const daCat = catTranVanBanMcp(noiDungServer, tran).trim();
  if (!daCat) return `${cauDan} (server không kèm mô tả lỗi)`;
  return `${cauDan} Mô tả lỗi của server:\n${wrapUntrustedContent(daCat, nguon)}`;
}

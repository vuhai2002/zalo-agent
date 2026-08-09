import { tool } from "ai";
import { z } from "zod";
import { getTuning } from "../../config/runtime-tuning-settings.js";
import { timTrongKhoTriThuc, type KetQuaKb } from "../../knowledge/kb-search.js";
import { createLogger } from "../../shared/logger.js";
import { KB_SEARCH_DESCRIPTION } from "./kb-search-tool-description.js";
import type { ToolContext } from "./index.js";
import { ketQuaLoi } from "./tool-failure-result.js";
import { trichTheDongThuc, wrapUntrustedContent } from "./wrap-untrusted-content.js";

/**
 * Tool cho model tự tra Kho tri thức của agent (nạp bằng TOOL, không tự nhét
 * vào prompt - lý do đầy đủ ở phase-04-tool-kb-search.md: giữ nguyên khoản
 * đầu tư prompt cache của những lượt không đụng tới KB).
 *
 * Chỉ có mặt trong schema khi agent đã được gán ít nhất một nguồn (xem
 * `available` ở `tool-catalog-read.ts`) - bày một tool luôn trả rỗng chỉ dạy
 * model gọi vô ích.
 */
const log = createLogger("kb-search");

/**
 * `timTrongKhoTriThuc` (kb-search.ts) KHÔNG tự kẹp `soLuong` - SQLite coi
 * `LIMIT` âm là "không giới hạn" (xem `kb-fts-query.ts`). Tầng tool là biên
 * cuối cùng trước khi giá trị này chạm SQL nên PHẢI tự kẹp ở đây, không tin
 * giá trị đọc từ cấu hình (hay từ bất kỳ đâu khác) luôn nằm trong khoảng hợp
 * lệ. Khoảng khớp min/max của KB_TOP_K ở `tuning-definitions.ts`.
 */
const SO_LUONG_MIN = 1;
const SO_LUONG_MAX = 20;

export function kepSoLuong(raw: number): number {
  // Chỉ NaN mới không phải một con số thật - Infinity vẫn kẹp bình thường qua
  // Math.min/Math.max bên dưới (Number.isFinite(Infinity) === false nên KHÔNG
  // dùng nó ở đây, kẻo Infinity bị coi ngang NaN và luôn rơi về tối thiểu).
  if (Number.isNaN(raw)) return SO_LUONG_MIN;
  return Math.min(SO_LUONG_MAX, Math.max(SO_LUONG_MIN, Math.trunc(raw)));
}

/**
 * Chống giả mạo nhãn nguồn (I13): một tài liệu (hoặc chính TÊN NGUỒN/TIÊU ĐỀ
 * của nó) có thể tự viết đúng định dạng `[Nguồn: ...]` cùng dải phân cách
 * `\n\n---\n\n` mà `dinhDangDoan`/tool này dùng để đánh dấu ranh giới giữa các
 * đoạn - nếu không khử, nội dung độc hại trong tài liệu A có thể tự gán cho
 * tài liệu B, và model dẫn sai nguồn cho người hỏi.
 *
 * Bản đầu chỉ khử NỘI DUNG đoạn và dùng regex hẹp - vòng rà soát an toàn tìm
 * ra 2 lỗ:
 *
 *   1. `tieuDe` (heading markdown của CHÍNH tài liệu bên thứ ba, vd
 *      `## Bảo hành] rồi [Nguồn: X` là một dòng heading HOÀN TOÀN hợp lệ)
 *      được ghép thẳng vào nhãn mà KHÔNG qua khử - chỉ cần MỘT dấu `]` là tự
 *      đóng sớm nhãn thật rồi mở nhãn giả, không cần ký tự lạ nào.
 *   2. Cả hai regex khử đều hẹp theo hình dạng ASCII: `\s*` KHÔNG bắt ZWSP
 *      (ZWSP không phải whitespace trong JS), và không bắt ngoặc vuông
 *      FULLWIDTH `［...］`; `\n{2,}` không bắt "dòng trống" có khoảng trắng
 *      (`\n \n---\n \n` vẫn trống về mặt hiển thị).
 *
 * Sửa bằng CHỊU ký tự xen (cùng cách `memory-prompt-block.ts` chịu được ZWSP
 * thay một gạch dưới) cho cả hai regex, VÀ khử ngoặc vuông trong `tenNguon`/
 * `tieuDe` TRƯỚC khi ghép vào nhãn - lớp thiếu ở bản đầu.
 */
const DEM = "[\\p{Cf}\\p{Mn}]*"; // lớp đệm: ký tự định dạng vô hình + dấu phụ

/** `[Nguồn:` hoặc `［Nguồn:` (fullwidth), chịu ký tự vô hình xen giữa từng
 * chữ cái "Nguồn" hoặc ngay trước dấu hai chấm. */
const NHAN_NGUON_GIA_RE = new RegExp(
  `[[［]${DEM}${[..."Nguồn"].join(DEM)}${DEM}[\\s\\p{Cf}]*:`,
  "giu",
);

/** "Dòng trống" ở đây là dòng CHỈ chứa khoảng trắng/ký tự định dạng vô hình,
 * không nhất thiết rỗng tuyệt đối - `\n \n` vẫn trống khi hiển thị. */
const DONG_TRONG = "(?:\\n[ \\t\\p{Cf}]*)";
const DAI_PHAN_CACH_GIA_RE = new RegExp(`${DONG_TRONG}{2,}(-{3,})${DONG_TRONG}{2,}`, "gu");

function khuGiaMaoTrongDoan(noiDung: string): string {
  return noiDung
    .replace(NHAN_NGUON_GIA_RE, "(Nguồn:")
    .replace(DAI_PHAN_CACH_GIA_RE, (_khop, dashes: string) => `\n${dashes}\n`);
}

/** Ngoặc vuông (ASCII hoặc fullwidth) trong TÊN NGUỒN/TIÊU ĐỀ tự đóng/mở được
 * nhãn `[Nguồn: ...]` - đổi sang ngoặc tròn để giữ chữ mà không giữ cấu trúc. */
function khuNgoacVuongTrongNhan(s: string): string {
  return s.replace(/[[\]［］]/g, (c) => (c === "[" || c === "［" ? "(" : ")"));
}

/** Mỗi đoạn kèm TÊN NGUỒN để model dẫn nguồn lại được cho người hỏi */
function dinhDangDoan(d: KetQuaKb): string {
  const tenNguon = khuNgoacVuongTrongNhan(d.tenNguon);
  const tieuDe = khuNgoacVuongTrongNhan(d.tieuDe);
  const nhan = tieuDe ? `${tenNguon} - ${tieuDe}` : tenNguon;
  return `[Nguồn: ${nhan}]\n${khuGiaMaoTrongDoan(d.noiDung)}`;
}

export function createKbSearchTool(ctx: ToolContext) {
  return tool({
    description: KB_SEARCH_DESCRIPTION,
    inputSchema: z.object({
      cau_hoi: z.string().min(1).describe("Câu hỏi hoặc từ khóa cần tra, viết bằng tiếng Việt tự nhiên"),
    }),
    execute: async ({ cau_hoi }) => {
      try {
        const soLuong = kepSoLuong(getTuning("KB_TOP_K"));
        const ketQua = timTrongKhoTriThuc({ cauHoi: cau_hoi, agentId: ctx.agent.id, soLuong });

        if (ketQua.length === 0) {
          return ketQuaLoi(
            `Không tìm thấy nội dung nào khớp "${cau_hoi}" trong kho tri thức. Nói thật là chưa có trong tài liệu, đừng bịa số liệu.`,
          );
        }

        const noiDung = ketQua.map(dinhDangDoan).join("\n\n---\n\n");
        const boc = wrapUntrustedContent(noiDung, `kho tri thức: ${cau_hoi}`);

        // Trần áp cho TOÀN BỘ chuỗi kết quả (đã gồm thẻ bọc + tên nguồn), không
        // phải riêng nội dung từng đoạn - 5 đoạn x 1600 ký tự đã đủ đẩy ngữ
        // cảnh sát trần.
        const maxChars = getTuning("KB_MAX_RESULT_CHARS");
        if (boc.length <= maxChars) return boc;

        // Vẫn giữ thẻ đóng ở cuối sau khi cắt, để khối `<noi_dung_ngoai_...>`
        // không bị bỏ dở - cắt xong nối thêm câu báo + thẻ đóng nên chuỗi ra có
        // thể dài hơn maxChars một chút (phần vỏ), chấp nhận được. PHẢI trích
        // đúng thẻ đóng có NONCE của lần bọc này (`trichTheDongThuc`) - ghép
        // thẻ đóng KHÔNG nonce ở đây là bug: nó không khớp thẻ mở, phần bị cắt
        // đọc như đã ra khỏi khối tin cậy dù nội dung vẫn còn nằm trong đó.
        return `${boc.slice(0, maxChars)}\n[...đã rút gọn, kho còn nhiều nội dung hơn]\n${trichTheDongThuc(boc)}`;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log.error({ err, cauHoi: cau_hoi }, "Tool kb_search lỗi");
        return ketQuaLoi(`Tra kho tri thức thất bại (${reason}). Nói thật với người dùng, đừng bịa số liệu.`);
      }
    },
  });
}

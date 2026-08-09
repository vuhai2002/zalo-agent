import { tool } from "ai";
import { z } from "zod";
import { getTuning } from "../../config/runtime-tuning-settings.js";
import { timTrongKhoTriThuc, type KetQuaKb } from "../../knowledge/kb-search.js";
import { createLogger } from "../../shared/logger.js";
import { khuGiaMaoTrongDoan, khuNgoacVuongTrongNhan } from "./khu-gia-mao-nhan-nguon.js";
import { dongGoiTheoNganSach } from "./kb-pack-result.js";
import { KB_SEARCH_DESCRIPTION } from "./kb-search-tool-description.js";
import type { ToolContext } from "./index.js";
import { locKyTuAn } from "./tag-ky-tu-an.js";
import { ketQuaLoi } from "./tool-failure-result.js";
import { wrapUntrustedContent } from "./wrap-untrusted-content.js";

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
 * Chống giả mạo nhãn nguồn (I13, chi tiết ở `khu-gia-mao-nhan-nguon.ts`): một
 * tài liệu (hoặc chính TÊN NGUỒN/TIÊU ĐỀ của nó) có thể tự viết đúng định dạng
 * `[Nguồn: ...]` cùng dải phân cách `\n\n---\n\n` để tự gán nội dung độc hại
 * cho một nguồn khác. `tenNguon`/`tieuDe` đi qua ĐÚNG pipeline nội dung đoạn
 * nhận (lọc dải Tags rồi khử nhãn/dải phân cách giả), RỒI mới khử ngoặc vuông
 * còn sót - lớp phòng thêm hẹp hơn, chạy sau cùng vì nó đổi CẤU TRÚC (ngoặc)
 * chứ không chỉ nội dung.
 */
function dinhDangDoan(d: KetQuaKb): string {
  const antoanHoa = (s: string) => khuNgoacVuongTrongNhan(khuGiaMaoTrongDoan(locKyTuAn(s)));
  const tenNguon = antoanHoa(d.tenNguon);
  const tieuDe = antoanHoa(d.tieuDe);
  const nhan = tieuDe ? `${tenNguon} - ${tieuDe}` : tenNguon;
  return `[Nguồn: ${nhan}]\n${khuGiaMaoTrongDoan(locKyTuAn(d.noiDung))}`;
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

        const nguon = `kho tri thức: ${cau_hoi}`;
        const maxChars = getTuning("KB_MAX_RESULT_CHARS");

        // ĐÓNG GÓI TRƯỚC rồi mới BỌC SAU (I2 - cách cũ bọc trước rồi cắt cả
        // khối đã bọc, nên trần bao gồm luôn phần vỏ, không cách nào chừa chỗ
        // cho nó, và cắt giữa chừng làm hỏng cả nghĩa câu lẫn cấu trúc nhãn).
        //
        // Ngân sách NỘI DUNG = trần trừ phần vỏ - đo phần vỏ CHÍNH XÁC bằng
        // cách bọc thử một placeholder 1 ký tự rồi trừ 1: `wrapUntrustedContent`
        // ghép [thẻ mở, 3 dòng dặn dò, dòng trống, NỘI DUNG, thẻ đóng] bằng
        // "\n".join - phần vỏ (mọi phần tử trừ nội dung) có độ dài CỐ ĐỊNH với
        // cùng `nguon`, không phụ thuộc nội dung thật sẽ đóng gói vào đó.
        const voLen = wrapUntrustedContent("x", nguon).length - 1;
        const nganSachNoiDung = Math.max(0, maxChars - voLen);
        const noiDungDaDongGoi = dongGoiTheoNganSach(ketQua.map(dinhDangDoan), nganSachNoiDung);

        return wrapUntrustedContent(noiDungDaDongGoi, nguon);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log.error({ err, cauHoi: cau_hoi }, "Tool kb_search lỗi");
        return ketQuaLoi(`Tra kho tri thức thất bại (${reason}). Nói thật với người dùng, đừng bịa số liệu.`);
      }
    },
  });
}

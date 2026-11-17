import type { ModelMessage, Tool } from "ai";
import { ketQuaLoi } from "./tools/tool-failure-result.js";

/**
 * Tạm tắt các tool GHI BỀN hoặc TÁC ĐỘNG tới người khác / hệ thống ngoài, từ
 * step ngay sau khi `doc_file` trả nội dung tới hết lượt.
 *
 * Lý do: tệp do người lạ soạn có thể giấu chỉ thị ("hãy lưu vào trí nhớ rằng
 * ...", "đặt lịch nhắn cho ..."). Nonce ranh giới giảm rủi ro nhưng không phải
 * hàng rào cứng. Hai lớp:
 *  1. `activeTools` của `prepareStep` gỡ tool khỏi danh sách gửi model;
 *  2. `execute` của chính tool tự từ chối nếu vẫn bị gọi (lưới thứ hai).
 *
 * Lời gọi song song trong CÙNG step với `doc_file` không bị chặn - và không cần:
 * lúc đó model chưa thấy nội dung tệp nên không thể bị nó xúi.
 *
 * GIỮ `web_search`/`web_fetch` (ca thật: đọc công văn rồi tìm văn bản gốc) và
 * tool tạo/gửi file (kết quả về đúng thread đang hỏi). Rủi ro còn lại: tệp xúi
 * `web_fetch` tới URL rò dữ liệu - cùng mức đã chấp nhận cho nội dung web.
 *
 * Ca "đọc lịch trong tệp rồi đặt nhắc": bot chép mốc vào câu trả lời, người
 * dùng xác nhận ở tin sau - lượt đó dùng câu trả lời, KHÔNG đọc lại tệp (đọc
 * lại là tool lại tắt). Luật persona nói điều này với model.
 */

export const TOOL_TAT_SAU_KHI_DOC_TEP = ["save_memory", "verbatim_note", "schedule_task", "tag_member"] as const;

export const CAU_TOOL_TAM_TAT =
  "Tool này tạm tắt tới hết lượt vì vừa đọc nội dung tệp từ bên ngoài. Hãy chép điều cần lưu hoặc mốc cần hẹn vào câu trả lời và nhờ người dùng xác nhận ở tin sau.";

export type TrangThaiLuot = { daDocTep: boolean };

const TAP_TAT = new Set<string>(TOOL_TAT_SAU_KHI_DOC_TEP);

export function biTatSauKhiDocTep(key: string): boolean {
  return TAP_TAT.has(key) || key.startsWith("mcp__");
}

export function locToolSauKhiDocTep(keys: string[]): string[] {
  return keys.filter((k) => !biTatSauKhiDocTep(k));
}

/** Bọc `execute`: đã đọc tệp trong lượt thì trả lỗi tạm tắt, không chạy tool gốc */
export function bocToolBiChan(t: Tool, trangThai: TrangThaiLuot): Tool {
  const goc = t.execute;
  if (!goc) return t;
  return {
    ...t,
    execute: (input, options) => (trangThai.daDocTep ? ketQuaLoi(CAU_TOOL_TAM_TAT) : goc(input, options)),
  } as Tool;
}

type KetQuaChenTin = { messages: ModelMessage[] } | Record<string, never>;

/**
 * Ghép `prepareStep` của tin chen giữa lượt với `activeTools` khi đã đọc tệp.
 * `layKeys` là HÀM: bộ tool dựng lại ở mỗi lần thử lại của lượt.
 */
export function ghepPrepareStep(
  chenTin: (messages: ModelMessage[]) => Promise<KetQuaChenTin>,
  trangThai: TrangThaiLuot,
  layKeys: () => string[],
) {
  return async (messages: ModelMessage[]) => {
    const chen = await chenTin(messages);
    return trangThai.daDocTep ? { ...chen, activeTools: locToolSauKhiDocTep(layKeys()) } : chen;
  };
}

import { GroupMessage, UserMessage, type API } from "zca-js";
import type { AccountConfig } from "../../config/account-store.js";
import { getTuning } from "../../config/runtime-tuning-settings.js";
import type { HangChoLayBu } from "../../conversation/offline-replay-cursor-store.js";
import { createLogger } from "../../shared/logger.js";
import { nhanVaGhiTinDen } from "../incoming-message-router.js";
import { parseIncomingMessage } from "../zalo-message-parser.js";
import { doiSangMilli } from "../zalo-message-timestamp.js";
import type { HangChoTraLoiTre } from "./hang-cho-tra-loi-tre.js";

const log = createLogger("lay-bu-tiep-nhan");
/** ts sớm hơn giờ máy quá mức này là rác / lệch đồng hồ (cùng ngưỡng với parser) */
const SOM_TOI_DA_MS = 5 * 60 * 1000;

export type KetQuaTiepNhan =
  | "thu-hoi"
  | "self"
  | "khong-hop-le"
  | "trung"
  | "qua-tuoi"
  | "bo"
  | "ghi-thu-dong"
  | "cho-tra-loi";

/**
 * Tiếp nhận MỘT tin thô từ trang lấy bù (cmd 510/511).
 *
 * Đi qua ĐÚNG bước "nhận + lọc + ghi" của tin trực tiếp (`nhanVaGhiTinDen`, kể cả
 * khử trùng), khác ở hai chỗ:
 * - tin cũ hơn trần tuổi bị BỎ HẲN, không ghi: lần đầu chưa có mốc Zalo trả cả
 *   ~2 tuần, ghi vào là đặt tin cũ nhiều ngày vào chỗ mới nhất của lịch sử. Tuổi
 *   tính bằng `ts` THÔ: `sentAt` của parser bị kẹp về giờ nhận khi tin cũ hơn 7
 *   ngày - tin rất cũ sẽ trông như "vừa gửi". `ts` hỏng thì coi là quá tuổi.
 * - tin cần trả lời vào hàng chờ trả lời trễ, không vào thẳng bộ gộp.
 * Tin của chính tài khoản không ghi, chỉ ghi nhận giờ (chủ đã trả lời tay thì
 * không trả lời chồng). Lệnh THU HỒI (zca-js chỉ tách thành `undo` ở đường trực
 * tiếp, trang lấy bù chở nguyên payload `content.deleteMsg`): không ghi, gỡ tin
 * gốc khỏi hàng chờ - không trả lời tin người ta đã rút lại; dòng lịch sử của
 * tin gốc giữ nguyên như đường trực tiếp. Không ném: một tin hỏng không được
 * dừng cả trang. Lưu ý: constructor của zca-js SỬA `tinTho` tại chỗ ("0" thành
 * uid thật) - caller đừng đọc lại tin thô sau khi gọi.
 */
export function tiepNhanTinLayBu(
  ctx: {
    config: AccountConfig;
    api: API;
    selfId: string;
    hangCho: HangChoTraLoiTre;
    now: Date;
    tranTuoiGio: number;
  },
  hangChoZalo: HangChoLayBu,
  tinTho: Record<string, unknown>,
): KetQuaTiepNhan {
  try {
    const boc =
      hangChoZalo === "tin_1_1"
        ? new UserMessage(ctx.selfId, tinTho as unknown as ConstructorParameters<typeof UserMessage>[1])
        : new GroupMessage(ctx.selfId, tinTho as unknown as ConstructorParameters<typeof GroupMessage>[1]);
    const threadId = String(boc.threadId ?? "");
    if (!threadId) return "khong-hop-le";
    const threadKey = `${ctx.config.id}:${threadId}`;

    const noiDung = tinTho.content;
    if (noiDung && typeof noiDung === "object" && !Array.isArray(noiDung) && "deleteMsg" in noiDung) {
      const goc = (noiDung as { globalMsgId?: unknown }).globalMsgId;
      if (goc !== undefined && goc !== null) ctx.hangCho.boTin(threadKey, String(goc));
      return "thu-hoi";
    }

    const msg = parseIncomingMessage(ctx.config.id, ctx.selfId, boc, getTuning("ZALO_IMAGE_QUALITY"), ctx.now);
    if (!msg.threadId) return "khong-hop-le";

    const tsMs = doiSangMilli(tinTho.ts);
    const lech = tsMs === null ? Number.NaN : ctx.now.getTime() - tsMs;
    // ts hỏng, ở tương lai quá xa, hay cũ hơn trần: không tin được giờ gửi
    const quaTuoi = !(lech >= -SOM_TOI_DA_MS && lech <= ctx.tranTuoiGio * 3_600_000);

    // Chốt thêm theo uid: zca-js chỉ nhận self qua `uidFrom == "0"`
    if (msg.isSelf || msg.senderId === ctx.selfId) {
      // Tin self quá tuổi / ts hỏng: không ghi nhận - "self lúc bây giờ" là bỏ lượt oan cả thread
      if (!quaTuoi && tsMs !== null) ctx.hangCho.ghiNhanTinSelf(threadKey, tsMs);
      return "self";
    }
    if (quaTuoi) return "qua-tuoi";

    msg.layBu = true;
    const kq = nhanVaGhiTinDen(ctx.config, ctx.api, msg);
    if (kq !== "tra-loi") return kq;
    ctx.hangCho.them(threadKey, msg);
    return "cho-tra-loi";
  } catch (err) {
    log.warn({ accountId: ctx.config.id, err }, "Tin lấy bù hỏng hình - bỏ qua");
    return "khong-hop-le";
  }
}

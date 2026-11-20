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

export type KetQuaTiepNhan =
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
 * không trả lời chồng). Không ném: một tin hỏng không được dừng cả trang.
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
    const msg = parseIncomingMessage(ctx.config.id, ctx.selfId, boc, getTuning("ZALO_IMAGE_QUALITY"));
    if (!msg.threadId) return "khong-hop-le";
    const threadKey = `${ctx.config.id}:${msg.threadId}`;

    const tsMs = doiSangMilli(tinTho.ts);
    const quaTuoi = tsMs === null || ctx.now.getTime() - tsMs > ctx.tranTuoiGio * 3_600_000;

    if (msg.isSelf) {
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

import type { API, ThreadType } from "zca-js";
import type { AccountConfig } from "../config/account-store.js";
import type { DoanCanGui } from "./send-reply-in-parts.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

/**
 * Năng lực của MỘT KÊNH trong phạm vi một lượt xử lý.
 *
 * Trước đây `processBatch` nhận thẳng `api: API` của zca-js, tức khóa cứng cả
 * lượt vào một kênh. Kênh bot (Zalo Bot API) có đúng hai trong năm năng lực
 * dưới đây, nên chỗ nào không có thì để `undefined` và `processBatch` bỏ qua -
 * KHÔNG dựng một stub ném lỗi, vì mấy việc này đều là việc phụ, thiếu thì bot
 * vẫn trả lời được.
 *
 * | Năng lực | Cá nhân | Bot |
 * |---|---|---|
 * | gửi chữ (`duongGui`) | có | có |
 * | dấu "đang nhập" | có | có (`sendChatAction`) |
 * | biên nhận "đã xem" | có | KHÔNG có method |
 * | thả cảm xúc tự động | có | `setMessageReaction` trả 404 |
 * | `api` cho tool | có | null - 7 tool cần nó đều đã bị chặn |
 */
export type KenhLuot = {
  /**
   * API zca-js, đi thẳng vào `ToolContext.api`. `null` trên kênh bot; an toàn
   * vì 7 tool dùng nó trùng khít 7 tool bị chặn (xem `nang-luc-kenh-bot.ts`).
   */
  api: API | null;
  /** Dựng đường gửi cho một thread cụ thể */
  duongGui: (threadId: string, threadType: ThreadType) => (doan: DoanCanGui) => Promise<unknown>;
  /** Báo "đã xem" cho cả batch. Thiếu = bỏ qua. */
  baoDaXem?: (batch: ParsedMessage[]) => void;
  /** Thả cảm xúc vào tin vừa tới. Thiếu = bỏ qua. */
  tuThaCamXuc?: (config: AccountConfig, msg: ParsedMessage) => void;
  /** Bật dấu "đang nhập", trả hàm TẮT. Thiếu = bỏ qua. */
  batDangNhap?: (threadId: string, threadType: ThreadType) => () => void;
  /**
   * Trần độ dài MỘT tin của kênh này. Thiếu = dùng `ZALO_MAX_MESSAGE_CHARS`
   * (trần của zca-js).
   *
   * Cần trường riêng vì hai kênh là hai giao thức khác nhau: Bot API ép cứng
   * 2000 ký tự phía server (đo thật: gửi 2001 bị từ chối), còn
   * `ZALO_MAX_MESSAGE_CHARS` chỉnh được tới 4000 trên dashboard. Dùng chung một
   * con số thì ai nới cho kênh cá nhân là kênh bot vỡ - và vỡ theo kiểu server
   * chối NGUYÊN TIN, mất trọn câu trả lời.
   */
  tranKyTuMotTin?: number;
  /**
   * Kênh này có MANG được định dạng (`Style[]`) trên dây không. Thiếu = CÓ,
   * tức hành vi của kênh cá nhân.
   *
   * Bot API không hiểu `styles` nên `kenhBot.duongGui` vứt chúng đi. Chuyện đó
   * không vô hại như trông: `soByteTin` (`split-styled-message.ts`) cộng cả
   * `JSON.stringify({styles})` vào ngân sách byte, nên giữ `styles` cho kênh
   * bot là tính tiền cho thứ không bao giờ đi trên dây - và chẻ thừa tin.
   *
   * Cờ này KHÔNG có nghĩa "gửi markdown thô": chữ vẫn đi qua `dinhDangNeuBat`
   * để BÓC dấu (`**Bảng giá**` -> `Bảng giá`), chỉ phần `Style[]` bị bỏ.
   */
  mangDinhDang?: boolean;
};

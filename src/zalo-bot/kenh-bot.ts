import { getTuning } from "../config/runtime-tuning-settings.js";
import { createLogger } from "../shared/logger.js";
import type { KenhLuot } from "../zalo/kenh-luot.js";
import { TRAN_KY_TU_MOT_TIN } from "./zalo-bot-api-types.js";
import type { ZaloBotClient } from "./zalo-bot-api-client.js";

const log = createLogger("kenh-bot");

/**
 * Trần thời gian giữ dấu "đang nhập", khớp `DEFAULT_MAX_DURATION_MS` của kênh
 * cá nhân. Lưới đỡ cho ca caller quên gọi hàm dừng.
 */
const TRAN_DANG_NHAP_MS = 10 * 60 * 1000;

/**
 * Kênh TÀI KHOẢN BOT (Zalo Bot API). Chỉ có 2 trong 5 năng lực.
 *
 * `baoDaXem` và `tuThaCamXuc` để TRỐNG chứ không dựng stub ném lỗi: đo trên API
 * thật thì không có method nào tương đương (`setMessageReaction` trả 404), mà
 * đây đều là việc phụ - thiếu thì bot vẫn trả lời bình thường.
 *
 * `api: null` - 7 tool cần zca-js đã bị `nang-luc-kenh-bot.ts` chặn khỏi lượt
 * này nên không ai đụng tới nó.
 */
export function kenhBot(client: ZaloBotClient): KenhLuot {
  return {
    api: null,
    tranKyTuMotTin: TRAN_KY_TU_MOT_TIN,

    duongGui: (threadId) => async (doan) => {
      // `parse_mode: null` - GỬI CHỮ TRƠN, không xin server dựng markdown.
      //
      // Lý do không hiển nhiên: chữ tới đây ĐÃ HẾT markdown rồi.
      // `deliverChatReply` chạy `dinhDangNeuBat` trước (`ZALO_RICH_TEXT_ENABLED`
      // mặc định bật), và `markdownSangStyleZalo` BÓC dấu ra thành `Style[]` -
      // đo thật: "**Bảng giá** đây anh" ra "Bảng giá đây anh" + 1 style. Nên
      // xin server dựng markdown ở bước này chỉ có thể BỚT ký tự (mấy dấu `_`
      // `*` `[` còn sót trong tên file và nhãn nguồn), không thêm được gì.
      //
      // Đo trên API thật: cả `parse_mode: "markdown"` lẫn `null` đều được chấp
      // nhận với chuỗi có `_` và `[` lẻ - không có rủi ro 400. Chọn `null` vì
      // lý lẽ trên, không phải vì sợ lỗi.
      //
      // Hệ quả phải chấp nhận: kênh bot KHÔNG có chữ đậm/nghiêng. Muốn có thì
      // phải bỏ qua `dinhDangNeuBat` cho kênh này và gửi markdown thô - việc
      // riêng, cần đo thêm phương ngữ markdown của Zalo.
      //
      // KHÔNG truyền `styles` (trường của zca-js, Bot API không hiểu) và KHÔNG
      // truyền `quote` (Bot API không có trích dẫn - đo: không method nào). Bỏ
      // lặng lẽ thay vì ném: cả hai là trang trí, mất vẫn trả lời được.
      return client.sendMessage(threadId, doan.text, null);
    },

    batDangNhap: (threadId) => {
      // Vòng riêng thay vì `startTypingIndicator` của kênh cá nhân: hàm đó nhận
      // `(threadId, threadType)` theo hình dạng zca-js. Nhưng GIỮ LẠI hai lưới
      // đỡ của nó, vì thiếu chúng thì hỏng nặng hơn ở đây:
      //
      // - Trần thời gian: caller quên gọi hàm dừng thì vòng này bắn mãi. Mỗi
      //   nhịp là một POST HTTP THẬT tới đúng con nginx đã đo được trả 429 khi
      //   bị hỏi dồn - khác hẳn kênh cá nhân nơi mỗi nhịp chỉ là một event socket.
      // - Bắt lỗi ĐỒNG BỘ: `sendChatAction` ném ngay (chưa kịp trả promise) thì
      //   `.catch` không đỡ được, lỗi thoát ra khỏi callback của `setInterval`
      //   và thành uncaught.
      let dungLai = false;
      const batDau = Date.now();
      const banMot = () => {
        if (dungLai) return;
        if (Date.now() - batDau > TRAN_DANG_NHAP_MS) {
          log.debug({ threadId }, "Dấu 'đang nhập' chạm trần thời gian - tự tắt");
          dung();
          return;
        }
        try {
          void client.sendChatAction(threadId).catch((err) => {
            log.debug({ threadId, err }, "Bắn 'đang nhập' thất bại - bỏ qua");
          });
        } catch (err) {
          log.debug({ threadId, err }, "Bắn 'đang nhập' ném đồng bộ - bỏ qua");
        }
      };
      const dung = () => {
        dungLai = true;
        clearInterval(hen);
      };
      // Hẹn giờ TRƯỚC rồi mới bắn nhịp đầu: `banMot` có nhánh gọi `dung()`, mà
      // `dung()` đọc `hen`. Gọi `banMot()` trước dòng `const hen` là mìn TDZ -
      // bất khả đạt hôm nay (trần 10 phút không thể vượt ở nhịp đầu) nhưng
      // `batDangNhap` được gọi NGOÀI `try` của `xuLyLuot`, nên ném ở đây là
      // lượt chết mà người nhắn không nhận được câu báo lỗi nào.
      const hen = setInterval(banMot, getTuning("TYPING_REFRESH_MS"));
      hen.unref?.();
      banMot();
      return dung;
    },
  };
}


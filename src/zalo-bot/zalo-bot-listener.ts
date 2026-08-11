import { createLogger } from "../shared/logger.js";
import type { ZaloBotClient } from "./zalo-bot-api-client.js";
import type { ZaloBotUpdate } from "./zalo-bot-api-types.js";

const log = createLogger("zalo-bot-listener");

/**
 * Vòng long polling cho một tài khoản bot.
 *
 * Ba hành vi dưới đây đều từ SỐ ĐO trên API thật, không phải phòng xa:
 *
 * 1. Poll RỖNG không phải lỗi. Hết hạn chờ mà không có tin thì Zalo trả
 *    `error_code: 408`, và `client.getUpdates` đã đổi nó thành `null`. Vòng này
 *    quay lại poll ngay, KHÔNG lùi - im lặng là trạng thái thường trực của bot.
 *
 * 2. Poll dồn dập bị nginx chặn **429** và trả HTML. Nên mọi lỗi đều phải lùi,
 *    không được quay lại poll ngay.
 *
 * 3. `getUpdates` trả MỘT update mỗi lần. Có tin thì poll lại NGAY (không nghỉ)
 *    để không tụt lại sau khi người ta nhắn liền mấy câu.
 */

export type ThamSoVongPoll = {
  accountId: string;
  client: ZaloBotClient;
  /** Số giây xin server giữ kết nối mỗi lần poll */
  timeoutGiay?: number;
  /** Lùi bao lâu sau lỗi ĐẦU TIÊN; các lỗi liên tiếp nhân đôi tới trần */
  luiBanDauMs?: number;
  luiToiDaMs?: number;
  onUpdate: (accountId: string, update: ZaloBotUpdate) => void;
  /** Tiêm để test không phải chờ thật */
  nguMs?: (ms: number) => Promise<void>;
};

const nguThat = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.());

export function batDauVongPoll(p: ThamSoVongPoll): { dung: () => void } {
  const timeoutGiay = p.timeoutGiay ?? 30;
  const luiBanDau = p.luiBanDauMs ?? 2_000;
  const luiToiDa = p.luiToiDaMs ?? 60_000;
  const ngu = p.nguMs ?? nguThat;

  let dungLai = false;
  let luiHienTai = luiBanDau;

  async function vong() {
    while (!dungLai) {
      try {
        const u = await p.client.getUpdates(timeoutGiay);
        // Poll thành công (kể cả rỗng) thì ĐẶT LẠI mức lùi. Không đặt lại thì
        // một sự cố mạng thoáng qua để bot lùi 60 giây mãi mãi về sau.
        luiHienTai = luiBanDau;
        if (!u) continue;

        // `onUpdate` do caller cung cấp và có thể ném (DB khoá, đĩa đầy...).
        // Ném ra đây thì nó rơi vào nhánh catch bên dưới và bị tính là lỗi
        // MẠNG - bot lùi 60 giây vì một lỗi hoàn toàn khác. Nuốt tại chỗ và
        // log, đúng cách router của kênh cá nhân đang làm.
        try {
          p.onUpdate(p.accountId, u);
        } catch (err) {
          log.error({ accountId: p.accountId, err }, "Xử lý tin đến thất bại - vòng poll vẫn chạy tiếp");
        }
      } catch (err) {
        if (dungLai) break;
        log.warn(
          { accountId: p.accountId, err, luiMs: luiHienTai },
          "Poll Zalo Bot thất bại - lùi rồi thử lại",
        );
        await ngu(luiHienTai);
        luiHienTai = Math.min(luiHienTai * 2, luiToiDa);
      }
    }
    log.info({ accountId: p.accountId }, "Đã dừng vòng poll Zalo Bot");
  }

  void vong();

  return {
    dung: () => {
      dungLai = true;
    },
  };
}

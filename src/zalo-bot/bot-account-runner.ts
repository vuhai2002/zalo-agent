import { getTuning } from "../config/runtime-tuning-settings.js";
import { createLogger } from "../shared/logger.js";
import { routeBotUpdate } from "./bot-message-router.js";
import { kenhBot } from "./kenh-bot.js";
import { LoiZaloBotApi, taoZaloBotClient } from "./zalo-bot-api-client.js";
import { batDauVongPoll } from "./zalo-bot-listener.js";

const log = createLogger("bot-account-runner");

/**
 * Khởi động MỘT tài khoản bot: client -> vòng poll -> router -> lượt agent.
 *
 * Trả hàm dừng. Gọi được nhiều lần cho nhiều account; mỗi account một vòng.
 */
/**
 * Nhà máy dựng client, tiêm được để test không đi ra mạng.
 *
 * Cần điểm tiêm RIÊNG ở đây chứ không chỉ ở route: đường `PUT /bot-token` khởi
 * động lại account sau khi lưu, tức đi qua `startAccount` -> `chayTaiKhoanBot`.
 * Vòng trước chỉ tiêm ở route nên vẫn còn ĐÚNG MỘT lời gọi thật tới
 * `bot-api.zaloplatforms.com` mỗi lần chạy `pnpm test` (đo bằng spy trên
 * `globalThis.fetch`).
 */
let taoClient = taoZaloBotClient;

/** Chỉ test dùng - đổi nhà máy client rồi trả hàm khôi phục */
export function tiemClientRunnerChoTest(gia: typeof taoZaloBotClient): () => void {
  const cu = taoClient;
  taoClient = gia;
  return () => {
    taoClient = cu;
  };
}

export async function chayTaiKhoanBot(p: {
  accountId: string;
  token: string;
}): Promise<{ dung: () => void }> {
  const client = taoClient({ token: p.token });

  // Kiểm token TRƯỚC khi mở vòng poll: token sai mà cứ poll thì mỗi vòng là một
  // dòng log lỗi kèm backoff, và người vận hành chỉ thấy "bot không trả lời"
  // chứ không thấy nguyên nhân.
  // Cổng kiểm token: LỖI TOKEN thì dừng hẳn (chờ bao lâu cũng không tự hết,
  // phải có người nhập lại), còn LỖI MẠNG thì cứ mở vòng poll - vòng đó đã có
  // backoff và tự phục hồi được.
  //
  // Không phân biệt hai ca này thì một cú chớp mạng lúc boot (container lên
  // trước khi DNS sẵn sàng) giết tài khoản bot VĨNH VIỄN: `startAllAccounts`
  // chỉ log rồi bỏ qua, không ai hẹn thử lại, và dashboard chỉ hiện "Đã có
  // token, chưa chạy". Fail-fast ở đây biến một trạng thái TỰ LÀNH thành một
  // sự cố phải có người bấm tay.
  try {
    const me = await client.getMe();
    log.info({ accountId: p.accountId, bot: me.display_name ?? me.id }, "Token bot hợp lệ");
  } catch (err) {
    const maHttp = err instanceof LoiZaloBotApi ? (err.httpStatus ?? Number(err.maLoi)) : undefined;
    const laLoiToken = maHttp === 401 || maHttp === 403;
    if (laLoiToken) throw err;
    log.warn(
      { accountId: p.accountId, err },
      "Không kiểm được token lúc khởi động (nghi lỗi mạng) - vẫn mở vòng poll, backoff sẽ tự thử lại",
    );
  }

  // Webhook và getUpdates LOẠI TRỪ NHAU (tài liệu Zalo ghi rõ). Webhook còn bật
  // thì poll không bao giờ nhận được gì, và triệu chứng là IM LẶNG chứ không
  // phải lỗi - gần như không thể đoán ra nếu không kiểm ở đây.
  let webhookDangBat: string | undefined;
  try {
    webhookDangBat = (await client.getWebhookInfo())?.url || undefined;
  } catch (err) {
    // Không đọc được thì cứ chạy tiếp: chặn boot ở đây là mất cả những account
    // khác vì một lời gọi phụ. Nhưng WARN chứ không debug - `getWebhookInfo`
    // có thể không tồn tại trên API sống (13/17 method đã trả 404 theo số đo),
    // và khi đó cả cơ chế phát hiện webhook thành code chết, trong khi triệu
    // chứng webhook-còn-bật đúng là "im lặng vĩnh viễn" mà nó sinh ra để bắt.
    log.warn(
      { accountId: p.accountId, err },
      "Không xác minh được webhook - nếu bot im lặng thì kiểm thủ công (webhook và long polling loại trừ nhau)",
    );
  }
  if (webhookDangBat) {
    // Tách khỏi nhánh catch ở trên: gỡ THẤT BẠI là đúng ca mà cả khối này sinh
    // ra để tránh (webhook còn bật = poll im lặng vĩnh viễn), nên phải WARN chứ
    // không được lẫn vào một dòng debug "không đọc được".
    log.warn(
      { accountId: p.accountId, url: webhookDangBat },
      "Tài khoản bot đang bật webhook - long polling sẽ KHÔNG nhận được tin. Đang gỡ",
    );
    try {
      await client.deleteWebhook();
    } catch (err) {
      log.warn(
        { accountId: p.accountId, err },
        "GỠ WEBHOOK THẤT BẠI - vòng poll sẽ im lặng, không nhận được tin nào",
      );
    }
  }

  const kenh = kenhBot(client);
  const vong = batDauVongPoll({
    accountId: p.accountId,
    client,
    // HÀM chứ không phải số: sửa trên trang Cấu hình ăn ngay ở vòng kế tiếp
    timeoutGiay: () => getTuning("ZALO_BOT_POLL_TIMEOUT_SECONDS"),
    onUpdate: (accountId, update) => routeBotUpdate(accountId, kenh, update),
  });

  log.info({ accountId: p.accountId }, "Đã khởi động tài khoản bot");
  return vong;
}

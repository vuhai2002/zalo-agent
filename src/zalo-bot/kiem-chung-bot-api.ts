/**
 * Script kiểm chứng Zalo Bot API bằng token THẬT.
 *
 * Chạy:  pnpm zalo-bot-check <token>
 *
 * Ba câu KHÔNG có trong tài liệu công khai mà script này trả lời:
 * 1. Bot có nhắn CHỦ ĐỘNG cho người chưa nhắn trước được không (quyết định số
 *    phận tính năng lịch hẹn trên kênh này).
 * 2. `getUpdates` có MẤT tin khi hai tin tới sát nhau không (nó trả MỘT update
 *    mỗi lần và KHÔNG có tham số `offset` để xác nhận đã đọc).
 * 3. Rate limit thật.
 *
 * Script chỉ ĐỌC và gửi tin cho chính người đang thử - không đụng DB, không
 * đụng tài khoản cá nhân đang chạy.
 */
import { taoZaloBotClient } from "./zalo-bot-api-client.js";

const token = process.argv[2];
if (!token) {
  console.error("Thiếu token. Dùng: pnpm zalo-bot-check <token>");
  process.exit(1);
}

const client = taoZaloBotClient({ token });

function in_(nhan: string, gia: unknown) {
  console.log(`  ${nhan.padEnd(34)} ${typeof gia === "string" ? gia : JSON.stringify(gia)}`);
}

async function main() {
  console.log("\n=== 1. Token sống chưa (getMe) ===");
  const me = await client.getMe();
  in_("bot", me);

  console.log("\n=== 2. Webhook có đang bật không ===");
  // Webhook và getUpdates LOẠI TRỪ NHAU - webhook đang bật thì poll không bao
  // giờ nhận được gì, và triệu chứng là "im lặng" chứ không phải lỗi.
  try {
    const wh = await client.getWebhookInfo();
    in_("webhook", wh?.url ? `ĐANG BẬT: ${wh.url} - phải gỡ mới poll được` : "không có (tốt)");
  } catch (e) {
    in_("webhook", `không đọc được: ${(e as Error).message}`);
  }

  console.log("\n=== 3. Nhắn cho tôi một tin từ Zalo, đang chờ 60 giây... ===");
  console.log("   (mở Zalo, tìm bot vừa tạo, gửi bất kỳ chữ gì)");
  const u = await client.getUpdates(60);
  if (!u?.message) {
    console.log("   KHÔNG nhận được gì. Kiểm lại: đã nhắn cho ĐÚNG bot chưa, webhook đã gỡ chưa.");
    return;
  }
  in_("event_name", u.event_name);
  in_("chat.id", u.message.chat?.id);
  in_("chat_type", u.message.chat?.chat_type);
  in_("from.display_name", u.message.from?.display_name);
  in_("date (thô)", u.message.date);
  in_("date (đọc ra)", new Date(u.message.date).toISOString());
  console.log("\n   payload đầy đủ:");
  console.log(JSON.stringify(u, null, 2).split("\n").map((d) => "   " + d).join("\n"));

  const chatId = u.message.chat!.id;

  console.log("\n=== 4. Gửi trả lời + markdown có được server dựng không ===");
  await client.sendMessage(chatId, "**Đậm** _nghiêng_ - nếu bạn thấy dấu sao thì parse_mode KHÔNG chạy.");
  in_("sendMessage", "đã gửi - kiểm bằng MẮT trên Zalo");

  console.log("\n=== 5. Dấu 'đang nhập' ===");
  try {
    await client.sendChatAction(chatId);
    in_("sendChatAction", "OK");
  } catch (e) {
    in_("sendChatAction", `KHÔNG dùng được: ${(e as Error).message}`);
  }

  console.log("\n=== 6. MẤT TIN? Gửi NHANH 3 tin từ Zalo, đang chờ... ===");
  console.log("   (gửi 3 tin liên tiếp thật nhanh: 1, 2, 3)");
  const nhan: string[] = [];
  for (let i = 0; i < 3; i++) {
    const t = await client.getUpdates(20);
    if (t?.message?.text) nhan.push(t.message.text);
  }
  in_("nhận được", nhan);
  in_("kết luận", nhan.length === 3 ? "KHÔNG mất tin - hàng chờ có đệm" : `MẤT ${3 - nhan.length}/3 tin`);

  console.log("\n=== 7. Rate limit: bắn 10 tin liên tiếp ===");
  let ok = 0;
  let loi = "";
  const batDau = Date.now();
  for (let i = 1; i <= 10; i++) {
    try {
      await client.sendMessage(chatId, `Thử nhịp ${i}/10`, null);
      ok++;
    } catch (e) {
      loi = (e as Error).message;
      break;
    }
  }
  in_("gửi thành công", `${ok}/10 trong ${Date.now() - batDau}ms`);
  in_("lỗi (nếu có)", loi || "không");

  console.log("\nXong. Câu hỏi CÒN LẠI phải tự thử: bot có nhắn được cho người");
  console.log("CHƯA từng nhắn cho nó không (nhờ một người khác đừng nhắn gì, rồi");
  console.log("thử gửi vào id của họ) - đây là điều kiện sống của tính năng lịch hẹn.\n");
}

main().catch((e: unknown) => {
  console.error("\nHỎNG:", e instanceof Error ? e.message : e);
  process.exit(1);
});

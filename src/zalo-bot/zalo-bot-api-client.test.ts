import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LoiZaloBotApi, taoZaloBotClient } from "./zalo-bot-api-client.js";

const TOKEN = "123456789:token-bi-mat-khong-duoc-lo";

/** fetch giả ghi lại lời gọi và trả phong bì cho sẵn */
function fetchGia(tra: { status?: number; body: unknown | string }) {
  const goi: { url: string; body: unknown }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    goi.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    const chu = typeof tra.body === "string" ? tra.body : JSON.stringify(tra.body);
    return new Response(chu, { status: tra.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, goi };
}

describe("zalo-bot-api-client", () => {
  it("gọi đúng đường dẫn kiểu Telegram: /bot{token}/{method}", async () => {
    const { f, goi } = fetchGia({ body: { ok: true, result: { id: "b1" } } });
    await taoZaloBotClient({ token: TOKEN, fetchImpl: f, gocApi: "https://x.test" }).getMe();
    assert.equal(goi[0]?.url, `https://x.test/bot${TOKEN}/getMe`);
  });

  it("TOKEN không được lọt vào thông điệp lỗi", async () => {
    // Token nằm trong ĐƯỜNG DẪN chứ không phải header, nên mọi thông điệp lỗi
    // có dán URL vào là rò bí mật ra log. Đây là lý do client tự bọc lại lỗi
    // fetch thay vì ném nguyên err gốc.
    const nem = (async () => {
      throw new Error(`request to https://x.test/bot${TOKEN}/getMe failed`);
    }) as unknown as typeof fetch;

    const client = taoZaloBotClient({ token: TOKEN, fetchImpl: nem, gocApi: "https://x.test" });
    const err = await client.getMe().then(() => null, (e: unknown) => e);

    assert.ok(err instanceof LoiZaloBotApi);
    assert.ok(!err.message.includes(TOKEN), `thông điệp lỗi chứa token: ${err.message}`);
    assert.equal(err.method, "getMe");
  });

  it("thân JSON có ok:false thì NÉM dù HTTP 200", async () => {
    // Kiểu Telegram: lỗi nghiệp vụ vẫn trả 200. Chỉ xét res.ok là nuốt lỗi.
    const { f } = fetchGia({ status: 200, body: { ok: false, message: "token không hợp lệ" } });
    const client = taoZaloBotClient({ token: TOKEN, fetchImpl: f, gocApi: "https://x.test" });
    await assert.rejects(() => client.getMe(), /token không hợp lệ/);
  });

  it("đọc ĐÚNG trường `description` - hình dạng lỗi THẬT của Zalo", async () => {
    // Đo trên API sống: Zalo trả {ok:false, description, error_code} kèm HTTP
    // 200. Client bản đầu chỉ đọc `message`/`error` nên mọi lỗi thật hiện ra
    // thành "HTTP 200" - vô dụng đúng lúc cần chẩn đoán nhất.
    const { f } = fetchGia({
      status: 200,
      body: { ok: false, description: "Bad request: The chat_id must not be empty", error_code: 400 },
    });
    const client = taoZaloBotClient({ token: TOKEN, fetchImpl: f, gocApi: "https://x.test" });
    const err = await client.getMe().then(() => null, (e: unknown) => e);
    assert.ok(err instanceof LoiZaloBotApi);
    assert.match(err.message, /chat_id must not be empty/);
    assert.equal(err.maLoi, 400);
  });

  it("method không tồn tại: 404 trong thân, KHÔNG phải HTTP 404", async () => {
    // Đo thật: sendDocument/sendFile/editMessageText... đều trả HTTP 200 kèm
    // {"ok":false,"description":"Not Found","error_code":404}. Xét theo mã HTTP
    // là coi method không tồn tại như một lời gọi thành công.
    const { f } = fetchGia({ status: 200, body: { ok: false, description: "Not Found", error_code: 404 } });
    const client = taoZaloBotClient({ token: TOKEN, fetchImpl: f, gocApi: "https://x.test" });
    const err = await client.getMe().then(() => null, (e: unknown) => e);
    assert.ok(err instanceof LoiZaloBotApi);
    assert.equal(err.maLoi, 404);
  });

  it("cổng trung gian ECHO đường dẫn: token bị CHE, không lọt vào thông điệp lỗi", async () => {
    // Đường rò thật, đã dựng lại: token nằm trong đường dẫn, cổng trung gian
    // (Apache/WAF/CDN) echo đường dẫn vào trang lỗi, client dán 200 ký tự thân
    // đó vào `err.message`, rồi nó đi tiếp vào `warning` của PATCH account (lên
    // màn hình dashboard) và vào file log. Tài liệu kiến trúc đã ghi số đo
    // "poll dồn dập -> nginx trả HTML" nên nhánh này chắc chắn có người tới.
    const { f } = fetchGia({
      status: 404,
      body: `<!DOCTYPE HTML><html><body><p>The requested URL /bot${TOKEN}/getMe was not found on this server.</p></body></html>`,
    });
    const client = taoZaloBotClient({ token: TOKEN, fetchImpl: f, gocApi: "https://x.test" });
    const err = await client.getMe().then(() => null, (e: unknown) => e);

    assert.ok(err instanceof LoiZaloBotApi);
    assert.ok(!err.message.includes(TOKEN), `token lọt vào thông điệp lỗi: ${err.message}`);
    assert.match(err.message, /<token>/, "phải thấy dấu vết đã che, không phải cắt mất đoạn");
  });

  it("thân JSON của nhánh hỏng cũng bị che", async () => {
    const { f } = fetchGia({
      status: 200,
      body: { ok: false, description: `Upstream /bot${TOKEN}/sendMessage refused`, error_code: 502 },
    });
    const client = taoZaloBotClient({ token: TOKEN, fetchImpl: f, gocApi: "https://x.test" });
    const err = await client.getMe().then(() => null, (e: unknown) => e);
    assert.ok(err instanceof LoiZaloBotApi);
    assert.ok(!err.message.includes(TOKEN), `token lọt qua nhánh ok:false: ${err.message}`);
  });

  it("che được cả khi cổng dùng entity HEX, hoặc chỉ echo NỬA bí mật", async () => {
    // Hai hình dạng mà lớp che theo-đường-dẫn lọt: `&#x3a;` (entity hex cho dấu
    // hai chấm) và thân chỉ có phần bí mật, không kèm tiền tố `<id>:`. Lớp che
    // riêng phần bí mật là CỘNG THÊM, không thay lớp cũ.
    const [id, biMat] = TOKEN.split(":");
    for (const than of [
      `<html>Upstream /bot${id}&#x3a;${biMat}/getMe failed</html>`,
      `<html>Auth failure for secret ${biMat} on this gateway</html>`,
    ]) {
      const { f } = fetchGia({ status: 502, body: than });
      const client = taoZaloBotClient({ token: TOKEN, fetchImpl: f, gocApi: "https://x.test" });
      const err = await client.getMe().then(() => null, (e: unknown) => e);
      assert.ok(err instanceof LoiZaloBotApi);
      assert.ok(!err.message.includes(biMat!), `bí mật lọt: ${err.message}`);
    }
  });

  it("che TRƯỚC khi cắt - mốc 200 rơi giữa bí mật không làm lọt tiền tố", async () => {
    // `che(chu.slice(0,200))` làm hỏng cả ba lớp che, vì cả ba khớp theo chuỗi
    // ĐẦY ĐỦ. Đo được 4-24 ký tự đầu của bí mật lọt ra tùy vị trí đệm. Quét
    // nhiều mốc đệm để không phụ thuộc đúng một con số may rủi.
    // Token RIÊNG cho ca này: bí mật không được bắt đầu bằng chữ nào của chuỗi
    // thay thế `<token>`, nếu không phép khẳng định tự khớp chính nó và báo
    // động giả (bí mật mặc định của file bắt đầu bằng "toke").
    const TOKEN_RIENG = "987654321:ZZQuySieuBiMatKhongTrungChuoiChe";
    const biMat = TOKEN_RIENG.split(":")[1]!;
    for (const dem of [150, 170, 180, 190, 195]) {
      const { f } = fetchGia({ status: 502, body: `${"x".repeat(dem)} secret ${biMat} end` });
      const client = taoZaloBotClient({ token: TOKEN_RIENG, fetchImpl: f, gocApi: "https://x.test" });
      const err = await client.getMe().then(() => null, (e: unknown) => e);
      assert.ok(err instanceof LoiZaloBotApi);
      // Không được lọt bất kỳ tiền tố nào dài từ 4 ký tự trở lên
      for (let n = 4; n <= biMat.length; n++) {
        assert.ok(
          !err.message.includes(biMat.slice(0, n)),
          `đệm ${dem}: lọt ${n} ký tự đầu của bí mật - ${err.message.slice(0, 120)}`,
        );
      }
    }
  });

  it("thân không phải JSON thì báo rõ và CẮT NGẮN", async () => {
    // Gateway hỏng hay trả trang HTML dài - dán nguyên vào log là rác.
    const { f } = fetchGia({ status: 502, body: "<html>" + "x".repeat(5000) + "</html>" });
    const client = taoZaloBotClient({ token: TOKEN, fetchImpl: f, gocApi: "https://x.test" });
    const err = await client.getMe().then(() => null, (e: unknown) => e);
    assert.ok(err instanceof LoiZaloBotApi);
    assert.ok(err.message.length < 400, `thông điệp dài ${err.message.length} ký tự - chưa cắt`);
    assert.equal(err.httpStatus, 502);
  });

  it("getUpdates trả null khi hết hạn chờ mà không có tin", async () => {
    // Zalo trả về phong bì rỗng chứ không phải mảng rỗng như Telegram.
    const { f } = fetchGia({ body: { ok: true, result: {} } });
    const client = taoZaloBotClient({ token: TOKEN, fetchImpl: f, gocApi: "https://x.test" });
    assert.equal(await client.getUpdates(1), null);
  });

  it("HẾT HẠN CHỜ (408) là poll RỖNG, không phải lỗi", async () => {
    // Đo trên API thật: không có tin thì Zalo trả
    // {"ok":false,"description":"Request timeout","error_code":408} kèm HTTP 200,
    // đúng sau số giây đã xin. Ném ra ngoài thì mọi phút im lặng thành một dòng
    // log lỗi, và vòng poll có backoff sẽ tự lùi mãi dù mạng hoàn toàn khỏe.
    const { f } = fetchGia({
      status: 200,
      body: { ok: false, description: "Request timeout", error_code: 408 },
    });
    const client = taoZaloBotClient({ token: TOKEN, fetchImpl: f, gocApi: "https://x.test" });
    assert.equal(await client.getUpdates(1), null);
  });

  it("408 dạng CHUỖI cũng là poll rỗng - `error_code` khai number|string", async () => {
    // Tài liệu không cam kết kiểu của `error_code`. Đo hiện tại ra số, nhưng so
    // nghiêm ngặt thì một ngày Zalo đổi sang chuỗi là mọi phút im lặng thành
    // log lỗi kèm lùi 60 giây.
    const { f } = fetchGia({
      status: 200,
      body: { ok: false, description: "Request timeout", error_code: "408" },
    });
    const client = taoZaloBotClient({ token: TOKEN, fetchImpl: f, gocApi: "https://x.test" });
    assert.equal(await client.getUpdates(1), null);
  });

  it("lỗi THẬT của getUpdates vẫn ném ra - không nuốt cùng 408", async () => {
    // Nuốt mọi lỗi cho tiện thì token sai hay bị 429 cũng thành "không có tin",
    // và bot im lặng vĩnh viễn mà không ai biết vì sao.
    const { f } = fetchGia({
      status: 200,
      body: { ok: false, description: "Invalid token", error_code: 401 },
    });
    const client = taoZaloBotClient({ token: TOKEN, fetchImpl: f, gocApi: "https://x.test" });
    await assert.rejects(() => client.getUpdates(1), /Invalid token/);
  });

  it("429 của nginx là HTML, không phải JSON - vẫn ném ra được", async () => {
    // Đo thật: poll dồn dập thì nginx chặn TRƯỚC khi tới ứng dụng, trả HTML.
    const { f } = fetchGia({ status: 429, body: "<html><head><title>429 Too Many Requests</title></head></html>" });
    const client = taoZaloBotClient({ token: TOKEN, fetchImpl: f, gocApi: "https://x.test" });
    const err = await client.getUpdates(1).then(() => null, (e: unknown) => e);
    assert.ok(err instanceof LoiZaloBotApi);
    assert.equal(err.httpStatus, 429);
  });

  it("getUpdates trả MỘT update, không phải mảng", async () => {
    const { f } = fetchGia({
      body: { ok: true, result: { event_name: "message.text.received", message: { text: "hi" } } },
    });
    const client = taoZaloBotClient({ token: TOKEN, fetchImpl: f, gocApi: "https://x.test" });
    const kq = await client.getUpdates(1);
    assert.equal(kq?.event_name, "message.text.received");
  });

  it("sendMessage mặc định KHÔNG xin server dựng markdown", async () => {
    // Chữ tới đường gửi đã hết markdown (bị `markdownSangStyleZalo` bóc ra
    // thành `Style[]` ở tầng trên), nên xin server dựng chỉ có thể BỚT ký tự.
    // Mặc định sai là dựng sẵn bẫy cho caller tiếp theo.
    const { f, goi } = fetchGia({ body: { ok: true, result: { message_id: "m1", date: 1 } } });
    const client = taoZaloBotClient({ token: TOKEN, fetchImpl: f, gocApi: "https://x.test" });
    await client.sendMessage("c1", "**đậm**");
    assert.deepEqual(goi[0]?.body, { chat_id: "c1", text: "**đậm**" });
  });

  it("vẫn xin được server dựng markdown khi truyền tường minh", async () => {
    const { f, goi } = fetchGia({ body: { ok: true, result: { message_id: "m1", date: 1 } } });
    const client = taoZaloBotClient({ token: TOKEN, fetchImpl: f, gocApi: "https://x.test" });
    await client.sendMessage("c1", "**đậm**", "markdown");
    assert.deepEqual(goi[0]?.body, { chat_id: "c1", text: "**đậm**", parse_mode: "markdown" });
  });

  it("token bị che kể cả khi cổng URL-ENCODE đường dẫn", async () => {
    // Phép thay nguyên văn không khớp `%3A`, và chuỗi đó đi thẳng vào
    // `err.message` rồi lên dashboard và file log.
    const [id, biMat] = TOKEN.split(":");
    const { f } = fetchGia({
      status: 502,
      body: `<html><body>Upstream /bot${id}%3A${biMat}/getMe timed out</body></html>`,
    });
    const client = taoZaloBotClient({ token: TOKEN, fetchImpl: f, gocApi: "https://x.test" });
    const err = await client.getMe().then(() => null, (e: unknown) => e);
    assert.ok(err instanceof LoiZaloBotApi);
    assert.ok(!err.message.includes(biMat!), `bí mật lọt qua khi URL-encode: ${err.message}`);
  });

  it("sendPhoto bỏ hẳn caption khi rỗng, không gửi chuỗi rỗng", async () => {
    const { f, goi } = fetchGia({ body: { ok: true, result: { message_id: "m1", date: 1 } } });
    const client = taoZaloBotClient({ token: TOKEN, fetchImpl: f, gocApi: "https://x.test" });
    await client.sendPhoto("c1", "https://anh.test/a.jpg");
    assert.deepEqual(goi[0]?.body, { chat_id: "c1", photo: "https://anh.test/a.jpg" });
  });
});

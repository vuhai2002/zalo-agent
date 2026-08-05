import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LoiVeHutAnh } from "./image-retry-policy.js";
import { readImageFromSseStream } from "./read-image-sse-stream.js";

/**
 * Trọng tâm: phân biệt "vẽ lâu nhưng còn sống" với "kết nối đã chết".
 * Provider bắn keepalive mỗi 30 giây (đo thật), nên im lặng là dấu hiệu chết,
 * còn tổng thời gian dài thì không nói lên điều gì.
 */

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const JPEG_B64 = JPEG.toString("base64");
const KEEPALIVE = 'event: progress\ndata: {"stage":"keepalive"}\n\n';
const DONE = `event: done\ndata: ${JSON.stringify({ created: 1, data: [{ b64_json: JPEG_B64 }] })}\n\n`;

/** Stream bắn từng mẩu theo lịch (ms kể từ lúc bắt đầu) */
function scheduledStream(parts: { atMs: number; text: string }[], endAfterMs?: number): Response {
  const enc = new TextEncoder();
  const timers: NodeJS.Timeout[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        timers.push(setTimeout(() => controller.enqueue(enc.encode(part.text)), part.atMs));
      }
      if (endAfterMs !== undefined) {
        timers.push(setTimeout(() => controller.close(), endAfterMs));
      }
    },
    cancel() {
      for (const t of timers) clearTimeout(t);
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("readImageFromSseStream - phân biệt chậm với chết", () => {
  it("stream CHẬM nhưng đều đặn vẫn chạy tới cùng, dù tổng lâu hơn trần im lặng nhiều lần", async () => {
    // 5 nhịp cách nhau 40ms với trần im lặng 100ms: tổng 200ms > trần, nhưng
    // chưa lần nào im quá 100ms nên phải xong. Đây chính là ca vẽ ảnh 3-4 phút
    // mà provider vẫn bắn keepalive mỗi 30 giây.
    const response = scheduledStream(
      [
        { atMs: 10, text: KEEPALIVE },
        { atMs: 50, text: KEEPALIVE },
        { atMs: 90, text: KEEPALIVE },
        { atMs: 130, text: KEEPALIVE },
        { atMs: 170, text: DONE },
      ],
      200,
    );

    const b64 = await readImageFromSseStream(response, 100);
    assert.equal(Buffer.from(b64, "base64").toString("hex"), JPEG.toString("hex"));
  });

  it("stream IM LẶNG quá trần -> dừng sớm, báo mất tín hiệu chứ không đợi hết tổng", async () => {
    const response = scheduledStream([{ atMs: 10, text: KEEPALIVE }, { atMs: 5000, text: DONE }]);

    const started = Date.now();
    await assert.rejects(
      () => readImageFromSseStream(response, 100),
      /mất tín hiệu|im lặng/i,
      "phải nói rõ là mất tín hiệu, không phải lỗi chung chung",
    );
    assert.ok(Date.now() - started < 2000, "phải cắt ngay khi im lặng, không chờ tới 5 giây");
  });

  it("im lặng quá trần thì vẫn ĐÓNG stream, không bỏ mặc kết nối", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(KEEPALIVE));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    await assert.rejects(() => readImageFromSseStream(response, 80));
    assert.equal(cancelled, true);
  });
});

/**
 * PHÂN LỚP lỗi ngay tại đây, vì đây là chỗ duy nhất còn nhìn thấy câu gốc của
 * provider - lên tới tool thì nó đã lẫn vào mọi lỗi khác. Lớp này quyết định
 * `create_image` có vẽ lại hay không, nên nhận nhầm là bot đợi thêm 1-3 phút
 * cho một lỗi vô phương.
 */
describe("readImageFromSseStream - phân lớp lỗi để quyết định vẽ lại", () => {
  it("router báo không ra ảnh -> LoiVeHutAnh, để tầng trên biết là đáng vẽ lại", async () => {
    const err = 'event: error\ndata: {"message":"Codex did not return an image. Account may not be entitled (Plus/Pro required)."}\n\n';
    await assert.rejects(
      () => readImageFromSseStream(scheduledStream([{ atMs: 0, text: err }], 20), 5000),
      (e) => e instanceof LoiVeHutAnh,
    );
  });

  it("lỗi provider KIỂU KHÁC vẫn là Error thường - không được vẽ lại bừa", async () => {
    const err = 'event: error\ndata: {"message":"upstream rate limit exceeded"}\n\n';
    await assert.rejects(
      () => readImageFromSseStream(scheduledStream([{ atMs: 0, text: err }], 20), 5000),
      (e) => e instanceof Error && !(e instanceof LoiVeHutAnh),
    );
  });

  it("stream đóng sạch mà thiếu done -> cùng lớp hụt ảnh, cũng đáng vẽ lại", async () => {
    await assert.rejects(
      () => readImageFromSseStream(scheduledStream([{ atMs: 0, text: KEEPALIVE }], 20), 5000),
      (e) => e instanceof LoiVeHutAnh,
    );
  });

  it("mất tín hiệu KHÔNG phải hụt ảnh - vẽ lại chỉ tốn thêm một trần im lặng nữa", async () => {
    await assert.rejects(
      () => readImageFromSseStream(scheduledStream([{ atMs: 0, text: KEEPALIVE }]), 60),
      (e) => e instanceof Error && !(e instanceof LoiVeHutAnh),
    );
  });
});

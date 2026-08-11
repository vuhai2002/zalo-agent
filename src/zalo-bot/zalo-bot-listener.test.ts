import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { batDauVongPoll } from "./zalo-bot-listener.js";
import type { ZaloBotClient } from "./zalo-bot-api-client.js";
import type { ZaloBotUpdate } from "./zalo-bot-api-types.js";

const TIN: ZaloBotUpdate = { event_name: "message.text.received", message: { text: "hi" } as never };

/**
 * Client giả chạy theo KỊCH BẢN: mỗi phần tử là kết quả của một lần getUpdates.
 * `null` = poll rỗng, `Error` = ném, object = có tin. Hết kịch bản thì treo mãi
 * để vòng lặp không quay tít trong lúc test đang đo.
 */
function clientTheoKichBan(kichBan: (ZaloBotUpdate | null | Error)[]) {
  let i = 0;
  const client = {
    getUpdates: async () => {
      const b = kichBan[i++];
      if (b === undefined) return await new Promise<null>(() => {});
      if (b instanceof Error) throw b;
      return b;
    },
  } as unknown as ZaloBotClient;
  return { client, daGoi: () => i };
}

/** Ngủ giả: ghi lại các quãng lùi thay vì chờ thật */
function nguGia() {
  const quang: number[] = [];
  return { quang, ngu: async (ms: number) => void quang.push(ms) };
}

const doiVongChay = () => new Promise((r) => setTimeout(r, 20));

describe("vòng poll Zalo Bot", () => {
  it("poll RỖNG không phải lỗi - không lùi, poll lại ngay", async () => {
    // Im lặng là trạng thái thường trực. Coi 408 là lỗi thì bot lùi tới trần
    // rồi phản hồi chậm hàng phút dù mạng hoàn toàn khỏe.
    const { client } = clientTheoKichBan([null, null, null]);
    const { quang, ngu } = nguGia();
    const v = batDauVongPoll({ accountId: "b1", client, onUpdate: () => {}, nguMs: ngu });
    await doiVongChay();
    v.dung();
    assert.deepEqual(quang, [], `poll rỗng mà vẫn lùi: ${quang.join(",")}`);
  });

  it("lỗi thì LÙI, và lùi NHÂN ĐÔI qua từng lần liên tiếp", async () => {
    // Đo thật: poll dồn dập bị nginx trả 429. Không lùi là tự đâm vào tường.
    const { client } = clientTheoKichBan([new Error("429"), new Error("429"), new Error("429")]);
    const { quang, ngu } = nguGia();
    const v = batDauVongPoll({
      accountId: "b1", client, onUpdate: () => {}, nguMs: ngu, luiBanDauMs: 100, luiToiDaMs: 1000,
    });
    await doiVongChay();
    v.dung();
    assert.deepEqual(quang.slice(0, 3), [100, 200, 400]);
  });

  it("lùi có TRẦN, không tăng vô hạn", async () => {
    const { client } = clientTheoKichBan(Array.from({ length: 8 }, () => new Error("x")));
    const { quang, ngu } = nguGia();
    const v = batDauVongPoll({
      accountId: "b1", client, onUpdate: () => {}, nguMs: ngu, luiBanDauMs: 100, luiToiDaMs: 300,
    });
    await doiVongChay();
    v.dung();
    assert.ok(Math.max(...quang) <= 300, `vượt trần: ${quang.join(",")}`);
  });

  it("poll thành công ĐẶT LẠI mức lùi", async () => {
    // Thiếu bước này thì một sự cố mạng thoáng qua để bot lùi ở mức tối đa
    // MÃI MÃI về sau - hỏng câm, chỉ biểu hiện là bot ngày càng chậm.
    const { client } = clientTheoKichBan([new Error("x"), new Error("x"), null, new Error("x")]);
    const { quang, ngu } = nguGia();
    const v = batDauVongPoll({
      accountId: "b1", client, onUpdate: () => {}, nguMs: ngu, luiBanDauMs: 100, luiToiDaMs: 1000,
    });
    await doiVongChay();
    v.dung();
    assert.deepEqual(quang, [100, 200, 100], `không đặt lại sau lần poll thành công: ${quang.join(",")}`);
  });

  it("onUpdate NÉM thì vòng vẫn chạy tiếp và KHÔNG bị tính là lỗi mạng", async () => {
    // DB khoá hay đĩa đầy làm onUpdate ném. Để nó rơi vào nhánh lỗi mạng thì
    // bot lùi 60 giây vì một nguyên nhân hoàn toàn khác.
    const { client, daGoi } = clientTheoKichBan([TIN, TIN, TIN]);
    const { quang, ngu } = nguGia();
    const v = batDauVongPoll({
      accountId: "b1", client, nguMs: ngu,
      onUpdate: () => { throw new Error("DB khoá"); },
    });
    await doiVongChay();
    v.dung();
    assert.deepEqual(quang, [], `onUpdate ném mà vòng lại lùi: ${quang.join(",")}`);
    assert.ok(daGoi() >= 3, `vòng dừng sau khi onUpdate ném (mới poll ${daGoi()} lần)`);
  });

  it("có tin thì poll lại NGAY - getUpdates chỉ trả một update mỗi lần", async () => {
    const { client } = clientTheoKichBan([TIN, TIN, TIN]);
    const nhan: ZaloBotUpdate[] = [];
    const { quang, ngu } = nguGia();
    const v = batDauVongPoll({ accountId: "b1", client, onUpdate: (_, u) => void nhan.push(u), nguMs: ngu });
    await doiVongChay();
    v.dung();
    assert.equal(nhan.length, 3, "không kéo hết tin đang chờ");
    assert.deepEqual(quang, [], "nghỉ giữa các tin - sẽ tụt lại khi người ta nhắn liền mấy câu");
  });

  it("dung() thì vòng dừng, không poll thêm", async () => {
    const { client, daGoi } = clientTheoKichBan([TIN, TIN, TIN, TIN, TIN, TIN]);
    const { ngu } = nguGia();
    const v = batDauVongPoll({ accountId: "b1", client, onUpdate: () => {}, nguMs: ngu });
    await doiVongChay();
    v.dung();
    const sauKhiDung = daGoi();
    await doiVongChay();
    assert.equal(daGoi(), sauKhiDung, "vẫn poll sau khi đã dừng");
  });
});

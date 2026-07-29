import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { currentTurnLogContext, runInTurnLogContext } from "./turn-log-context.js";

/**
 * Module thuần (chỉ dùng node:async_hooks) nên import tĩnh được, không cần
 * setupTestEnv.
 *
 * Điều thật sự cần khẳng định: ngữ cảnh SỐNG SÓT qua await. Đó là lý do dùng
 * AsyncLocalStorage thay vì biến module - log của tool sinh ra sau vài tầng
 * await, biến thường sẽ mất hoặc tệ hơn là lẫn sang lượt khác.
 */

const CTX = { accountId: "acc-1", threadId: "t-1", turnId: 42 };

describe("turn-log-context", () => {
  it("ngoài lượt thì không có ngữ cảnh - mixin không ghép gì vào log hệ thống", () => {
    assert.equal(currentTurnLogContext(), undefined);
  });

  it("giữ được ngữ cảnh qua nhiều tầng await", async () => {
    await runInTurnLogContext(CTX, async () => {
      assert.deepEqual(currentTurnLogContext(), CTX);
      await new Promise((r) => setTimeout(r, 5));
      assert.deepEqual(currentTurnLogContext(), CTX, "sau setTimeout vẫn phải còn");
      await (async () => {
        await Promise.resolve();
        assert.deepEqual(currentTurnLogContext(), CTX, "hàm lồng cũng thấy - đây là ca của tool");
      })();
    });
    assert.equal(currentTurnLogContext(), undefined, "ra khỏi lượt phải sạch");
  });

  it("hai lượt chạy xen kẽ KHÔNG lẫn ngữ cảnh của nhau", async () => {
    const thay: number[] = [];
    const luot = (turnId: number, chờ: number) =>
      runInTurnLogContext({ ...CTX, turnId }, async () => {
        await new Promise((r) => setTimeout(r, chờ));
        thay.push(currentTurnLogContext()!.turnId);
      });

    // Lượt 1 chờ lâu hơn nên kết thúc SAU lượt 2 - nếu dùng biến module thì
    // lượt 1 sẽ đọc ra id của lượt 2
    await Promise.all([luot(1, 20), luot(2, 5)]);
    assert.deepEqual(thay, [2, 1]);
  });

  it("lỗi ném ra không để ngữ cảnh sót lại", async () => {
    await assert.rejects(
      runInTurnLogContext(CTX, async () => {
        throw new Error("lượt hỏng");
      }),
      /lượt hỏng/,
    );
    assert.equal(currentTurnLogContext(), undefined);
  });
});

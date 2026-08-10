import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { trongGiaoDich } from "./db-transaction.js";

/**
 * `db-transaction.ts` chỉ import KIỂU từ `node:sqlite` (`import type`), không
 * chạm DB thật - nên test này KHÔNG cần `setupTestEnv()`/import động, dùng
 * import tĩnh bình thường. Chỉ cần một đối tượng giả có `exec` để ghi lại thứ
 * tự lệnh SQL, không cần mở SQLite thật.
 */
function taoDbGia(loiRollback?: Error): { db: DatabaseSync; lenhDaGoi: string[] } {
  const lenhDaGoi: string[] = [];
  const dbGia = {
    exec(sql: string): void {
      lenhDaGoi.push(sql);
      if (sql === "ROLLBACK" && loiRollback) {
        throw loiRollback;
      }
    },
  };
  // Ép kiểu: dbGia chỉ cần đúng phần `exec` mà `trongGiaoDich` thật sự gọi,
  // không cần đủ mọi phương thức của `DatabaseSync`.
  return { db: dbGia as unknown as DatabaseSync, lenhDaGoi };
}

/**
 * KHÔNG BAO GIỜ được GỌI ở runtime (không nằm trong `describe`/`it` nào cả) -
 * tồn tại DUY NHẤT để `tsc --noEmit` typecheck dòng `@ts-expect-error` bên
 * trong. Chốt hồi quy cho `NotPromise<T>` của `db-transaction.ts`: callback
 * `async` phải bị chặn Ở TẦNG KIỂU (không có test RUNTIME nào bắt được việc
 * này - `COMMIT` chạy đồng bộ ngay sau `viec()` nên callback async "vẫn chạy
 * được" ở runtime, chỉ sai NGẦM vì transaction đã đóng trước khi việc thật
 * xong). Nếu ai đó nới `viec: () => NotPromise<T>` trở lại thành `() => T`,
 * dòng dưới hết còn là lỗi kiểu, và `@ts-expect-error` biến thành lỗi "Unused
 * '@ts-expect-error' directive" - `pnpm typecheck` đỏ ngay, không cần
 * `node --test` chạy tới đây.
 */
function _khongGoiChiDeTypecheckCallbackAsyncBiChanOKieu(db: DatabaseSync): void {
  // @ts-expect-error - callback async PHẢI bị chặn ở kiểu (NotPromise<T>)
  trongGiaoDich(db, async () => 42);
}
void _khongGoiChiDeTypecheckCallbackAsyncBiChanOKieu;

describe("trongGiaoDich", () => {
  it("đường thành công: BEGIN IMMEDIATE rồi COMMIT, trả về đúng giá trị của viec()", () => {
    const { db, lenhDaGoi } = taoDbGia();

    const ketQua = trongGiaoDich(db, () => 42);

    assert.equal(ketQua, 42);
    assert.deepEqual(lenhDaGoi, ["BEGIN IMMEDIATE", "COMMIT"]);
  });

  it("viec() ném lỗi: gọi ROLLBACK, KHÔNG gọi COMMIT, ném lại đúng lỗi gốc", () => {
    const { db, lenhDaGoi } = taoDbGia();
    const loiGoc = new Error("lỗi từ viec()");

    assert.throws(
      () =>
        trongGiaoDich(db, () => {
          throw loiGoc;
        }),
      (err) => err === loiGoc,
    );
    assert.deepEqual(lenhDaGoi, ["BEGIN IMMEDIATE", "ROLLBACK"], "không được gọi COMMIT khi viec() hỏng");
  });

  it("viec() ném VÀ chính ROLLBACK cũng ném: lỗi lọt ra ngoài vẫn là lỗi GỐC, không phải lỗi rollback", () => {
    const loiRollback = new Error("lỗi khi rollback");
    const { db } = taoDbGia(loiRollback);
    const loiGoc = new Error("lỗi từ viec()");

    assert.throws(
      () =>
        trongGiaoDich(db, () => {
          throw loiGoc;
        }),
      (err) => err === loiGoc,
      "lỗi rollback phải bị nuốt, không được đè lên lỗi gốc",
    );
  });
});

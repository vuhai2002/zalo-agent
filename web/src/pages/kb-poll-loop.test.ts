import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { taoVongPoll } from "./kb-poll-loop";

/**
 * "Đồng hồ giả" - lịch hẹn giờ đồng bộ, hoàn toàn nằm trong tay test, không
 * đụng `setTimeout` thật. Test tự quyết định lúc nào "hết 4 giây" bằng cách
 * gọi `banTimer()`.
 */
function taoLichGia() {
  const dangCho = new Map<number, () => void | Promise<void>>();
  let idKeTiep = 1;
  return {
    henGio: (chay: () => void | Promise<void>): unknown => {
      const id = idKeTiep++;
      dangCho.set(id, chay);
      return id;
    },
    xoaGio: (id: unknown): void => {
      dangCho.delete(id as number);
    },
    /** Bắn ĐÚNG một timer đang chờ (mô phỏng hết chu kỳ) - trả false nếu không còn gì chờ */
    banTimer: async (): Promise<boolean> => {
      const entry = [...dangCho.entries()][0];
      if (!entry) return false;
      const [id, chay] = entry;
      dangCho.delete(id);
      await chay();
      return true;
    },
    soDangCho: (): number => dangCho.size,
  };
}

describe("taoVongPoll - 6 bất biến bắt buộc (rà soát phase 06, vòng 2)", () => {
  it("chiều 1: còn việc (cho_xu_ly) sau khi tải thành công -> hẹn lượt kế", async () => {
    const lich = taoLichGia();
    const vong = taoVongPoll({
      tai: async () => ({ thanhCong: true, items: [{ trangThai: "cho_xu_ly" }] }),
      henGio: lich.henGio,
      xoaGio: lich.xoaGio,
    });
    await vong.batDau();
    assert.equal(lich.soDangCho(), 1, "phải có đúng 1 lượt đang chờ hẹn");
  });

  it("chiều 2: hết việc (mọi nguồn san_sang) sau khi tải thành công -> KHÔNG hẹn lượt kế", async () => {
    const lich = taoLichGia();
    const vong = taoVongPoll({
      tai: async () => ({ thanhCong: true, items: [{ trangThai: "san_sang" }] }),
      henGio: lich.henGio,
      xoaGio: lich.xoaGio,
    });
    await vong.batDau();
    assert.equal(lich.soDangCho(), 0);
  });

  it("chiều 3: dungHan() (unmount) hủy đúng timer đang chờ - không để rơi rớt", async () => {
    const lich = taoLichGia();
    const vong = taoVongPoll({
      tai: async () => ({ thanhCong: true, items: [{ trangThai: "dang_xu_ly" }] }),
      henGio: lich.henGio,
      xoaGio: lich.xoaGio,
    });
    await vong.batDau();
    assert.equal(lich.soDangCho(), 1, "phải có timer đang chờ trước khi unmount");
    vong.dungHan();
    assert.equal(lich.soDangCho(), 0, "unmount phải hủy timer đang chờ");
  });

  it("chiều 4 (Important 1): tải THẤT BẠI nhưng lượt trước đã biết còn dang_xu_ly -> VẪN hẹn lượt kế", async () => {
    const lich = taoLichGia();
    let lanGoi = 0;
    const vong = taoVongPoll({
      tai: async () => {
        lanGoi++;
        if (lanGoi === 1) return { thanhCong: true, items: [{ trangThai: "dang_xu_ly" }] };
        return { thanhCong: false };
      },
      henGio: lich.henGio,
      xoaGio: lich.xoaGio,
    });
    await vong.batDau(); // lần 1: thành công, còn việc -> hẹn lượt kế
    assert.equal(lich.soDangCho(), 1);
    await lich.banTimer(); // lần 2: THẤT BẠI (mất mạng/502)
    assert.equal(lich.soDangCho(), 1, "lỗi mạng tạm thời không được làm poll chết - vẫn phải hẹn tiếp");
  });

  it("chiều 5: reload() trong lúc còn timer đang chờ -> hủy timer cũ TRƯỚC khi hẹn timer mới, không chồng", async () => {
    const lich = taoLichGia();
    const vong = taoVongPoll({
      tai: async () => ({ thanhCong: true, items: [{ trangThai: "cho_xu_ly" }] }),
      henGio: lich.henGio,
      xoaGio: lich.xoaGio,
    });
    await vong.batDau();
    assert.equal(lich.soDangCho(), 1, "sau lần đầu phải có đúng 1 timer đang chờ");
    await vong.reload(); // người dùng bấm reload trong lúc còn timer cũ đang chờ
    assert.equal(
      lich.soDangCho(),
      1,
      "không được để lại 2 timer cùng lúc - timer cũ phải bị hủy trước khi hẹn timer mới",
    );
  });

  // Đây CHÍNH LÀ ca bug hồi quy 07d726c: `reload` cũ gọi thẳng một lần tải,
  // không đi qua vòng lặp, nên MỘT KHI poll đã dừng (hết việc - trạng thái
  // nghỉ bình thường của trang) thì không gì hồi sinh được nó nữa. Thêm
  // nguồn mới / bấm "Xử lý lại" đều rơi vào đúng ngõ cụt này.
  it("chiều 6 (bug hồi quy 07d726c): poll ĐÃ DỪNG rồi reload() thấy việc mới -> TỰ khởi động lại", async () => {
    const lich = taoLichGia();
    let lanGoi = 0;
    const vong = taoVongPoll({
      tai: async () => {
        lanGoi++;
        // Lần 1: mọi nguồn san_sang -> poll dừng, không hẹn gì
        if (lanGoi === 1) return { thanhCong: true, items: [{ trangThai: "san_sang" }] };
        // Lần 2 (do reload() gọi SAU KHI poll đã dừng): có nguồn mới cho_xu_ly
        return { thanhCong: true, items: [{ trangThai: "cho_xu_ly" }] };
      },
      henGio: lich.henGio,
      xoaGio: lich.xoaGio,
    });
    await vong.batDau();
    assert.equal(lich.soDangCho(), 0, "lần đầu hết việc -> poll phải dừng, không còn timer nào");

    // Mô phỏng: người dùng thêm nguồn mới (KbAddSourceModal.onCreated) hoặc
    // bấm "Xử lý lại" (reindex) - cả hai đường đều gọi reload() của trang.
    await vong.reload();
    assert.equal(
      lich.soDangCho(),
      1,
      "reload() sau khi poll đã dừng PHẢI tự hẹn lại lượt kế nếu có việc mới",
    );
  });
});

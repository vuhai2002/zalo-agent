import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { KbSourceStatus } from "../dashboard-api-client";
import { taoVongPoll } from "./kb-poll-loop";
import type { KetQuaTaiNguon } from "./kb-poll-guard";

type Nguon = { trangThai: KbSourceStatus };

/**
 * "Đồng hồ giả" - lịch hẹn giờ đồng bộ, hoàn toàn nằm trong tay test, không
 * đụng `setTimeout` thật. Test tự quyết định lúc nào "hết chu kỳ" bằng cách
 * gọi `banTimer()`. Ghi lại `ms` được truyền vào `henGio` (Việc 2, rà soát
 * vòng 4) - test cũ khai `henGio: (chay) => ...` nuốt hẳn tham số `ms`, nên
 * đổi `CHU_KY_MS` thành bất kỳ số nào cũng xanh 6/6 mà không ai biết.
 */
function taoLichGia() {
  const dangCho = new Map<number, () => void | Promise<void>>();
  let idKeTiep = 1;
  let msGanNhat: number | null = null;
  return {
    henGio: (chay: () => void | Promise<void>, ms: number): unknown => {
      msGanNhat = ms;
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
    msDaHen: (): number | null => msGanNhat,
  };
}

/**
 * Bộ điều khiển `tai()` bằng tay - mỗi lần gọi trả về một Promise TREO, test
 * tự quyết định lúc nào và theo THỨ TỰ NÀO từng lượt "về" (mô phỏng hai
 * request mạng bay chồng nhau, có thể về ĐẢO thứ tự so với lúc gọi).
 */
function taoBoDieuKhienTai() {
  const dangTreo: ((gia: KetQuaTaiNguon<Nguon>) => void)[] = [];
  return {
    tai: (): Promise<KetQuaTaiNguon<Nguon>> =>
      new Promise((resolve) => {
        dangTreo.push(resolve);
      }),
    soLuotDangTreo: (): number => dangTreo.length,
    /** Cho lượt ở vị trí `chiSo` (thứ tự GỌI, không phải thứ tự về) trả kết quả */
    traVe: (chiSo: number, gia: KetQuaTaiNguon<Nguon>): void => {
      const resolve = dangTreo[chiSo];
      dangTreo.splice(chiSo, 1);
      resolve!(gia);
    },
  };
}

const KHONG_LAM_GI = () => {};

describe("taoVongPoll - 7 bất biến bắt buộc (rà soát phase 06)", () => {
  it("chiều 1: còn việc (cho_xu_ly) sau khi tải thành công -> hẹn lượt kế", async () => {
    const lich = taoLichGia();
    const vong = taoVongPoll<Nguon>({
      tai: async () => ({ thanhCong: true, items: [{ trangThai: "cho_xu_ly" }] }),
      apDung: KHONG_LAM_GI,
      henGio: lich.henGio,
      xoaGio: lich.xoaGio,
    });
    await vong.batDau();
    assert.equal(lich.soDangCho(), 1, "phải có đúng 1 lượt đang chờ hẹn");
  });

  it("chiều 2: hết việc (mọi nguồn san_sang) sau khi tải thành công -> KHÔNG hẹn lượt kế", async () => {
    const lich = taoLichGia();
    const vong = taoVongPoll<Nguon>({
      tai: async () => ({ thanhCong: true, items: [{ trangThai: "san_sang" }] }),
      apDung: KHONG_LAM_GI,
      henGio: lich.henGio,
      xoaGio: lich.xoaGio,
    });
    await vong.batDau();
    assert.equal(lich.soDangCho(), 0);
  });

  it("chiều 3: dungHan() (unmount) hủy đúng timer đang chờ - không để rơi rớt", async () => {
    const lich = taoLichGia();
    const vong = taoVongPoll<Nguon>({
      tai: async () => ({ thanhCong: true, items: [{ trangThai: "dang_xu_ly" }] }),
      apDung: KHONG_LAM_GI,
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
    const vong = taoVongPoll<Nguon>({
      tai: async () => {
        lanGoi++;
        if (lanGoi === 1) return { thanhCong: true, items: [{ trangThai: "dang_xu_ly" }] };
        return { thanhCong: false };
      },
      apDung: KHONG_LAM_GI,
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
    const vong = taoVongPoll<Nguon>({
      tai: async () => ({ thanhCong: true, items: [{ trangThai: "cho_xu_ly" }] }),
      apDung: KHONG_LAM_GI,
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
    const vong = taoVongPoll<Nguon>({
      tai: async (): Promise<KetQuaTaiNguon<Nguon>> => {
        lanGoi++;
        // Lần 1: mọi nguồn san_sang -> poll dừng, không hẹn gì
        if (lanGoi === 1) return { thanhCong: true, items: [{ trangThai: "san_sang" }] };
        // Lần 2 (do reload() gọi SAU KHI poll đã dừng): có nguồn mới cho_xu_ly
        return { thanhCong: true, items: [{ trangThai: "cho_xu_ly" }] };
      },
      apDung: KHONG_LAM_GI,
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

  it("hẹn ĐÚNG chu kỳ CHU_KY_MS = 4000ms - đổi hằng số này phải làm test đỏ", async () => {
    const lich = taoLichGia();
    const vong = taoVongPoll<Nguon>({
      tai: async () => ({ thanhCong: true, items: [{ trangThai: "cho_xu_ly" }] }),
      apDung: KHONG_LAM_GI,
      henGio: lich.henGio,
      xoaGio: lich.xoaGio,
    });
    await vong.batDau();
    assert.equal(lich.msDaHen(), 4000);
  });

  // Chiều 7 - CHỐNG TÁI NHẬP (rà soát vòng 4, Blocker). `reload` giờ đi qua
  // ĐÚNG `motLuot` (chiều 6) - mở đường cho HAI lượt bay song song. Việc hủy
  // timer nằm TRƯỚC await, việc GHI timerId nằm SAU await và (trước khi vá)
  // không kiểm lại: lượt về sau ghi đè timerId, bỏ rơi timer của lượt về
  // trước. Ba test dưới đây đều KHÔNG await tuần tự - đây là trục các test
  // chiều 1-6 (đều await xong lượt này mới gọi lượt sau) không hề chạm tới.
  it("chiều 7a: hai reload() KHÔNG await (bấm liên tiếp) -> chỉ còn 1 timer, không chồng", async () => {
    const lich = taoLichGia();
    const vong = taoVongPoll<Nguon>({
      tai: async () => ({ thanhCong: true, items: [{ trangThai: "cho_xu_ly" }] }),
      apDung: KHONG_LAM_GI,
      henGio: lich.henGio,
      xoaGio: lich.xoaGio,
    });
    const p1 = vong.reload();
    const p2 = vong.reload(); // KHÔNG await p1 trước khi gọi p2 - đúng "reindex 2 dòng liên tiếp"
    await Promise.all([p1, p2]);
    assert.equal(lich.soDangCho(), 1, "hai reload() bay chồng nhau không được để lại 2 timer");
  });

  // Đúng nguyên văn kịch bản người rà soát đo: 2 lượt CHỒNG NHAU đều VỀ XONG
  // (cả 2 đều còn việc, cả 2 đều thử hẹn giờ) TRƯỚC khi `dungHan()` chạy -
  // không có chốt tái nhập thì lượt về SAU ghi đè `timerId` của lượt về
  // TRƯỚC trong biến JS, nhưng CẢ HAI timer đều đã thật sự được hẹn ở tầng
  // lịch (fake `henGio` bên dưới, hay `window.setTimeout` thật) - `dungHan()`
  // chỉ dọn được đúng CÁI ĐANG ĐƯỢC THEO DÕI, còn lại 1 cái SỐNG SÓT.
  it("chiều 7b (Blocker): chồng 2 lượt - CẢ HAI đều về xong - rồi dungHan() -> không còn timer mồ côi sống sót", async () => {
    const lich = taoLichGia();
    const dk = taoBoDieuKhienTai();
    const vong = taoVongPoll<Nguon>({
      tai: dk.tai,
      apDung: KHONG_LAM_GI,
      henGio: lich.henGio,
      xoaGio: lich.xoaGio,
    });
    const p1 = vong.reload(); // lượt 1 - đang bay
    const p2 = vong.reload(); // lượt 2 - đang bay CHỒNG lượt 1
    assert.equal(dk.soLuotDangTreo(), 2, "cả 2 lượt phải đang chờ tai() trả về");

    // CẢ HAI đều về xong, CẢ HAI đều còn dang_xu_ly (còn việc) - nếu không có
    // chốt tái nhập thì cả 2 đều cố hẹn giờ.
    dk.traVe(0, { thanhCong: true, items: [{ trangThai: "dang_xu_ly" }] });
    dk.traVe(0, { thanhCong: true, items: [{ trangThai: "dang_xu_ly" }] });
    await Promise.all([p1, p2]);
    assert.equal(
      lich.soDangCho(),
      1,
      "2 lượt bay chồng nhau, cả 2 đều còn việc - CHỈ được có đúng 1 timer đang chờ, không phải 2",
    );

    vong.dungHan(); // unmount SAU KHI cả 2 lượt đã về

    assert.equal(
      lich.soDangCho(),
      0,
      "dungHan() phải dọn sạch timer đang chờ - không được còn timer mồ côi sống sót qua unmount",
    );
  });

  it("chiều 3+7: unmount NGAY GIỮA lúc 2 lượt còn đang bay (chưa lượt nào về) -> không lượt nào được hẹn giờ sau đó", async () => {
    const lich = taoLichGia();
    const dk = taoBoDieuKhienTai();
    const vong = taoVongPoll<Nguon>({
      tai: dk.tai,
      apDung: KHONG_LAM_GI,
      henGio: lich.henGio,
      xoaGio: lich.xoaGio,
    });
    const p1 = vong.reload(); // lượt 1 - đang bay
    const p2 = vong.reload(); // lượt 2 - đang bay CHỒNG lượt 1
    assert.equal(dk.soLuotDangTreo(), 2, "cả 2 lượt phải đang chờ tai() trả về trước khi unmount");

    vong.dungHan(); // unmount NGAY GIỮA lúc cả 2 lượt còn đang bay

    // request thật không hủy được giữa chừng - cả 2 lượt vẫn LẦN LƯỢT về xong
    dk.traVe(0, { thanhCong: true, items: [{ trangThai: "dang_xu_ly" }] });
    dk.traVe(0, { thanhCong: true, items: [{ trangThai: "dang_xu_ly" }] });
    await Promise.all([p1, p2]);

    assert.equal(
      lich.soDangCho(),
      0,
      "dungHan() phải chặn MỌI lượt còn dang dở - không có timer nào được hẹn sau khi đã unmount",
    );
  });

  it("chiều 7c: 2 lượt bay chồng nhau về ĐẢO THỨ TỰ -> chỉ lượt MỚI NHẤT được áp dụng, UI không lùi về bản cũ", async () => {
    const lich = taoLichGia();
    const dk = taoBoDieuKhienTai();
    const apDungGoi: KetQuaTaiNguon<Nguon>[] = [];
    const vong = taoVongPoll<Nguon>({
      tai: dk.tai,
      apDung: (kq) => apDungGoi.push(kq),
      henGio: lich.henGio,
      xoaGio: lich.xoaGio,
    });
    const p1 = vong.reload(); // lượt 1 (CŨ hơn)
    const p2 = vong.reload(); // lượt 2 (MỚI hơn, gọi sau)

    // Lượt 2 (MỚI) về TRƯỚC, lượt 1 (CŨ) về SAU - đúng kiểu network đảo thứ tự
    dk.traVe(1, { thanhCong: true, items: [{ trangThai: "san_sang" }] }); // idx 1 = lượt 2
    dk.traVe(0, { thanhCong: true, items: [{ trangThai: "dang_xu_ly" }] }); // idx 0 (còn lại) = lượt 1
    await Promise.all([p1, p2]);

    assert.equal(apDungGoi.length, 1, "lượt CŨ về muộn không được gọi apDung - chỉ lượt MỚI NHẤT mới được áp dụng");
    assert.equal(
      apDungGoi[0]!.thanhCong && apDungGoi[0]!.items[0]!.trangThai,
      "san_sang",
      "kết quả áp dụng phải là của lượt 2 (mới), không phải lượt 1 (cũ, tuy về sau nhưng khởi tạo trước)",
    );
  });
});

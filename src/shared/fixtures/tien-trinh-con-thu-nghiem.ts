import { phucVuTienTrinhCon } from "../phuc-vu-tien-trinh-con.js";

/**
 * Tiến trình con GIẢ cho `chay-tien-trinh-con-co-tran.test.ts`. Mỗi lệnh dựng
 * đúng một cách chết mà bộ chạy phải phân biệt được.
 */
type Lenh =
  | { lenh: "tra-ve"; giaTri: unknown }
  | { lenh: "lap-vo-han" }
  | { lenh: "cap-phat-ngoai-heap"; mb: number }
  | { lenh: "nem-loi"; ma: string }
  | { lenh: "thoat-im" };

class LoiCoMa extends Error {
  constructor(
    readonly ma: string,
    message: string,
  ) {
    super(message);
  }
}

const giu: Buffer[] = [];

phucVuTienTrinhCon<Lenh, unknown>(async (d) => {
  switch (d.lenh) {
    case "tra-ve":
      return d.giaTri;
    case "lap-vo-han":
      // Vòng lặp ĐỒNG BỘ - đúng loại việc không timeout nào trên cùng luồng
      // cắt được, và nhịp tự báo RSS cũng câm luôn.
      for (;;) {
        /* quay CPU */
      }
    case "cap-phat-ngoai-heap":
      // Buffer.alloc điền 0 nên trang thật sự được cấp (không chỉ hứa).
      // Nhả event loop giữa các khúc để nhịp tự báo RSS (dev Windows) chạy được.
      for (let i = 0; i < d.mb / 10; i++) {
        giu.push(Buffer.alloc(10 * 1024 * 1024, 1));
        await new Promise((r) => setImmediate(r));
      }
      return "cap-phat-xong";
    case "nem-loi":
      throw new LoiCoMa(d.ma, "lỗi do chính con báo");
    case "thoat-im":
      process.exit(0);
  }
});

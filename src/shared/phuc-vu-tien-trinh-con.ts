/**
 * Phía TIẾN TRÌNH CON của `chay-tien-trinh-con-co-tran.ts`, tách riêng để script
 * con chỉ nạp đúng phần nó cần (không kéo `child_process`/đo RSS theo).
 *
 * Giao thức IPC (`serialization: "advanced"` để chở Buffer): cha gửi
 * `{ duLieu }`; con trả `{ ok: true, ketQua }` | `{ ok: false, ma, loi }`, và
 * tự báo `{ rssMb }` mỗi 50 ms - số này chỉ được dùng khi cha không đọc được
 * `/proc` (máy dev Windows/macOS).
 */
export type ThongDiepCon = { ok: true; ketQua: unknown } | { ok: false; ma: string; loi: string } | { rssMb: number };

const NHIP_CON_TU_BAO_MS = 50;

/**
 * Phía con: nhận đúng MỘT việc, trả kết quả rồi thoát.
 *
 * Lỗi có thuộc tính `ma` dạng chuỗi được chở nguyên mã; lỗi khác mang mã
 * "loi". Không gửi stack (có đường dẫn máy chủ) - chỉ `message`.
 */
export function phucVuTienTrinhCon<V, R>(xuLy: (duLieu: V) => Promise<R>): void {
  const gui = (msg: ThongDiepCon, roiThoat: boolean) =>
    process.send?.(msg, undefined, {}, () => {
      if (roiThoat) process.exit(0);
    });

  const nhip = setInterval(() => gui({ rssMb: process.memoryUsage.rss() / (1024 * 1024) }, false), NHIP_CON_TU_BAO_MS);
  nhip.unref();

  process.once("message", (msg: { duLieu: V }) => {
    xuLy(msg.duLieu).then(
      (ketQua) => gui({ ok: true, ketQua }, true),
      (err: unknown) => {
        const ma = typeof (err as { ma?: unknown })?.ma === "string" ? (err as { ma: string }).ma : "loi";
        const loi = err instanceof Error ? err.message : String(err);
        gui({ ok: false, ma, loi }, true);
      },
    );
  });
}

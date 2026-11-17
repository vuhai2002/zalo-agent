/**
 * Hàng đợi DÙNG CHUNG cho mọi việc đọc tài liệu (Kho tri thức + tệp chat):
 * đúng MỘT tiến trình con trích xuất chạy tại một thời điểm trên cả tiến trình.
 *
 * Vì sao cố định 1, không chỉnh được: mỗi tiến trình con được phép phình tới
 * trần RSS (mặc định 320 MB) mà container chỉ có 768 MB. Hai con cùng phình là
 * cộng lại vượt container, và người chết là tiến trình CHA - đúng thứ tiến
 * trình con sinh ra để bảo vệ. Một người dội mười tệp thì chín tệp phải chờ.
 *
 * Cùng khuôn `video/hang-doi-tai-video.ts`. Lỗi của việc ném NGUYÊN VẸN ra
 * ngoài để caller biết vì sao hỏng.
 */

type Viec = {
  chay: () => Promise<unknown>;
  xong: (v: unknown) => void;
  hong: (e: unknown) => void;
};

const dangCho: Viec[] = [];
let dangChay = 0;

function chayTiep(): void {
  if (dangChay >= 1) return;
  const viec = dangCho.shift();
  if (!viec) return;
  dangChay++;
  Promise.resolve()
    .then(() => viec.chay())
    .then(viec.xong, viec.hong)
    .finally(() => {
      dangChay--;
      chayTiep();
    });
}

export function xepHangTrichXuat<T>(viec: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    dangCho.push({ chay: viec, xong: resolve as (v: unknown) => void, hong: reject });
    chayTiep();
  });
}

export function trangThaiHangDoiTrichXuat(): { dangChay: number; dangCho: number } {
  return { dangChay, dangCho: dangCho.length };
}

/** Chỉ dùng cho test - dọn sạch trạng thái giữa các ca */
export function resetHangDoiTrichXuat(): void {
  dangChay = 0;
  dangCho.length = 0;
}

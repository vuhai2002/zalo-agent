import { useCallback, useRef, useState } from "react";

/**
 * Đếm LỒNG NHAU cho dragenter/dragleave.
 *
 * Vì sao cần đếm thay vì một cờ boolean: `dragleave` bắn MỖI LẦN con trỏ đi qua
 * ranh giới của một phần tử CON bên trong vùng thả. Ô thả có chữ và icon bên
 * trong, nên rê chuột qua chúng sẽ bắn dragleave liên tục dù con trỏ chưa hề ra
 * khỏi vùng - viền sáng nhấp nháy đúng lúc người ta đang nhắm thả.
 *
 * dragenter tăng, dragleave giảm, chỉ tắt khi về 0. Trả về cả bộ handler để nơi
 * dùng không tự dựng lại logic này lần nữa.
 */
export function useVungTha(onFile: (file: File) => void) {
  const [dangKeo, setDangKeo] = useState(false);
  const doSau = useRef(0);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    // Chỉ phản ứng với thao tác kéo FILE. Kéo chữ bôi đen trong trang cũng bắn
    // dragenter - sáng viền lúc đó là báo một khả năng không có thật.
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    doSau.current += 1;
    setDangKeo(true);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    // Không chặn dragover thì trình duyệt giữ hành vi mặc định và sự kiện drop
    // KHÔNG BAO GIỜ bắn - đây là cái bẫy kinh điển của HTML drag and drop.
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    doSau.current = Math.max(0, doSau.current - 1);
    if (doSau.current === 0) setDangKeo(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      doSau.current = 0;
      setDangKeo(false);
      // Chỉ lấy file ĐẦU TIÊN: mỗi nguồn là một file, và mỗi lần nạp cần một
      // tên nguồn riêng. Nhận nhiều file một lúc là phải hỏi tên cho từng cái -
      // luồng khác hẳn, không gộp vào đây.
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return { dangKeo, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}

/**
 * Ô kéo thả có viền đứt, kiêm nút bấm chọn file. Dùng trong modal Thêm nguồn.
 * Vùng thả rộng hơn (cả bảng ở trang Kho tri thức) thì dùng thẳng `useVungTha`
 * chứ không dùng component này.
 */
export function FileDropZone({
  onFile,
  accept,
  moTa,
  tenFileDaChon,
}: {
  onFile: (file: File) => void;
  accept: string;
  moTa: string;
  tenFileDaChon?: string;
}) {
  const oNhap = useRef<HTMLInputElement>(null);
  const { dangKeo, handlers } = useVungTha(onFile);

  return (
    <div
      {...handlers}
      onClick={() => oNhap.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          oNhap.current?.click();
        }
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
        dangKeo
          ? "border-zalo-500 bg-zalo-50/60 dark:bg-zalo-950/30"
          : "border-line bg-tile/40 hover:border-zalo-400 hover:bg-tile"
      }`}
    >
      <input
        ref={oNhap}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          // Xóa giá trị để chọn LẠI ĐÚNG file vừa chọn vẫn bắn onChange - không
          // xóa thì người dùng sửa file trên đĩa rồi chọn lại cùng tên sẽ không
          // có gì xảy ra.
          e.target.value = "";
        }}
      />
      {tenFileDaChon ? (
        <>
          <span className="max-w-full truncate text-[14px] font-medium text-ink">{tenFileDaChon}</span>
          <span className="text-[12px] text-ink-soft">Bấm hoặc thả file khác để đổi</span>
        </>
      ) : (
        <>
          <span className="text-[14px] font-medium text-ink">
            {dangKeo ? "Thả file vào đây" : "Kéo thả file vào đây"}
          </span>
          <span className="text-[12px] text-ink-soft">hoặc bấm để chọn file</span>
        </>
      )}
      <span className="mt-0.5 text-[11px] text-ink-soft/70">{moTa}</span>
    </div>
  );
}

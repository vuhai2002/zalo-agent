/**
 * Ô ID của màn tạo agent - hai trạng thái, tách riêng vì logic "bám theo tên
 * cho tới khi người dùng giành quyền" là một mối quan tâm độc lập với phần
 * còn lại của form.
 *
 * - `idTuGo === null`: ID bám theo tên, hiện dạng chữ mờ kèm nút "sửa".
 * - `idTuGo !== null`: người dùng đã giành quyền, ô nhập tay và NGỪNG bám.
 *   Không có mốc này thì gõ tiếp tên sẽ ghi đè cái người dùng vừa gõ.
 */
export function AgentIdField({
  id,
  idTuGo,
  loi,
  tenTrong,
  onGoTay,
  onDoiId,
}: {
  /** ID hiệu lực (tự sinh hoặc gõ tay) */
  id: string;
  /** null = đang bám theo tên */
  idTuGo: string | null;
  loi: string;
  tenTrong: boolean;
  onGoTay: () => void;
  onDoiId: (v: string) => void;
}) {
  const idTrong = id === "";

  return (
    <div className="mt-2">
      {idTuGo === null ? (
        <p className="text-[12px] text-ink-soft">
          ID:{" "}
          <span className="font-mono">
            {idTrong ? <span className="italic">chưa tạo được từ tên</span> : id}
          </span>{" "}
          <button
            type="button"
            onClick={onGoTay}
            className="text-zalo-600 hover:underline dark:text-zalo-400"
          >
            sửa
          </button>
        </p>
      ) : (
        <>
          <label htmlFor="ag-id" className="mb-2 block text-[13px] font-medium text-ink">
            ID <span className="font-normal text-ink-soft">(không đổi được sau khi tạo)</span>
          </label>
          <input
            id="ag-id"
            className="gc-input w-full font-mono"
            value={idTuGo}
            onChange={(e) => onDoiId(e.target.value)}
            placeholder="tu-van-khoa-hoc"
            autoFocus
          />
        </>
      )}

      {loi && <p className="mt-1.5 text-[12px] text-red-600 dark:text-red-400">{loi}</p>}

      {/* Tên toàn ký tự lạ (vd "日本語") cho ra slug rỗng - phải nói rõ cách thoát */}
      {idTrong && idTuGo === null && !tenTrong && (
        <p className="mt-1.5 text-[12px] text-amber-600 dark:text-amber-400">
          Tên không tạo được ID chữ thường - bấm "sửa" để tự đặt.
        </p>
      )}
    </div>
  );
}

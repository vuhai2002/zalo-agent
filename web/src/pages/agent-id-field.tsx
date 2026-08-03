/**
 * Ô ID của màn tạo agent - hai trạng thái, tách riêng vì logic "bám theo tên
 * cho tới khi người dùng giành quyền" là một mối quan tâm độc lập với phần
 * còn lại của form.
 *
 * - `idTuGo === null`: ID bám theo tên, hiện dạng chữ mờ kèm nút "sửa".
 * - `idTuGo !== null`: người dùng đã giành quyền, ô nhập tay và NGỪNG bám.
 *   Không có mốc này thì gõ tiếp tên sẽ ghi đè cái người dùng vừa gõ.
 */
/**
 * Regex ID PHẢI khớp `createSchema` ở `src/server/routes/agent-routes.ts`.
 * `slugifyVietnamese` không bao giờ sinh ra chuỗi vi phạm, nhưng ô này cho gõ
 * tay - và trước khi có hàm này, gõ "Bot Test" hay "-abc" chỉ nhận đúng một câu
 * "Dữ liệu không hợp lệ" ở đáy modal, không chỉ ra được ô nào sai.
 */
const ID_HOP_LE = /^[a-z0-9][a-z0-9-]*$/;

export function kiemDinhDangId(id: string): string {
  if (id === "") return "";
  if (!ID_HOP_LE.test(id)) {
    return "Chỉ dùng chữ thường không dấu, số và dấu gạch ngang; phải bắt đầu bằng chữ hoặc số";
  }
  return "";
}

export function AgentIdField({
  id,
  idTuGo,
  moONhap = false,
  loi,
  tenTrong,
  onGoTay,
  onDoiId,
}: {
  /** ID hiệu lực (tự sinh hoặc gõ tay) */
  id: string;
  /** null = đang bám theo tên */
  idTuGo: string | null;
  /**
   * Buộc hiện ô nhập mà KHÔNG coi là người dùng đã giành quyền. Dùng cho nhánh
   * trùng ID: phải cho sửa được ngay, nhưng đổi tên agent vẫn là cách sửa hợp
   * lệ nên ID phải còn bám theo tên mới.
   */
  moONhap?: boolean;
  loi: string;
  tenTrong: boolean;
  onGoTay: () => void;
  onDoiId: (v: string) => void;
}) {
  const idTrong = id === "";
  const hienONhap = idTuGo !== null || moONhap;
  const loiDinhDang = kiemDinhDangId(id);

  return (
    <div className="mt-2">
      {!hienONhap ? (
        <p className="text-[12px] text-ink-soft">
          ID:{" "}
          <span className="font-mono">
            {idTrong ? <span className="italic">chưa tạo được từ tên</span> : id}
          </span>{" "}
          <button type="button" onClick={onGoTay} className="text-zalo-600 hover:underline">
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
            // `idTuGo ?? id`: khi ô mở vì trùng ID mà người dùng CHƯA gõ gì, vẫn
            // phải hiện ID đang bám theo tên chứ không phải ô trống
            value={idTuGo ?? id}
            onChange={(e) => onDoiId(e.target.value)}
            placeholder="cham-soc-khach-hang"
            autoFocus
          />
          {loiDinhDang && <p className="mt-1.5 text-[12px] text-red-600 dark:text-red-400">{loiDinhDang}</p>}
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

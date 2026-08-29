import { SecretInput } from "../shared/secret-input";
import { IconTrash } from "../shared/dashboard-icons";

export type HeaderRow = { key: string; value: string };

/**
 * Ví dụ placeholder xoay theo từng dòng: dòng đầu cho thấy kiểu Bearer token
 * (hay gặp nhất), dòng sau cho thấy kiểu header API key tự đặt - để người dùng
 * hiểu ngay đây là cặp tên/giá trị và có nhiều kiểu, không phải chỉ Authorization.
 */
const VI_DU_HEADER: HeaderRow[] = [
  { key: "Authorization", value: "Bearer sk-abc123def456..." },
  { key: "X-API-Key", value: "key_live_xxxxxxxxxxxx" },
];

/**
 * Danh sách header xác thực (Authorization, X-Api-Key...) dạng nhiều dòng
 * key/value, dùng trong `mcp-server-form-modal.tsx`.
 *
 * Backend KHÔNG BAO GIỜ trả lại giá trị header đã lưu (chỉ cờ `hasHeaders` -
 * xem `mcp-types.ts`), nên form luôn bắt đầu RỖNG dù đang sửa server đã có
 * header. "Trống = giữ key cũ": không gõ dòng nào thì Lưu không gửi trường
 * `headers` (giữ nguyên header cũ, mã hóa sẵn trong DB); gõ bất kỳ dòng nào thì
 * Lưu gửi CẢ danh sách, THAY THẾ TOÀN BỘ header cũ - khớp `capNhatServer`
 * (không cộng dồn theo từng key).
 */
export function McpHeaderFields({
  rows,
  onChange,
  hasSavedHeaders,
  onRemoveSaved,
  busy,
}: {
  rows: HeaderRow[];
  onChange: (rows: HeaderRow[]) => void;
  /** Server đang sửa đã có header lưu sẵn (ẩn giá trị) */
  hasSavedHeaders: boolean;
  /** Gọi `DELETE /api/mcp/:id/headers` - đường XÓA riêng, tách khỏi "để trống rồi Lưu" */
  onRemoveSaved: () => void;
  busy: boolean;
}) {
  function setRow(i: number, patch: Partial<HeaderRow>) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-ink">Header xác thực</span>
        <button
          type="button"
          onClick={() => onChange([...rows, { key: "", value: "" }])}
          className="cursor-pointer text-[12px] font-medium text-zalo-600 hover:underline dark:text-zalo-400"
        >
          + Thêm header
        </button>
      </div>

      {hasSavedHeaders && rows.length === 0 && (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-line bg-tile/60 px-3 py-2 text-[12px] text-ink-soft">
          <span>Đã lưu header (ẩn) - gõ dòng mới bên dưới để thay, hoặc xóa hẳn</span>
          <button
            type="button"
            onClick={onRemoveSaved}
            disabled={busy}
            className="shrink-0 cursor-pointer font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400"
          >
            Xóa header
          </button>
        </div>
      )}

      {rows.length === 0 && !hasSavedHeaders && (
        <p className="text-[12px] text-ink-soft">
          Không bắt buộc - chỉ điền nếu server yêu cầu xác thực. Ví dụ token:{" "}
          <code className="rounded bg-tile px-1 py-0.5 text-[11px]">Authorization: Bearer sk-abc123def456...</code>
        </p>
      )}

      {rows.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] text-ink-soft">
            Ô trái là tên header, ô phải là giá trị (token/khóa) - server cần header gì thì ghi trong tài liệu của nó.
          </p>
          {rows.map((r, i) => {
            const viDu = VI_DU_HEADER[i % VI_DU_HEADER.length]!;
            return (
            <div key={i} className="flex items-center gap-2">
              <input
                className="gc-input w-32 shrink-0"
                value={r.key}
                onChange={(e) => setRow(i, { key: e.target.value })}
                placeholder={viDu.key}
                maxLength={200}
              />
              <SecretInput
                className="min-w-0 flex-1"
                value={r.value}
                onChange={(value) => setRow(i, { value })}
                placeholder={viDu.value}
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                title="Bỏ dòng này"
                className="shrink-0 cursor-pointer p-1.5 text-ink-soft hover:text-red-600 dark:hover:text-red-400"
              >
                <IconTrash size={15} />
              </button>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

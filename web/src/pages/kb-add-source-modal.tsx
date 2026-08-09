import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../dashboard-api-client";
import { useChotNen } from "../shared/backdrop-close-guard";
import { DINH_DANG_HO_TRO } from "../shared/kb-formats";
import {
  layNhanTranDungLuong,
  layThongDiepVuotTran,
  layTranDungLuongMB,
  vuotTranDungLuong,
} from "./kb-upload-size-guard";

type Tab = "file" | "text";

/**
 * Modal thêm nguồn: hai tab "Tải file lên" (multipart, trả 202 - xử lý ở nền)
 * và "Gõ nội dung" (JSON, trả 201 - vẫn `cho_xu_ly` chờ worker cắt đoạn).
 * Đóng modal ngay sau khi tạo THÀNH CÔNG lệnh tạo, không đợi worker xử lý xong -
 * bảng nguồn ở trang cha tự cập nhật trạng thái khi poll lại.
 */
export function KbAddSourceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [tab, setTab] = useState<Tab>("file");
  const [ten, setTen] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [noiDung, setNoiDung] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tranMB, setTranMB] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nen = useChotNen(onClose);

  // I20: đọc trần dung lượng THẬT từ cấu hình (không hard-code) để hiện ngay
  // trên modal và chặn SỚM ở client - server vẫn là chốt cuối cùng nếu tải
  // chưa xong kịp lúc người dùng chọn file (tranMB còn null thì không chặn).
  useEffect(() => {
    let huy = false;
    api.tuning
      .get()
      .then((d) => !huy && setTranMB(layTranDungLuongMB(d.values)))
      .catch(() => {});
    return () => {
      huy = true;
    };
  }, []);

  const hopLe = tab === "file" ? Boolean(ten.trim() && file) : Boolean(ten.trim() && noiDung.trim());

  function chonFile(f: File | null) {
    setError("");
    if (f && tranMB !== null && vuotTranDungLuong(f.size, tranMB)) {
      setError(layThongDiepVuotTran(f.name, tranMB));
      setFile(null);
      // Xóa giá trị input gốc - không thì chọn LẠI đúng file đó không bắn
      // onChange lần nữa (trình duyệt coi value không đổi).
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFile(f);
  }

  async function luu() {
    if (!hopLe) return;
    setBusy(true);
    setError("");
    try {
      if (tab === "file") {
        await api.kb.uploadFile(ten.trim(), file!);
      } else {
        await api.kb.createText(ten.trim(), noiDung);
      }
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Tạo nguồn thất bại");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-[2px]" {...nen}>
      <div className="flex w-full max-w-lg flex-col rounded-2xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="font-semibold text-ink">Thêm nguồn</div>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-line px-3 py-1 text-[13px] text-ink-soft hover:bg-tile"
          >
            Đóng
          </button>
        </div>

        {/* Segmented control 2 tab - tự dựng, không phải <select> hay tab mặc định trình duyệt */}
        <div className="flex gap-1 border-b border-line px-5 pt-3">
          {(
            [
              ["file", "Tải file lên"],
              ["text", "Gõ nội dung"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`cursor-pointer rounded-t-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                tab === key
                  ? "border-b-2 border-zalo-500 text-zalo-600"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label htmlFor="kb-ten" className="mb-1.5 block text-[13px] font-medium text-ink">
              Tên nguồn
            </label>
            <input
              id="kb-ten"
              className="gc-input w-full"
              value={ten}
              onChange={(e) => setTen(e.target.value)}
              placeholder="vd: Chính sách đổi trả"
              maxLength={200}
            />
          </div>

          {tab === "file" ? (
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-ink">File</span>
                {tranMB !== null && (
                  <span className="text-[12px] text-ink-soft">{layNhanTranDungLuong(tranMB)}</span>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={DINH_DANG_HO_TRO.map((d) => `.${d}`).join(",")}
                className="hidden"
                onChange={(e) => chonFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full cursor-pointer rounded-lg border border-dashed border-line bg-tile/40 px-4 py-6 text-center text-[13px] text-ink-soft hover:border-zalo-400 hover:bg-tile"
              >
                {file ? (
                  <span className="font-medium text-ink">{file.name}</span>
                ) : (
                  <>Bấm để chọn file - {DINH_DANG_HO_TRO.join(", ")}</>
                )}
              </button>
            </div>
          ) : (
            <div>
              <label htmlFor="kb-noidung" className="mb-1.5 block text-[13px] font-medium text-ink">
                Nội dung
              </label>
              <textarea
                id="kb-noidung"
                className="gc-input min-h-40 w-full resize-y leading-relaxed"
                value={noiDung}
                onChange={(e) => setNoiDung(e.target.value)}
                placeholder="Dán hoặc gõ nội dung cần bot tra cứu..."
              />
            </div>
          )}

          {error && <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="border-t border-line px-5 py-4">
          <button
            onClick={() => void luu()}
            disabled={busy || !hopLe}
            className="w-full cursor-pointer rounded-lg bg-zalo-500 py-2.5 text-[14px] font-medium text-white hover:bg-zalo-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Đang thêm..." : "Thêm nguồn"}
          </button>
        </div>
      </div>
    </div>
  );
}

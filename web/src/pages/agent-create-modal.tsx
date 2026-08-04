import { useEffect, useRef, useState } from "react";
import { useChotNen } from "../shared/backdrop-close-guard";
import { slugifyVietnamese } from "../shared/slugify-vietnamese";
import { AgentIdField, kiemDinhDangId } from "./agent-id-field";
import { idDaCoRoi, type BanNhapAgent } from "./agent-draft";

/**
 * Bước 1 của việc tạo agent - chỉ THU THẬP, không ghi gì vào DB.
 *
 * Bấm "Tiếp tục" là sang trang tạo (`agent-create-page.tsx`) với đúng những gì
 * vừa nhập; agent chỉ sinh ra khi bấm Tạo ở trang đó. Trước đây modal này POST
 * thẳng rồi mới nhảy sang trang sửa, nên agent đã nằm trong DB trong khi màn
 * hình đang mời người dùng "Lưu thay đổi" - đọc ra như chưa lưu mà thực ra đã
 * lưu, và nút Lưu thì mờ vì chưa có gì đổi.
 */
export function AgentCreateModal({
  onClose,
  onTiepTuc,
  idDangCo,
}: {
  onClose: () => void;
  onTiepTuc: (banNhap: BanNhapAgent) => void;
  /** Id của các agent đang có - để chặn trùng ngay tại đây */
  idDangCo: string[];
}) {
  const [icon, setIcon] = useState("🤖");
  const [ten, setTen] = useState("");
  // null = ID đang bám theo tên. Bấm "sửa" là chốt lại một chuỗi và NGỪNG bám -
  // không có mốc này thì gõ tiếp tên sẽ ghi đè cái người dùng vừa gõ tay.
  const [idTuGo, setIdTuGo] = useState<string | null>(null);
  const [persona, setPersona] = useState("");
  const oTenRef = useRef<HTMLInputElement>(null);
  const nen = useChotNen(onClose);

  const id = idTuGo ?? slugifyVietnamese(ten);
  const tenTrong = ten.trim() === "";
  // Tên toàn ký tự lạ (vd "日本語") cho ra slug rỗng - phải bắt người dùng tự gõ
  const idTrong = id === "";
  const trungId = idDaCoRoi(id, idDangCo);

  useEffect(() => {
    oTenRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-[2px]"
      {...nen}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-xl">
        <h2 className="text-[17px] font-semibold text-ink">Tạo agent mới</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          Đặt tên trước đã. Bước sau còn model, số bước và công cụ - agent chỉ được tạo khi bạn bấm
          Tạo ở đó.
        </p>

        <div className="mt-5 flex gap-3">
          <div className="w-20">
            <label htmlFor="ag-icon" className="mb-2 block text-[13px] font-medium text-ink">
              Icon
            </label>
            <input
              id="ag-icon"
              className="gc-input w-full text-center text-lg"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={8}
            />
          </div>
          <div className="flex-1">
            <label htmlFor="ag-ten" className="mb-2 block text-[13px] font-medium text-ink">
              Tên hiển thị
            </label>
            <input
              ref={oTenRef}
              id="ag-ten"
              className="gc-input w-full"
              value={ten}
              onChange={(e) => setTen(e.target.value)}
              placeholder="vd: Chăm Sóc Khách Hàng"
              maxLength={100}
            />
          </div>
        </div>

        <AgentIdField
          id={id}
          idTuGo={idTuGo}
          // Trùng thì để nguyên trạng thái đang bám theo tên: đổi tên agent vẫn
          // là cách sửa hợp lệ, mà bung ô nhập ngay giữa lúc đang gõ tên thì bố
          // cục nhảy dựng lên. Câu báo lỗi tự chỉ đường sang nút "sửa".
          loi={trungId ? 'ID này đã có agent khác dùng - đổi tên hoặc bấm "sửa" để đặt id khác.' : ""}
          tenTrong={tenTrong}
          onGoTay={() => setIdTuGo(id)}
          onDoiId={setIdTuGo}
        />

        <div className="mt-5">
          <label htmlFor="ag-persona" className="mb-2 block text-[13px] font-medium text-ink">
            Agent này làm gì?{" "}
            <span className="font-normal text-ink-soft">(để trống cũng được, bước sau sửa tiếp)</span>
          </label>
          <textarea
            id="ag-persona"
            className="gc-input min-h-28 w-full resize-y leading-relaxed"
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            placeholder="Bạn là trợ lý chăm sóc khách hàng, xưng 'em' với khách..."
            maxLength={8000}
          />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-4 py-2 text-[14px] font-medium text-ink-soft hover:bg-tile"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={() => onTiepTuc({ id, name: ten.trim(), icon, persona })}
            disabled={tenTrong || idTrong || trungId || kiemDinhDangId(id) !== "" || icon.trim() === ""}
            className="rounded-lg bg-zalo-500 px-4 py-2 text-[14px] font-medium text-white hover:bg-zalo-600 disabled:opacity-50"
          >
            Tiếp tục
          </button>
        </div>
      </div>
    </div>
  );
}

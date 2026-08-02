import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../dashboard-api-client";
import { slugifyVietnamese } from "../shared/slugify-vietnamese";
import { AgentIdField } from "./agent-id-field";

/**
 * Modal TẠO agent - cố tình chỉ hỏi những gì bắt buộc.
 *
 * Tách khỏi trang sửa vì hai việc khác nhau: lúc tạo cần nhanh, còn tinh chỉnh
 * model/công cụ là chuyện làm sau khi đã có agent. Model, số bước, mức suy nghĩ
 * đều đã mang sẵn nghĩa "để trống = theo Cấu hình chung" nên bỏ qua ở đây là
 * hợp lệ, không phải mặc định giả.
 */
export function AgentCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** Tạo xong trả id để caller điều hướng sang trang sửa */
  onCreated: (id: string) => void;
}) {
  const [icon, setIcon] = useState("🤖");
  const [ten, setTen] = useState("");
  // null = ID đang bám theo tên. Bấm "sửa" là chốt lại một chuỗi và NGỪNG bám -
  // không có mốc này thì gõ tiếp tên sẽ ghi đè cái người dùng vừa gõ tay.
  const [idTuGo, setIdTuGo] = useState<string | null>(null);
  const [persona, setPersona] = useState("");
  const [loiId, setLoiId] = useState("");
  const [loi, setLoi] = useState("");
  const [busy, setBusy] = useState(false);
  const oTenRef = useRef<HTMLInputElement>(null);

  const id = idTuGo ?? slugifyVietnamese(ten);
  const tenTrong = ten.trim() === "";
  // Tên toàn ký tự lạ (vd "日本語") cho ra slug rỗng - phải bắt người dùng tự gõ
  const idTrong = id === "";

  useEffect(() => {
    oTenRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function tao() {
    setBusy(true);
    setLoi("");
    setLoiId("");
    try {
      const { agent } = await api.agentsAdmin.create({
        id,
        name: ten.trim(),
        icon,
        persona: persona.trim(),
      });
      onCreated(agent.id);
    } catch (err) {
      // 409 = trùng ID. Hiện ngay dưới ô ID chứ không phải báo lỗi chung chung -
      // đó là ô người dùng phải sửa.
      if (err instanceof ApiError && err.status === 409) {
        setLoiId(err.message);
        // Mở ô nhập tay để người dùng sửa ngay (AgentIdField tự focus)
        setIdTuGo(id);
      } else {
        setLoi(err instanceof ApiError ? err.message : "Tạo agent thất bại");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[17px] font-semibold text-ink">Tạo agent mới</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          Chỉ cần tên và mô tả ngắn. Model, số bước, công cụ chỉnh sau ở trang agent.
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
              placeholder="vd: Tư Vấn Khóa Học"
              maxLength={100}
            />
          </div>
        </div>

        <AgentIdField
          id={id}
          idTuGo={idTuGo}
          loi={loiId}
          tenTrong={tenTrong}
          onGoTay={() => setIdTuGo(id)}
          onDoiId={(v) => {
            setIdTuGo(v);
            setLoiId("");
          }}
        />

        <div className="mt-5">
          <label htmlFor="ag-persona" className="mb-2 block text-[13px] font-medium text-ink">
            Agent này làm gì?{" "}
            <span className="font-normal text-ink-soft">(viết ngắn cũng được, sửa lại sau thoải mái)</span>
          </label>
          <textarea
            id="ag-persona"
            className="gc-input min-h-28 w-full resize-y leading-relaxed"
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            placeholder="Bạn là trợ lý tư vấn khóa học, xưng 'em' với khách..."
            maxLength={8000}
          />
        </div>

        {loi && <p className="mt-3 text-[13px] text-red-600 dark:text-red-400">{loi}</p>}

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
            onClick={tao}
            disabled={busy || tenTrong || idTrong}
            className="rounded-lg bg-zalo-500 px-4 py-2 text-[14px] font-medium text-white hover:bg-zalo-600 disabled:opacity-50"
          >
            {busy ? "Đang tạo..." : "Tạo agent"}
          </button>
        </div>
      </div>
    </div>
  );
}

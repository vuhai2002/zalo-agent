import { useEffect, useState } from "react";
import { api, ApiError, type KbSourceListItem } from "../dashboard-api-client";
import { ToggleKnob } from "../shared/ui-bits";
import { AgentFormSection } from "./agent-form-field";
import { laCoDoiNguon } from "./kb-agent-sources-dirty";

/**
 * Nhóm "Kho tri thức" của trang sửa agent - chọn nguồn agent này được PHÉP đọc
 * qua tool `kb_search`. Chỉ hiện ở trang SỬA (cần `agentId` đã tồn tại - chưa
 * tạo agent thì chưa có id để gán nguồn).
 *
 * TỰ LƯU RIÊNG (nút "Lưu nguồn đã chọn"), KHÔNG đi qua nút "Lưu thay đổi" của
 * cả trang: gán nguồn nằm ở bảng `agent_kb_sources` hoàn toàn tách khỏi bản ghi
 * agent, không phải một trường trong `AgentDetailForm`.
 *
 * `onDirtyChange`/`onSaved` (I17/I18) báo state riêng của khối này lên trang
 * cha - xem `agent-kb-refresh-bridge.ts` cho lý do đầy đủ.
 */
export function AgentKbSourcesSection({
  agentId,
  onDirtyChange,
  onSaved,
}: {
  agentId: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
}) {
  const [sources, setSources] = useState<KbSourceListItem[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [banDau, setBanDau] = useState<Set<string>>(new Set());
  const [loi, setLoi] = useState("");
  const [busy, setBusy] = useState(false);
  const [daLuu, setDaLuu] = useState(false);

  useEffect(() => {
    let huy = false;
    Promise.all([api.kb.sources(), api.kb.agentSources(agentId)])
      .then(([s, b]) => {
        if (huy) return;
        setSources(s.items);
        setChecked(new Set(b.sourceIds));
        setBanDau(new Set(b.sourceIds));
      })
      .catch((err: unknown) => {
        if (huy) return;
        setSources([]);
        setLoi(err instanceof ApiError ? err.message : "Không tải được danh sách nguồn");
      });
    return () => {
      huy = true;
    };
  }, [agentId]);

  function toggle(id: string) {
    setDaLuu(false);
    setChecked((cu) => {
      const moi = new Set(cu);
      if (moi.has(id)) moi.delete(id);
      else moi.add(id);
      return moi;
    });
  }

  const coDoi = laCoDoiNguon(checked, banDau);

  // I17: báo cờ dirty lên trang cha MỖI LẦN nó đổi - kể cả lúc mount (dirty
  // bắt đầu là false, banDau === checked) để trang cha luôn đồng bộ, không
  // lệch pha nếu component này unmount/mount lại.
  useEffect(() => {
    onDirtyChange?.(coDoi);
  }, [coDoi, onDirtyChange]);

  async function luu() {
    setBusy(true);
    setLoi("");
    try {
      const { sourceIds } = await api.kb.setAgentSources(agentId, [...checked]);
      setBanDau(new Set(sourceIds));
      setChecked(new Set(sourceIds));
      setDaLuu(true);
      // I18: badge kb_search phải đổi ngay, không đợi F5 - báo trang cha tải
      // lại catalog tool SAU KHI lưu thành công.
      onSaved?.();
    } catch (err) {
      setLoi(err instanceof ApiError ? err.message : "Lưu thất bại");
    } finally {
      setBusy(false);
    }
  }

  if (sources === null) {
    return (
      <AgentFormSection title="Kho tri thức">
        <div className="py-5 first:pt-0 text-[13px] text-ink-soft">Đang tải danh sách nguồn...</div>
      </AgentFormSection>
    );
  }

  return (
    <AgentFormSection
      title="Kho tri thức"
      hint='Agent chỉ đọc được nguồn đã tick - mặc định KHÔNG tick nguồn nào. Nạp tài liệu và xem trạng thái xử lý ở trang "Kho tri thức".'
    >
      {loi && <p className="mb-3 text-[13px] text-red-600 dark:text-red-400">{loi}</p>}

      {sources.length === 0 ? (
        <p className="py-5 first:pt-0 text-[13px] text-ink-soft">
          Chưa có nguồn nào trong Kho tri thức - nạp tài liệu ở trang Kho tri thức trước.
        </p>
      ) : (
        <>
          <div className="max-h-72 divide-y divide-line overflow-y-auto">
            {sources.map((s) => (
              <div key={s.id} className="flex w-full items-center justify-between gap-4 py-3 first:pt-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-ink">{s.ten}</span>
                    {s.trangThai !== "san_sang" && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                        {s.trangThai === "hong" ? "hỏng" : s.trangThai === "dang_xu_ly" ? "đang xử lý" : "chờ xử lý"}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Bật tắt nguồn ${s.ten}`}
                  aria-pressed={checked.has(s.id)}
                  onClick={() => toggle(s.id)}
                  className="shrink-0 cursor-pointer"
                >
                  <ToggleKnob on={checked.has(s.id)} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 pt-4">
            <button
              type="button"
              onClick={() => void luu()}
              disabled={busy || !coDoi}
              className="cursor-pointer rounded-lg bg-zalo-500 px-4 py-2 text-[13px] font-medium text-white hover:bg-zalo-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Đang lưu..." : "Lưu nguồn đã chọn"}
            </button>
            {daLuu && !coDoi && (
              <span className="text-[13px] text-emerald-600 dark:text-emerald-400">Đã lưu</span>
            )}
          </div>
        </>
      )}
    </AgentFormSection>
  );
}

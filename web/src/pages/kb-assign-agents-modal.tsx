import { useEffect, useState } from "react";
import type { KbSourceListItem, ManagedAgent } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { useChotNen } from "../shared/backdrop-close-guard";
import { ToggleKnob } from "../shared/ui-bits";

/**
 * Gán MỘT nguồn cho nhiều agent, ngay tại trang Kho tri thức.
 *
 * Vì sao có modal này dù trang Agents đã gán được theo chiều kia: người vừa nạp
 * tài liệu nghĩ theo "tài liệu này cho ai đọc", không phải "agent này đọc được
 * những gì". Bắt họ nhớ tên nguồn rồi đi sang trang Agents tìm đúng agent chính
 * là ngõ cụt đã gặp thật - nguồn nạp xong nằm đó không agent nào đọc được,
 * trong khi bảng vẫn hiện "Sẵn sàng" nên mọi tín hiệu đều nói "xong rồi".
 *
 * Hai chiều cùng ghi `agent_kb_sources`, mỗi chiều THAY THẾ trọn danh sách theo
 * trục của nó - lưu ở đây đặt lại danh sách AGENT của nguồn này, không đụng
 * nguồn khác của cùng agent đó.
 */
export function KbAssignAgentsModal({
  source,
  onClose,
  onSaved,
}: {
  source: KbSourceListItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [agents, setAgents] = useState<ManagedAgent[] | null>(null);
  const [ticked, setTicked] = useState<Set<string> | null>(null);
  const [loi, setLoi] = useState("");
  const [dangLuu, setDangLuu] = useState(false);
  const nen = useChotNen(onClose);

  useEffect(() => {
    let huy = false;
    // Hai lời gọi song song: danh sách agent để hiện, và danh sách đang gán để
    // tick sẵn. Chờ cả hai rồi mới dựng `ticked` - dựng sớm từ một nửa dữ liệu
    // là ô tick nhấp nháy từ trạng thái sai sang trạng thái đúng.
    Promise.all([api.agentsAdmin.list(), api.kb.agentsUsingSource(source.id)])
      .then(([ds, dangGan]) => {
        if (huy) return;
        setAgents(ds.items);
        setTicked(new Set(dangGan.agentIds));
      })
      .catch((err: unknown) => {
        if (huy) return;
        setAgents([]);
        setTicked(new Set());
        setLoi(err instanceof ApiError ? err.message : "Không tải được danh sách agent");
      });
    return () => {
      huy = true;
    };
  }, [source.id]);

  function toggle(id: string) {
    setTicked((truoc) => {
      if (!truoc) return truoc;
      const sau = new Set(truoc);
      if (sau.has(id)) sau.delete(id);
      else sau.add(id);
      return sau;
    });
  }

  async function luu() {
    if (!ticked) return;
    setDangLuu(true);
    setLoi("");
    try {
      await api.kb.setSourceAgents(source.id, [...ticked]);
      onSaved();
      onClose();
    } catch (err: unknown) {
      setLoi(err instanceof ApiError ? err.message : "Không lưu được");
    } finally {
      setDangLuu(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-[2px]" {...nen}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-surface shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="truncate font-semibold text-ink">Agent nào đọc được nguồn này</div>
            <div className="truncate text-[12px] text-ink-soft">{source.ten}</div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 cursor-pointer rounded-lg border border-line px-3 py-1 text-[13px] text-ink-soft hover:bg-tile"
          >
            Đóng
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {agents === null && !loi && <p className="text-[13px] text-ink-soft">Đang tải...</p>}
          {agents !== null && agents.length === 0 && !loi && (
            <p className="py-10 text-center text-[13px] leading-relaxed text-ink-soft/60">
              Chưa có agent nào - tạo agent ở trang Agents trước, rồi quay lại gán nguồn
            </p>
          )}
          {agents !== null && agents.length > 0 && (
            <div className="divide-y divide-line">
              {agents.map((a) => (
                <div key={a.id} className="flex w-full items-center justify-between gap-4 py-3 first:pt-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-[16px]">{a.icon}</span>
                    <span className="truncate text-[14px] font-medium text-ink">{a.name}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Bật tắt agent ${a.name}`}
                    aria-pressed={ticked?.has(a.id) ?? false}
                    onClick={() => toggle(a.id)}
                    className="shrink-0 cursor-pointer"
                  >
                    <ToggleKnob on={ticked?.has(a.id) ?? false} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {loi && <p className="mt-3 text-[13px] text-red-600 dark:text-red-400">{loi}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          {/* Nói thẳng hệ quả của việc bỏ tick hết: người dùng vừa mới lạc đúng
              vì "Sẵn sàng" nghe như đã dùng được. */}
          <span className="text-[12px] text-ink-soft">
            {ticked && ticked.size === 0
              ? "Không agent nào đọc được nguồn này"
              : `${ticked?.size ?? 0} agent đọc được`}
          </span>
          <button
            onClick={() => void luu()}
            disabled={dangLuu || ticked === null}
            className="cursor-pointer rounded-lg bg-zalo-600 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-zalo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {dangLuu ? "Đang lưu..." : "Lưu"}
          </button>
        </div>
      </div>
    </div>
  );
}

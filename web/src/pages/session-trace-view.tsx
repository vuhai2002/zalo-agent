import { useEffect, useState, useRef } from "react";
import type { TraceStep, TraceTurn } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { formatTime } from "../shared/ui-bits";
import { TraceRong, TraceStepCard } from "./trace-step-card";

/**
 * Tab Trace trong drawer Sessions: các lượt agent của MỘT hội thoại.
 * Trang /trace ở sidebar là bản gộp mọi hội thoại, dùng chung card step.
 */
export function SessionTraceView({ accountId, threadId }: { accountId: string; threadId: string }) {
  const [turns, setTurns] = useState<TraceTurn[]>([]);
  const [dangMo, setDangMo] = useState<number | null>(null);
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [dangTai, setDangTai] = useState(false);

  useEffect(() => {
    api
      .traceTurns(accountId, threadId)
      .then((r) => setTurns(r.turns))
      .catch(() => setTurns([]));
  }, [accountId, threadId]);

  // Lượt ĐANG mở, đọc được ngay lúc response về. Không dùng state `dangMo` cho
  // việc này: closure của hàm bất đồng bộ giữ giá trị của lần render lúc bấm.
  const luotDangMo = useRef<number | null>(null);

  async function moLuot(turnId: number) {
    if (dangMo === turnId) {
      luotDangMo.current = null;
      setDangMo(null);
      return;
    }
    luotDangMo.current = turnId;
    setDangMo(turnId);
    setDangTai(true);
    const r = await api.traceSteps(turnId).catch(() => ({ steps: [] }));
    // Bấm lượt A rồi lượt B khi A chưa về: response A về SAU sẽ ghi đè và UI
    // hiện step của A dưới tiêu đề của B. Trên trang chẩn đoán thì nhầm lẫn đó
    // đắt - người đọc kết luận sai về đúng cái lượt họ đang truy.
    if (luotDangMo.current !== turnId) return;
    setSteps(r.steps);
    setDangTai(false);
  }

  if (turns.length === 0) return <TraceRong />;

  return (
    <div className="space-y-2">
      {turns.map((t) => (
        <div key={t.id}>
          <button
            type="button"
            onClick={() => moLuot(t.id)}
            className="flex w-full items-center justify-between rounded-xl border border-line bg-surface px-4 py-2.5 text-left hover:bg-tile"
          >
            <div>
              <div className="text-[13px] font-medium text-ink">
                {t.stepCount} step - {t.totalTokens.toLocaleString("vi-VN")} token
              </div>
              <div className="text-[11px] text-ink-soft/60">{formatTime(t.createdAt)}</div>
            </div>
            <span className="text-[12px] text-ink-soft">{dangMo === t.id ? "Thu gọn" : "Xem"}</span>
          </button>

          {dangMo === t.id && (
            <div className="mt-2 space-y-2 pl-2">
              {dangTai && <p className="text-[12px] text-ink-soft">Đang tải...</p>}
              {!dangTai && steps.map((s, i) => <TraceStepCard key={i} step={s} />)}
              {!dangTai && steps.length === 0 && (
                <p className="text-[12px] text-ink-soft">Lượt này không có step nào được ghi.</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

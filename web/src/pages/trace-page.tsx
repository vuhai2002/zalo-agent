import { useEffect, useState } from "react";
import type { TraceStep, TraceTurnAcrossThreads } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { formatTime } from "../shared/ui-bits";
import { TraceRong, TraceStepCard } from "./trace-step-card";

/**
 * Trang Trace: các lượt agent gần đây của MỌI hội thoại.
 *
 * Vì sao có trang riêng dù đã có tab trong drawer Sessions: bản đầu chỉ đặt
 * trong drawer, user đi tìm và không thấy - tính năng chẩn đoán mà chôn sâu ba
 * lớp thì coi như không có. Ở đây bấm một cái là thấy hết, không phải nhớ lỗi
 * xảy ra ở hội thoại nào.
 */
export function TracePage() {
  const [turns, setTurns] = useState<TraceTurnAcrossThreads[]>([]);
  const [dangMo, setDangMo] = useState<number | null>(null);
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [dangTai, setDangTai] = useState(false);
  const [loi, setLoi] = useState("");

  useEffect(() => {
    api
      .traceAll()
      .then((r) => setTurns(r.turns))
      .catch((e: Error) => setLoi(e.message));
  }, []);

  async function moLuot(turnId: number) {
    if (dangMo === turnId) {
      setDangMo(null);
      return;
    }
    setDangMo(turnId);
    setDangTai(true);
    const r = await api.traceSteps(turnId).catch(() => ({ steps: [] }));
    setSteps(r.steps);
    setDangTai(false);
  }

  return (
    <>
      <PageHeader
        title="Trace agent"
        subtitle="Mỗi lượt bot trả lời đã chạy qua những step nào: model nói gì, gọi tool nào với tham số gì"
      />

      {loi && (
        <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-[13px] text-red-700">
          {loi}
        </div>
      )}

      {turns.length === 0 && !loi && <TraceRong />}

      <div className="space-y-2">
        {turns.map((t) => (
          <div key={t.id}>
            <button
              type="button"
              onClick={() => moLuot(t.id)}
              className="flex w-full items-center justify-between rounded-xl border border-line bg-white px-5 py-3 text-left hover:bg-tile"
            >
              <div className="min-w-0">
                <div className="truncate text-[14px] font-medium text-ink">{t.displayName}</div>
                <div className="text-[11.5px] text-ink-soft/70">
                  {formatTime(t.createdAt)} - {t.stepCount} step -{" "}
                  {t.totalTokens.toLocaleString("vi-VN")} token
                </div>
              </div>
              <span className="shrink-0 text-[12.5px] text-ink-soft">
                {dangMo === t.id ? "Thu gọn" : "Xem"}
              </span>
            </button>

            {dangMo === t.id && (
              <div className="mt-2 space-y-2 pl-3">
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
    </>
  );
}

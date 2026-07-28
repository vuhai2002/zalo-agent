import { useState } from "react";
import type { TraceStep } from "../dashboard-api-client";

/**
 * Hiển thị một step agent. Tách file riêng vì dùng ở hai chỗ: trang Trace
 * (gộp mọi hội thoại) và tab Trace trong drawer Sessions (theo một hội thoại).
 *
 * Thứ tự trình bày có chủ đích: CẢNH BÁO lên trước cùng, vì đó là chỗ nhà cung
 * cấp báo tham số bị âm thầm bỏ qua - loại lỗi tốn nhiều thời gian nhất để tìm.
 */

/**
 * Khối chữ dài: cắt bớt chiều cao, bấm để bung hết.
 *
 * KHÔNG dùng khung cuộn riêng (`overflow-auto`): một step có cả chục khối như
 * này, mỗi khối một thanh cuộn thì con lăn chuột bị khối bên dưới con trỏ bắt
 * mất, phải rê ra tận lề mới cuộn được trang. Cắt + bung là thao tác rõ ràng hơn.
 */
function KhoiChu({ nhan, noiDung, mau }: { nhan: string; noiDung: string; mau?: string }) {
  const [bung, setBung] = useState(false);
  if (!noiDung) return null;

  // Ước lượng theo số dòng: dài hơn chừng này mới cần nút bung
  const daiQua = noiDung.length > 260 || noiDung.split("\n").length > 5;

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-soft/70">
          {nhan}
        </span>
        {daiQua && (
          <button
            type="button"
            onClick={() => setBung((v) => !v)}
            className="shrink-0 text-[11px] text-ink-soft hover:text-ink"
          >
            {bung ? "Thu gọn" : "Xem đầy đủ"}
          </button>
        )}
      </div>
      <pre
        className={`overflow-hidden whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-[12px] leading-relaxed ${
          daiQua && !bung ? "max-h-32" : ""
        } ${mau ?? "bg-tile text-ink-soft"}`}
      >
        {noiDung}
      </pre>
    </div>
  );
}

export function TraceStepCard({ step }: { step: TraceStep }) {
  return (
    <div className="rounded-xl border border-line bg-white p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-zalo-50 px-1.5 py-0.5 text-[11px] font-medium text-zalo-700">
          Step {step.stepNumber}
        </span>
        {step.finishReason && (
          <span className="rounded bg-tile px-1.5 py-0.5 text-[11px] text-ink-soft">
            {step.finishReason}
          </span>
        )}
        <span className="text-[11px] text-ink-soft/70">
          {step.inputTokens.toLocaleString("vi-VN")} vào /{" "}
          {step.outputTokens.toLocaleString("vi-VN")} ra
        </span>
      </div>

      {step.warnings.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-800">
            Cảnh báo từ nhà cung cấp
          </div>
          {step.warnings.map((w, i) => (
            <div key={i} className="text-[12px] text-amber-900">
              {w}
            </div>
          ))}
        </div>
      )}

      <KhoiChu nhan="Model suy nghĩ" noiDung={step.reasoning} mau="bg-violet-50 text-violet-900" />
      <KhoiChu nhan="Model nói" noiDung={step.text} />

      {step.toolCalls.map((c, i) => (
        <KhoiChu
          key={`c${i}`}
          nhan={`Gọi tool: ${c.name}`}
          noiDung={c.input}
          mau="bg-sky-50 text-sky-900"
        />
      ))}
      {step.toolResults.map((r, i) => (
        <KhoiChu key={`r${i}`} nhan={`Tool trả về: ${r.name}`} noiDung={r.output} />
      ))}
    </div>
  );
}

/** Câu giải thích khi chưa có trace nào - dùng chung cho cả hai chỗ */
export function TraceRong() {
  return (
    <p className="py-10 text-center text-[13px] leading-relaxed text-ink-soft/70">
      Chưa có trace nào.
      <br />
      Trace chỉ ghi từ lúc bật AGENT_TRACE_ENABLED, và tự dọn sau
      AGENT_TRACE_RETENTION_DAYS ngày.
    </p>
  );
}

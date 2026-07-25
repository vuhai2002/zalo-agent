import { useEffect, useState } from "react";
import type { OverviewData } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { Badge } from "../shared/ui-bits";

export function OverviewPage({ selectedAccountId }: { selectedAccountId: string }) {
  const [data, setData] = useState<OverviewData | null>(null);

  useEffect(() => {
    api.overview().then(setData).catch(() => setData(null));
  }, []);

  if (!data) return <p className="text-slate-400">Đang tải...</p>;

  const daily = data.usageByAccount.find((u) => u.accountId === selectedAccountId)?.daily ?? [];
  const totals = daily.reduce(
    (acc, d) => ({
      turns: acc.turns + d.turns,
      input: acc.input + d.inputTokens,
      output: acc.output + d.outputTokens,
    }),
    { turns: 0, input: 0, output: 0 },
  );

  const cards = [
    { label: "Lượt agent (7 ngày)", value: totals.turns.toLocaleString("vi-VN") },
    { label: "Token vào (7 ngày)", value: totals.input.toLocaleString("vi-VN") },
    { label: "Token ra (7 ngày)", value: totals.output.toLocaleString("vi-VN") },
  ];

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-slate-900">Overview</h1>
      <p className="mb-6 text-sm text-slate-500">Trạng thái bot và mức dùng LLM</p>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">{card.label}</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{card.value}</div>
          </div>
        ))}
      </div>

      <h2 className="mb-3 text-lg font-medium text-slate-900">Accounts</h2>
      <div className="space-y-2">
        {data.accounts.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-3"
          >
            <div>
              <div className="font-medium text-slate-900">{a.label}</div>
              <div className="text-xs text-slate-400">{a.id}</div>
            </div>
            <Badge tone={a.online ? "green" : a.enabled ? "red" : "gray"}>
              {a.online ? "Online" : a.enabled ? "Offline" : "Đã tắt"}
            </Badge>
          </div>
        ))}
      </div>

      {daily.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-lg font-medium text-slate-900">Theo ngày</h2>
          <div className="rounded-xl border border-slate-200 bg-white">
            {daily.map((d) => (
              <div
                key={d.day}
                className="flex items-center justify-between border-b border-slate-100 px-5 py-2.5 text-sm last:border-0"
              >
                <span className="text-slate-600">{d.day}</span>
                <span className="text-slate-500">
                  {d.turns} lượt - {(d.inputTokens + d.outputTokens).toLocaleString("vi-VN")} token
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

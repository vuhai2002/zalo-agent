import { useEffect, useState } from "react";
import type { OverviewData } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import {
  IconBolt,
  IconBrain,
  IconChat,
  IconClock,
  IconCpu,
  IconDatabase,
  IconHeart,
  IconMessage,
  IconSignal,
  IconUsers,
} from "../shared/dashboard-icons";
import {
  Badge,
  formatNumber,
  formatUptime,
  InfoTile,
  SectionCard,
  StatCard,
} from "../shared/ui-bits";

export function OverviewPage({ selectedAccountId }: { selectedAccountId: string }) {
  const [data, setData] = useState<OverviewData | null>(null);

  useEffect(() => {
    api.overview().then(setData).catch(() => setData(null));
  }, []);

  if (!data) return <p className="text-ink-soft">Đang tải...</p>;

  const daily = data.usageByAccount.find((u) => u.accountId === selectedAccountId)?.daily ?? [];
  const stats = data.statsByAccount.find((s) => s.accountId === selectedAccountId)?.stats;
  const today = new Date().toISOString().slice(0, 10);
  const todayUsage = daily.find((d) => d.day === today);
  // daily trả DESC theo ngày - đảo lại cho sparkline chạy trái -> phải
  const series = [...daily].reverse();

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="Trạng thái bot và mức dùng LLM"
        aside={
          <Badge tone={data.system.llm.hasOverride ? "blue" : "gray"} dot={false}>
            {data.system.llm.provider} · {data.system.llm.model}
          </Badge>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={IconMessage}
          label="Tin nhắn hôm nay"
          value={formatNumber(stats?.messagesToday ?? 0)}
          sub={<span className="text-[12px] text-ink-soft">/ {formatNumber(stats?.messagesTotal ?? 0)} tổng</span>}
          series={series.map((d) => d.turns)}
        />
        <StatCard
          icon={IconBolt}
          label="Lượt agent hôm nay"
          value={formatNumber(todayUsage?.turns ?? 0)}
          series={series.map((d) => d.turns)}
        />
        <StatCard
          icon={IconCpu}
          label="Token hôm nay"
          value={formatNumber((todayUsage?.inputTokens ?? 0) + (todayUsage?.outputTokens ?? 0))}
          sub={
            <span className="text-[12px] text-ink-soft">
              {formatNumber(todayUsage?.inputTokens ?? 0)} vào / {formatNumber(todayUsage?.outputTokens ?? 0)} ra
            </span>
          }
          series={series.map((d) => d.inputTokens + d.outputTokens)}
        />
        <StatCard
          icon={IconUsers}
          label="Contacts"
          value={formatNumber(stats?.contacts ?? 0)}
          sub={<span className="text-[12px] text-ink-soft">{formatNumber(stats?.threads ?? 0)} sessions</span>}
        />
      </div>

      <SectionCard
        icon={IconHeart}
        title="System Health"
        aside={<Badge tone="gray" dot={false}>node {data.system.nodeVersion}</Badge>}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <InfoTile icon={IconClock} label="Uptime" value={formatUptime(data.system.uptimeSeconds)} />
          <InfoTile icon={IconDatabase} label="Database" value="SQLite · Connected" />
          <InfoTile
            icon={IconSignal}
            label="Accounts online"
            value={`${data.accounts.filter((a) => a.online).length} / ${data.accounts.length}`}
          />
          <InfoTile icon={IconChat} label="Sessions" value={formatNumber(stats?.threads ?? 0)} />
          <InfoTile icon={IconUsers} label="Contacts" value={formatNumber(stats?.contacts ?? 0)} />
          <InfoTile icon={IconBrain} label="Memory facts" value={formatNumber(stats?.memories ?? 0)} />
        </div>

        <div className="mt-5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Channels
          </div>
          <div className="flex flex-wrap gap-2">
            {data.accounts.map((a) => (
              <Badge key={a.id} tone={a.online ? "green" : a.enabled ? "red" : "gray"}>
                {a.label}
              </Badge>
            ))}
          </div>
        </div>
      </SectionCard>

      {series.length > 0 && (
        <div className="mt-5">
          <SectionCard icon={IconBolt} title="Mức dùng 7 ngày">
            <div>
              {series.map((d) => {
                const total = d.inputTokens + d.outputTokens;
                const max = Math.max(...series.map((x) => x.inputTokens + x.outputTokens), 1);
                return (
                  <div
                    key={d.day}
                    className="flex items-center gap-3 border-b border-line/60 py-2 text-[13px] last:border-0 sm:gap-4"
                  >
                    <span className="w-12 shrink-0 text-ink-soft sm:w-20">{d.day.slice(5)}</span>
                    <div className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-tile">
                      <div
                        className="h-full rounded-full bg-zalo-500"
                        style={{ width: `${Math.max(2, (total / max) * 100)}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-right text-ink-soft">
                      <span className="hidden sm:inline">{d.turns} lượt · </span>
                      {formatNumber(total)} token
                    </span>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}

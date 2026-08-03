import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
  IconGrid,
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
import { UsageBarChart, type UsageDay } from "./usage-bar-chart";

export function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [chiSo, setChiSo] = useState<"turns" | "tokens">("turns");
  const [soNgay, setSoNgay] = useState(7);

  useEffect(() => {
    api.overview(soNgay).then(setData).catch(() => setData(null));
  }, [soNgay]);

  if (!data) return <p className="text-ink-soft">Đang tải...</p>;

  // Tổng hợp mọi account: gộp daily theo ngày, cộng dồn stats
  const dailyByDay = new Map<string, { turns: number; inputTokens: number; outputTokens: number }>();
  for (const { daily } of data.usageByAccount) {
    for (const d of daily) {
      const agg = dailyByDay.get(d.day) ?? { turns: 0, inputTokens: 0, outputTokens: 0 };
      agg.turns += d.turns;
      agg.inputTokens += d.inputTokens;
      agg.outputTokens += d.outputTokens;
      dailyByDay.set(d.day, agg);
    }
  }
  const stats = data.statsByAccount.reduce(
    (acc, { stats: s }) => ({
      threads: acc.threads + s.threads,
      contacts: acc.contacts + s.contacts,
      memories: acc.memories + s.memories,
      messagesTotal: acc.messagesTotal + s.messagesTotal,
      messagesToday: acc.messagesToday + s.messagesToday,
    }),
    { threads: 0, contacts: 0, memories: 0, messagesTotal: 0, messagesToday: 0 },
  );
  // todayKey do server tính theo BOT_TIMEZONE (không phải new Date() của trình
  // duyệt) - tự tính lại ở đây từng làm 2 ô "hôm nay" hiện 0 suốt 7 tiếng đầu
  // ngày VN vì khóa ngày UTC của trình duyệt không khớp khóa ngày VN của server.
  const todayUsage = dailyByDay.get(data.todayKey);
  // Sparkline chạy trái -> phải theo thời gian
  const series: UsageDay[] = [...dailyByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, agg]) => ({ day, ...agg }));

  const tongLuot = series.reduce((n, d) => n + d.turns, 0);
  const tongToken = series.reduce((n, d) => n + d.inputTokens + d.outputTokens, 0);
  const trungBinhNgay = series.length > 0 ? Math.round(tongToken / series.length) : 0;

  return (
    <div>
      <PageHeader icon={IconGrid} title="Tổng quan" subtitle="Trạng thái bot và mức dùng LLM" />

      {/* Bot khởi động BÌNH THƯỜNG khi chưa cấu hình LLM (cố ý - phải vào được
          dashboard mới nhập được). Không có dải này thì bức tranh người dùng
          thấy là: dashboard xanh, account online, mà mọi tin nhắn đều nhận câu
          "chưa cài đặt xong". Cảnh báo duy nhất trước đây là một dòng log lúc
          boot, thứ không ai mở dashboard để đọc. */}
      {!data.system.llm.daCauHinh && (
        <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/40">
          <div className="text-[13px] font-semibold text-amber-900 dark:text-amber-200">
            Chưa cấu hình LLM - bot chưa trả lời được tin nhắn nào
          </div>
          <div className="mt-1 text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
            Thiếu API key, tên model hoặc base URL.{" "}
            <Link to="/providers" className="font-medium underline underline-offset-2">
              Nhập ở trang Providers
            </Link>
          </div>
        </div>
      )}

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={IconMessage}
          label="Tin nhắn hôm nay"
          value={formatNumber(stats?.messagesToday ?? 0)}
          sub={<span className="text-[12px] text-ink-soft">/ {formatNumber(stats?.messagesTotal ?? 0)} tổng</span>}
          // KHÔNG truyền `series`: dãy theo ngày chỉ có `turns` (lượt agent), mà
          // card ngay bên cạnh đã vẽ đúng dãy đó. Vẽ lại ở đây thì hai card khác
          // đầu đề lại có đường biểu diễn giống hệt nhau - đọc ra như thể "tin
          // nhắn" và "lượt agent" là một.
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
        title="Tình trạng hệ thống"
        subtitle="Bot đang chạy ra sao và giữ bao nhiêu dữ liệu"
        aside={<Badge tone="gray" dot={false}>node {data.system.nodeVersion}</Badge>}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <InfoTile
            icon={IconClock}
            label="Uptime"
            value={formatUptime(data.system.uptimeSeconds)}
            hint="Thời gian hoạt động"
          />
          <InfoTile icon={IconDatabase} label="Database" value="SQLite · Connected" hint="Trạng thái kết nối" />
          <InfoTile
            icon={IconSignal}
            label="Accounts online"
            value={`${data.accounts.filter((a) => a.online).length} / ${data.accounts.length}`}
            hint="Tài khoản đang online"
          />
          <InfoTile
            icon={IconChat}
            label="Sessions"
            value={formatNumber(stats?.threads ?? 0)}
            hint="Phiên hội thoại"
          />
          <InfoTile
            icon={IconUsers}
            label="Contacts"
            value={formatNumber(stats?.contacts ?? 0)}
            hint="Tổng số liên hệ"
          />
          <InfoTile
            icon={IconBrain}
            label="Memory facts"
            value={formatNumber(stats?.memories ?? 0)}
            hint="Dữ liệu trí nhớ"
          />
        </div>

        <div className="mt-5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Kênh
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
          <SectionCard
            icon={IconBolt}
            title="Mức sử dụng"
            subtitle={`Theo dõi hoạt động ${data.days} ngày gần nhất`}
            aside={
              <div className="flex flex-wrap items-center gap-2">
                {/* Hai chỉ số KHÔNG vẽ chung một trục: số token lớn hơn số lượt
                    cả nghìn lần, chồng lên nhau thì cột "lượt" dẹp thành đường kẻ */}
                <div className="flex rounded-lg border border-line p-0.5">
                  {(
                    [
                      ["turns", "Lượt dùng"],
                      ["tokens", "Token"],
                    ] as const
                  ).map(([key, nhan]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setChiSo(key)}
                      className={`rounded-md px-3 py-1 text-[13px] font-medium transition-colors ${
                        chiSo === key ? "bg-zalo-50 text-zalo-700" : "text-ink-soft hover:text-ink"
                      }`}
                    >
                      {nhan}
                    </button>
                  ))}
                </div>
                <ChonKhoang giaTri={soNgay} onChange={setSoNgay} />
              </div>
            }
          >
            <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <TongKet nhan="Tổng lượt" giaTri={formatNumber(tongLuot)} mau="bg-zalo-500" />
              <TongKet nhan="Tổng token" giaTri={formatNumber(tongToken)} mau="bg-emerald-500" />
              <TongKet nhan="Trung bình/ngày" giaTri={formatNumber(trungBinhNgay)} mau="bg-violet-500" />
            </div>

            <UsageBarChart data={series} metric={chiSo} />

            <p className="mt-3 text-[12px] text-ink-soft">
              Đưa chuột lên từng cột để xem cả số lượt lẫn số token của ngày đó.
            </p>
          </SectionCard>
        </div>
      )}
    </div>
  );
}

/**
 * Chọn cửa sổ thời gian của biểu đồ. Dùng `<select>` thật thay vì tự dựng
 * dropdown: chỉ có 3 lựa chọn, và select gốc đã có sẵn bàn phím, đọc màn hình,
 * và cách hiển thị quen thuộc trên di động.
 *
 * Ba mốc khớp đúng `SO_NGAY_CHO_PHEP` ở server (`overview-routes.ts`) - server
 * kẹp lại giá trị lạ nên UI không thể xin một cửa sổ mà server không cho.
 */
function ChonKhoang({ giaTri, onChange }: { giaTri: number; onChange: (n: number) => void }) {
  return (
    <div className="relative">
      <IconClock
        size={15}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-soft"
      />
      <select
        value={giaTri}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Khoảng thời gian của biểu đồ"
        className="cursor-pointer rounded-lg border border-line bg-surface py-1.5 pl-8 pr-3 text-[13px] font-medium text-ink outline-none focus:border-zalo-500"
      >
        <option value={7}>7 ngày qua</option>
        <option value={14}>14 ngày qua</option>
        <option value={30}>30 ngày qua</option>
      </select>
    </div>
  );
}

/** Ô tổng kết nhỏ phía trên biểu đồ - chấm màu nối số với ý nghĩa của nó */
function TongKet({ nhan, giaTri, mau }: { nhan: string; giaTri: string; mau: string }) {
  return (
    <div className="gc-tile">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${mau}`} />
        <span className="text-[12px] text-ink-soft">{nhan}</span>
      </div>
      <div className="mt-1 text-[20px] font-semibold text-ink">{giaTri}</div>
    </div>
  );
}

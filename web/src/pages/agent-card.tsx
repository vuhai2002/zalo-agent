import { useState } from "react";
import type { ManagedAgent } from "../dashboard-api-client";
import { IconEye, IconEyeOff, IconPencil, IconTrash, IconUsers } from "../shared/dashboard-icons";
import { MenuHanhDong, MucMenu } from "../shared/menu-hanh-dong";
import { Badge } from "../shared/ui-bits";

/**
 * Một agent trong danh sách. Hai kiểu hiển thị dùng chung phần đầu (avatar +
 * tên + nhãn) để lưới và danh sách không trôi khỏi nhau về mặt nội dung.
 *
 * "Xem chi tiết" MỞ RỘNG TẠI CHỖ chứ không điều hướng: nếu nó cũng nhảy sang
 * `/agents/:id` thì nó với nút "Sửa" là hai nút làm đúng một việc. Mở tại chỗ
 * cho xem những thứ thẻ không đủ chỗ kể - model riêng, mức suy nghĩ, số công cụ
 * đã tắt - mà không phải rời trang.
 */

export function AgentCard({
  agent,
  providerChung,
  danhSach,
  onSua,
  onXoa,
}: {
  agent: ManagedAgent;
  /** Nhà cung cấp chung - để biết agent nào khai provider LỆCH */
  providerChung: string | null;
  /** true = kiểu danh sách (một hàng gọn), false = kiểu lưới (thẻ) */
  danhSach: boolean;
  onSua: () => void;
  onXoa: () => void;
}) {
  const [moRong, setMoRong] = useState(false);

  const menu = (
    <MenuHanhDong ariaLabel={`Hành động khác cho ${agent.name}`}>
      {(dong) => (
        <MucMenu
          icon={IconTrash}
          nguyHiem
          disabled={agent.isDefault}
          onClick={() => {
            dong();
            onXoa();
          }}
        >
          {agent.isDefault ? "Không xóa được agent mặc định" : "Xóa agent"}
        </MucMenu>
      )}
    </MenuHanhDong>
  );

  if (danhSach) {
    return (
      <div className="flex items-center gap-4 px-5 py-3.5">
        <Avatar icon={agent.icon} nho />
        <div className="min-w-0 flex-1">
          <TenVaNhan agent={agent} providerChung={providerChung} />
          <p className="truncate text-[12px] text-ink-soft">
            {agent.persona || "(chưa có persona - dùng giọng mặc định của bot)"}
          </p>
        </div>
        <span className="hidden shrink-0 text-[12px] text-ink-soft sm:block">{moTaAccount(agent)}</span>
        <button
          type="button"
          onClick={onSua}
          className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-tile"
        >
          Sửa
        </button>
        {menu}
      </div>
    );
  }

  return (
    <div className="gc-card flex flex-col p-5">
      <div className="flex items-start gap-4">
        <Avatar icon={agent.icon} />
        <div className="min-w-0 flex-1">
          <TenVaNhan agent={agent} providerChung={providerChung} />
          <div className="text-[12px] text-ink-soft/60">{agent.id}</div>
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-soft">
            {agent.persona || "(chưa có persona - dùng giọng mặc định của bot)"}
          </p>
        </div>
        {menu}
      </div>

      {moRong && <ChiTiet agent={agent} />}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line/70 pt-3">
        <span className="flex items-center gap-2 text-[12px] text-ink-soft">
          <IconUsers size={15} className="text-ink-soft/70" />
          {moTaAccount(agent)}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMoRong((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink-soft hover:bg-tile hover:text-ink"
          >
            {moRong ? <IconEyeOff size={15} /> : <IconEye size={15} />}
            {moRong ? "Thu gọn" : "Xem chi tiết"}
          </button>
          <button
            type="button"
            onClick={onSua}
            className="flex items-center gap-1.5 rounded-lg border border-zalo-200 bg-zalo-50 px-3 py-1.5 text-[13px] font-medium text-zalo-700 hover:bg-zalo-100 dark:border-zalo-800 dark:bg-zalo-950/50 dark:text-zalo-300 dark:hover:bg-zalo-950/80"
          >
            <IconPencil size={15} />
            Sửa
          </button>
        </div>
      </div>
    </div>
  );
}

function moTaAccount(a: ManagedAgent): string {
  return a.accountCount > 0 ? `${a.accountCount} account đang dùng` : "Chưa gắn account nào";
}

function Avatar({ icon, nho }: { icon: string; nho?: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-2xl bg-tile ${
        nho ? "h-10 w-10 text-[20px]" : "h-14 w-14 text-[28px]"
      }`}
    >
      {icon}
    </span>
  );
}

function TenVaNhan({
  agent,
  providerChung,
}: {
  agent: ManagedAgent;
  providerChung: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[15px] font-semibold text-ink">{agent.name}</span>
      {agent.isDefault && (
        <Badge tone="blue" dot={false}>
          Mặc định
        </Badge>
      )}
      {/* Override provider LỆCH bị `doiProviderAnToan` bỏ qua ở tầng dựng
          client, nên badge model ở đây là NÓI DỐI: bot đang chạy model chung
          chứ không phải model ghi trên badge. Trang chi tiết có cảnh báo, danh
          sách thì trước đó không. */}
      {agent.modelName &&
        (providerChung !== null &&
        agent.modelProvider !== null &&
        agent.modelProvider !== providerChung ? (
          <Badge tone="amber" dot={false}>
            {agent.modelName} - override bị bỏ qua
          </Badge>
        ) : (
          <Badge tone="gray" dot={false}>
            {agent.modelName}
          </Badge>
        ))}
    </div>
  );
}

/** Những thứ thẻ không đủ chỗ kể - chỉ hiện khi bấm "Xem chi tiết" */
function ChiTiet({ agent }: { agent: ManagedAgent }) {
  const dong: { nhan: string; giaTri: string }[] = [
    { nhan: "Model riêng", giaTri: agent.modelName || "theo trang Cấu hình" },
    { nhan: "Số bước tối đa", giaTri: agent.maxSteps === null ? "theo trang Cấu hình" : String(agent.maxSteps) },
    {
      nhan: "Trần token mỗi lần gọi",
      giaTri:
        agent.contextWindow === null
          ? "theo trang Cấu hình"
          : agent.contextWindow.toLocaleString("vi-VN"),
    },
    { nhan: "Mức suy nghĩ", giaTri: agent.reasoningEffort ?? "theo trang Cấu hình" },
    {
      nhan: "Công cụ đã tắt",
      giaTri: agent.disabledTools.length === 0 ? "không tắt cái nào" : agent.disabledTools.join(", "),
    },
  ];
  return (
    <dl className="mt-4 space-y-1.5 rounded-xl bg-tile/60 px-4 py-3">
      {dong.map((d) => (
        <div key={d.nhan} className="flex flex-wrap justify-between gap-x-4 text-[12px]">
          <dt className="text-ink-soft">{d.nhan}</dt>
          <dd className="min-w-0 text-right text-ink">{d.giaTri}</dd>
        </div>
      ))}
    </dl>
  );
}

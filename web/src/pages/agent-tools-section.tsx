import { useEffect, useState } from "react";
import type { ToolCatalogItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { AgentFormSection } from "./agent-form-field";

const NHAN_NHOM: Record<string, { title: string; hint: string }> = {
  read: { title: "Tra cứu", hint: "Chỉ đọc, không tác động ra ngoài" },
  action: { title: "Hành động", hint: "Gửi hoặc sửa thứ gì đó trên Zalo" },
};

/**
 * Nhóm "Công cụ" của trang sửa agent - lớp lọc tool thứ nhất.
 *
 * Điểm quan trọng nhất phải nói rõ ra màn hình: đây KHÔNG phải quyết định cuối
 * cùng. Tool bot thật sự dùng được là phần GIAO với công cụ đang bật của từng
 * tài khoản Zalo (công tắc per-account nằm ở trang **Tools**, không phải trang
 * Accounts). Agent khai năng lực, account áp chính sách;
 * không bên nào bật ngược lại được bên kia. Người dùng tick ở đây rồi tưởng bot
 * chắc chắn có tool đó là hiểu sai một nửa.
 *
 * Lưu danh sách TẮT (không phải BẬT) để tool mới thêm vào code tự có cho agent
 * cũ - cùng lý do với `accounts.disabled_tools`.
 */
export function AgentToolsSection({
  disabledTools,
  onChange,
}: {
  disabledTools: string[];
  onChange: (disabledTools: string[]) => void;
}) {
  const [tools, setTools] = useState<ToolCatalogItem[] | null>(null);
  const [loi, setLoi] = useState("");

  useEffect(() => {
    let huy = false;
    api
      .tools()
      .then((d) => !huy && setTools(d.items))
      // Tải hỏng mà chỉ set mảng rỗng thì màn hình hiện "0/0 công cụ" và đọc ra
      // "agent này không có công cụ nào" - sai hẳn nghĩa. Phải nói là chưa tải được.
      .catch((e: Error) => {
        if (huy) return;
        setTools([]);
        setLoi(e.message || "Không tải được danh sách công cụ");
      });
    return () => {
      huy = true;
    };
  }, []);

  const tat = new Set(disabledTools);

  function doiTool(key: string, bat: boolean) {
    const moi = new Set(tat);
    if (bat) moi.delete(key);
    else moi.add(key);
    onChange([...moi].sort());
  }

  if (tools === null) {
    return (
      <AgentFormSection title="Công cụ">
        <div className="py-5 first:pt-0 text-[13px] text-ink-soft">Đang tải danh sách công cụ...</div>
      </AgentFormSection>
    );
  }

  if (loi) {
    return (
      <AgentFormSection title="Công cụ">
        <div className="py-5 first:pt-0 text-[13px] text-red-600 dark:text-red-400">
          Chưa tải được danh sách công cụ: {loi}. Tải lại trang để thử lại - phần công cụ đang lưu của
          agent KHÔNG bị đụng tới.
        </div>
      </AgentFormSection>
    );
  }

  const soBat = tools.length - tools.filter((t) => tat.has(t.key)).length;

  return (
    <AgentFormSection
      title="Công cụ"
      hint={`Agent này được phép dùng ${soBat}/${tools.length} công cụ. Đây mới là NĂNG LỰC của agent - công cụ bot thật sự dùng được là phần giao với công cụ đang bật của từng tài khoản Zalo ở trang Tools.`}
    >
      {(["read", "action"] as const).map((nhom) => {
        const cua = tools.filter((t) => t.group === nhom);
        if (cua.length === 0) return null;
        return (
          <div key={nhom} className="py-5 first:pt-0">
            <div className="mb-1 text-[15px] font-semibold text-ink">{NHAN_NHOM[nhom]!.title}</div>
            <p className="mb-4 text-[13px] leading-[1.7] text-ink-soft">{NHAN_NHOM[nhom]!.hint}</p>
            <div className="space-y-3">
              {cua.map((t) => (
                <DongTool
                  key={t.key}
                  tool={t}
                  bat={!tat.has(t.key)}
                  onDoi={(bat) => doiTool(t.key, bat)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </AgentFormSection>
  );
}

function DongTool({
  tool,
  bat,
  onDoi,
}: {
  tool: ToolCatalogItem;
  bat: boolean;
  onDoi: (bat: boolean) => void;
}) {
  const id = `ag-tool-${tool.key}`;
  return (
    <div className="flex gap-3">
      <input
        id={id}
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-ink"
        checked={bat}
        onChange={(e) => onDoi(e.target.checked)}
      />
      <div className="min-w-0">
        <label htmlFor={id} className="flex cursor-pointer flex-wrap items-center gap-2 text-[14px] text-ink">
          {tool.label}
          <code className="rounded border border-line bg-tile px-1.5 py-0.5 font-mono text-[11px] text-ink-soft">
            {tool.key}
          </code>
          {/* Tool thiếu hạ tầng vẫn tick được: đây là khai báo năng lực, còn
              chuyện có chạy được hay không do `available()` quyết mỗi lượt.
              Nhưng phải nói ra, kẻo tick xong tưởng bot làm được ngay. */}
          {!tool.available && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              chưa cấu hình
            </span>
          )}
        </label>
        <p className="mt-0.5 max-w-2xl text-[12px] leading-[1.6] text-ink-soft">
          {tool.description}
          {!tool.available && tool.unavailableHint ? ` (${tool.unavailableHint})` : ""}
        </p>
      </div>
    </div>
  );
}

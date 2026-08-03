import { useEffect, useState } from "react";
import type { ToolCatalogItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { ToggleKnob } from "../shared/ui-bits";
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
 * không bên nào bật ngược lại được bên kia. Người dùng bật ở đây rồi tưởng bot
 * chắc chắn có tool đó là hiểu sai một nửa.
 *
 * Lưu danh sách TẮT (không phải BẬT) để tool mới thêm vào code tự có cho agent
 * cũ - cùng lý do với `accounts.disabled_tools`.
 */
export function AgentToolsSection({
  disabledTools,
  soTaiKhoan,
  onChange,
}: {
  disabledTools: string[];
  /** Số tài khoản Zalo đang gắn agent này - mỗi tài khoản còn một lớp tắt riêng */
  soTaiKhoan: number;
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
    // LỌC theo catalog vừa tải. Biên ghi của server dùng `z.enum(TOOL_KEYS)`
    // rất chặt, còn biên đọc thì fail-open không lọc - nên một key tool bị đổi
    // tên hay gỡ ở bản sau vẫn nằm lại trong DB, được gửi ngược lên, và MỌI lần
    // lưu trả 400. Lúc đó không có cách nào sửa trên giao diện: trang kẹt cứng.
    // Lọc ở đây vừa gỡ kẹt vừa dọn DB ngay lần lưu đầu tiên.
    const hopLe = new Set((tools ?? []).map((t) => t.key));
    onChange([...moi].filter((k) => hopLe.has(k)).sort());
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

  // Chỉ đếm tool CÓ HẠ TẦNG. `read_image` và `create_image` khi chưa cấu hình
  // sidecar/endpoint thì `available: false` - đếm chúng vào là hint khoe "13/13
  // công cụ" trong khi model không hề nhận được hai cái đó.
  const dungDuoc = tools.filter((t) => t.available !== false);
  const soBat = dungDuoc.filter((t) => !tat.has(t.key)).length;

  return (
    <AgentFormSection
      title="Công cụ"
      hint={
        `Agent này được phép dùng ${soBat}/${dungDuoc.length} công cụ đang có hạ tầng. Đây mới là NĂNG LỰC của agent - ` +
        `công cụ bot THẬT SỰ dùng được là phần GIAO với công cụ đang bật của từng tài khoản Zalo. ` +
        (soTaiKhoan > 0
          ? `Agent này đang gắn ${soTaiKhoan} tài khoản, mỗi tài khoản có lớp tắt riêng ở trang Tools - `
            + `bật ở đây không bảo đảm bot dùng được.`
          : `Chưa tài khoản nào gắn agent này nên công tắc ở đây chưa có tác dụng thực tế.`)
      }
    >
      {(["read", "action"] as const).map((nhom) => {
        const cua = tools.filter((t) => t.group === nhom);
        if (cua.length === 0) return null;
        return (
          <div key={nhom} className="py-4 first:pt-0">
            <div className="mb-0.5 text-[14px] font-medium text-ink">{NHAN_NHOM[nhom]!.title}</div>
            <p className="mb-2 text-[12px] leading-[1.6] text-ink-soft">{NHAN_NHOM[nhom]!.hint}</p>
            {/* Đường kẻ mảnh giữa các công cụ, y hệt trang Tools - đây là danh
                sách công tắc liền mạch chứ không phải các khối rời */}
            <div className="divide-y divide-line">
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
  // Bố cục và công tắc y hệt trang Tools: chữ trái, công tắc phải. Trước đây là
  // ô tick vuông - cùng một việc "bật/tắt công cụ" mà hai trang vẽ hai kiểu thì
  // đọc ra như hai tính năng khác nhau.
  return (
    <div className="flex w-full items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-medium text-ink">{tool.label}</span>
          <code className="rounded bg-tile px-1.5 py-0.5 text-[11px] text-ink-soft">{tool.key}</code>
          {/* Tool thiếu hạ tầng vẫn bật được: đây là khai báo năng lực, còn
              chuyện có chạy được hay không do `available()` quyết mỗi lượt.
              Nhưng phải nói ra, kẻo bật xong tưởng bot làm được ngay. */}
          {!tool.available && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              chưa cấu hình
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[12px] leading-[1.6] text-ink-soft">
          {tool.description}
          {!tool.available && tool.unavailableHint ? ` (${tool.unavailableHint})` : ""}
        </p>
      </div>

      <button
        id={id}
        type="button"
        aria-label={`Bật tắt ${tool.label}`}
        aria-pressed={bat}
        onClick={() => onDoi(!bat)}
        className="shrink-0"
      >
        <ToggleKnob on={bat} />
      </button>
    </div>
  );
}

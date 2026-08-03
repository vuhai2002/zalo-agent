import { useEffect, useState } from "react";
import type { LogEntry } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { DongLog } from "./log-row";
import { IconDatabase } from "../shared/dashboard-icons";
import { SelectMenu } from "../shared/select-menu";

/**
 * Log toàn hệ thống, đọc từ file `data/logs/bot.<ngày>.log`.
 *
 * Khác trang Trace: Trace chỉ có lượt agent, còn đây là MỌI thứ - kết nối Zalo,
 * login QR, định tuyến tin, lỗi của 30 scope trong hệ thống.
 *
 * File ghi cả mức debug bất kể LOG_LEVEL của terminal, nên xem ở đây luôn đầy
 * đủ hơn nhìn terminal.
 */

/**
 * Số dòng mỗi trang. Nhỏ hơn trần 500 của server để lần bấm "Xem thêm" phản hồi
 * nhanh - đọc log là việc dò tìm, người dùng bấm nhiều lần chứ không ngồi đợi
 * một cục lớn.
 */
const MOI_TRANG = 150;

const MUC_LOC = [
  { value: "", label: "Mọi mức" },
  { value: "debug", label: "Debug trở lên" },
  { value: "info", label: "Info trở lên" },
  { value: "warn", label: "Warn trở lên" },
  { value: "error", label: "Chỉ Error" },
];

export function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [tat, setTat] = useState(false);
  const [goiY, setGoiY] = useState("");
  const [level, setLevel] = useState("");
  const [scope, setScope] = useState("");
  const [search, setSearch] = useState("");
  const [dangTai, setDangTai] = useState(true);
  const [loi, setLoi] = useState("");
  /** Con trỏ trang sau; `null` = đã hết log, ẩn nút "Xem thêm" */
  const [conTro, setConTro] = useState<string | null>(null);
  const [dangTaiThem, setDangTaiThem] = useState(false);

  /**
   * `before` rỗng = tải lại từ đầu (đổi bộ lọc, bấm Làm mới); có `before` =
   * NỐI THÊM trang cũ hơn. Gộp một hàm để hai đường không trôi khỏi nhau.
   */
  async function nap(before?: string) {
    const noiThem = Boolean(before);
    if (noiThem) setDangTaiThem(true);
    else setDangTai(true);
    setLoi("");
    try {
      const r = await api.logs({ level, scope, search, limit: MOI_TRANG, before });
      setEntries((cu) => (noiThem ? [...cu, ...r.entries] : r.entries));
      // Danh sách scope chỉ nạp khi CHƯA lọc, không thì lọc xong ô chọn rỗng dần
      if (!noiThem && !scope && !search) setScopes(r.scopes);
      setConTro(r.nextCursor);
      setTat(r.disabled);
      setGoiY(r.hint ?? "");
    } catch (e) {
      setLoi(e instanceof Error ? e.message : String(e));
    } finally {
      setDangTai(false);
      setDangTaiThem(false);
    }
  }

  useEffect(() => {
    void nap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, scope]);

  return (
    <>
      <PageHeader
        icon={IconDatabase}
        title="Logs"
        subtitle="Log toàn hệ thống đọc từ file. File ghi cả mức debug nên đầy đủ hơn nhìn terminal."
      />

      {tat && (
        <div className="mb-4 rounded-xl border border-amber-100 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 px-4 py-2.5 text-[13px] text-amber-800 dark:text-amber-200">
          {goiY || "Ghi log ra file đang tắt"}
        </div>
      )}
      {loi && (
        <div className="mb-4 rounded-xl border border-red-100 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-[13px] text-red-700 dark:text-red-300">
          {loi}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="min-w-[150px]">
          <SelectMenu value={level} onChange={setLevel} options={MUC_LOC} ariaLabel="Lọc theo mức" />
        </div>
        <div className="min-w-[170px]">
          <SelectMenu
            value={scope}
            onChange={setScope}
            options={[
              { value: "", label: "Mọi scope" },
              ...scopes.map((s) => ({ value: s, label: s })),
            ]}
            ariaLabel="Lọc theo scope"
          />
        </div>
        <input
          className="gc-input min-w-[200px] flex-1"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void nap()}
          placeholder="Tìm trong log rồi Enter..."
        />
        <button
          type="button"
          onClick={() => void nap()}
          disabled={dangTai}
          className="rounded-lg border border-line bg-surface px-4 py-2 text-[13px] font-medium text-ink hover:bg-tile disabled:opacity-50"
        >
          {dangTai ? "Đang tải..." : "Tải lại"}
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {entries.map((e, i) => (
          <DongLog key={i} e={e} />
        ))}
        {entries.length === 0 && !dangTai && !tat && (
          <p className="py-10 text-center text-[13px] text-ink-soft/60">
            Không có dòng log nào khớp.
          </p>
        )}
      </div>

      {/* Chỉ hiện khi server nói còn log phía sau. Không dùng cuộn-vô-tận: đọc
          log là việc dò tìm, tự nạp thêm lúc người dùng đang đọc làm trang nhảy
          mất chỗ vừa nhìn. */}
      {conTro && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => void nap(conTro)}
            disabled={dangTaiThem}
            className="rounded-lg border border-line bg-surface px-4 py-2 text-[13px] font-medium text-ink hover:bg-tile disabled:opacity-50"
          >
            {dangTaiThem ? "Đang tải..." : `Xem thêm ${MOI_TRANG} dòng cũ hơn`}
          </button>
        </div>
      )}

      {!conTro && entries.length > 0 && (
        <p className="mt-4 text-center text-[12px] text-ink-soft/60">
          Đã hết log lưu lại. Log cũ hơn bị xoay vòng theo LOG_FILE_KEEP_DAYS.
        </p>
      )}
    </>
  );
}

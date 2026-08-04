import type { ManagedAgent } from "../dashboard-api-client";
import { IconBot, IconGrid, IconList, IconSearch, IconUsers } from "../shared/dashboard-icons";
import { SelectMenu } from "../shared/select-menu";

/**
 * Dải số liệu + thanh công cụ của trang Agents.
 *
 * Tách khỏi `agents-page.tsx` để file kia còn đúng phần nạp dữ liệu và ghép
 * mảnh.
 */

export type KieuSapXep = "mac-dinh" | "ten" | "nhieu-account";
export type KieuXem = "luoi" | "danh-sach";

const SAP_XEP: { value: KieuSapXep; label: string }[] = [
  // KHÔNG có "Mới nhất" dù bản phác có: API không trả `createdAt` (xem
  // `ManagedAgent`), nên nhãn đó sẽ nói dối - nó chỉ sắp theo id. Ba lựa chọn
  // dưới đây đều tính được từ dữ liệu đang có.
  { value: "mac-dinh", label: "Mặc định trước" },
  { value: "ten", label: "Tên A-Z" },
  { value: "nhieu-account", label: "Nhiều account" },
];

export function sapXepAgent(ds: ManagedAgent[], kieu: KieuSapXep): ManagedAgent[] {
  const ra = [...ds];
  if (kieu === "ten") return ra.sort((a, b) => a.name.localeCompare(b.name, "vi"));
  if (kieu === "nhieu-account") {
    // Bằng nhau thì xếp theo tên - không có nhánh này thì hai agent cùng 0
    // account đổi chỗ nhau mỗi lần render, nhìn như trang tự nhảy
    return ra.sort((a, b) => b.accountCount - a.accountCount || a.name.localeCompare(b.name, "vi"));
  }
  return ra.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.id.localeCompare(b.id));
}

export function locAgent(ds: ManagedAgent[], tuKhoa: string): ManagedAgent[] {
  const q = tuKhoa.trim().toLowerCase();
  if (!q) return ds;
  return ds.filter((a) =>
    `${a.name} ${a.id} ${a.persona}`.toLowerCase().includes(q),
  );
}

export function DaiSoLieu({ soAgent, soAccount }: { soAgent: number; soAccount: number }) {
  return (
    <div className="mb-5 grid grid-cols-1 divide-y divide-line rounded-2xl border border-line bg-surface sm:grid-cols-2 sm:divide-x sm:divide-y-0">
      <O icon={IconBot} nhan="Tổng số agent" so={soAgent} mau="bg-zalo-50 text-zalo-600 dark:bg-zalo-950/50 dark:text-zalo-300" />
      <O
        icon={IconUsers}
        nhan="Tổng account đang dùng"
        so={soAccount}
        mau="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300"
      />
    </div>
  );
}

function O({
  icon: Icon,
  nhan,
  so,
  mau,
}: {
  icon: (p: { size?: number }) => React.ReactNode;
  nhan: string;
  so: number;
  mau: string;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${mau}`}>
        <Icon size={20} />
      </span>
      <div className="min-w-0">
        <div className="text-[13px] text-ink-soft">{nhan}</div>
        <div className="text-[20px] font-semibold text-ink">{so}</div>
      </div>
    </div>
  );
}

export function ThanhCongCu({
  tim,
  onTim,
  sapXep,
  onSapXep,
  kieuXem,
  onKieuXem,
}: {
  tim: string;
  onTim: (v: string) => void;
  sapXep: KieuSapXep;
  onSapXep: (v: KieuSapXep) => void;
  kieuXem: KieuXem;
  onKieuXem: (v: KieuXem) => void;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {/* Ô tìm KHÔNG kéo hết bề ngang: từ vài agent trở lên vẫn chỉ gõ vài chữ,
          ô dài 1,5 mét chỉ làm hai control bên phải trôi ra tận mép */}
      <div className="relative min-w-0 flex-1 sm:max-w-md">
        <IconSearch
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft/60"
        />
        <input
          type="search"
          className="gc-input w-full pl-9"
          placeholder="Tìm agent..."
          value={tim}
          onChange={(e) => onTim(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 sm:w-56 sm:flex-none">
          <SelectMenu
            size="md"
            prefix="Sắp xếp:"
            ariaLabel="Sắp xếp danh sách agent"
            value={sapXep}
            options={SAP_XEP}
            onChange={(v) => onSapXep(v as KieuSapXep)}
          />
        </div>

        {/* `h-10` khớp đúng chiều cao `.gc-input` của ô tìm bên trái - hai nút
            bên trong cao hết khung để icon nhìn đầy đặn chứ không lọt thỏm */}
        <div className="flex h-10 shrink-0 items-center gap-1 rounded-lg border border-line bg-surface p-1">
          <NutKieuXem dang="luoi" hienTai={kieuXem} onChon={onKieuXem} icon={IconGrid} nhan="Xem dạng lưới" />
          <NutKieuXem dang="danh-sach" hienTai={kieuXem} onChon={onKieuXem} icon={IconList} nhan="Xem dạng danh sách" />
        </div>
      </div>
    </div>
  );
}

function NutKieuXem({
  dang,
  hienTai,
  onChon,
  icon: Icon,
  nhan,
}: {
  dang: KieuXem;
  hienTai: KieuXem;
  onChon: (v: KieuXem) => void;
  icon: (p: { size?: number }) => React.ReactNode;
  nhan: string;
}) {
  const dangChon = dang === hienTai;
  return (
    <button
      type="button"
      aria-label={nhan}
      aria-pressed={dangChon}
      title={nhan}
      onClick={() => onChon(dang)}
      className={`flex h-full w-9 items-center justify-center rounded-md transition-colors ${
        dangChon ? "bg-zalo-50 text-zalo-600 dark:bg-zalo-950/50 dark:text-zalo-300" : "text-ink-soft hover:bg-tile hover:text-ink"
      }`}
    >
      <Icon size={20} />
    </button>
  );
}

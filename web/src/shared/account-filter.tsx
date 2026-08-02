import type { AccountInfo } from "../dashboard-api-client";
import { SelectMenu } from "./select-menu";

/**
 * Bộ lọc account dùng chung cho các trang dữ liệu (Sessions/Contacts/Memory).
 * value rỗng = tất cả account. Chỉ hiện khi có từ 2 account trở lên -
 * 1 account thì lọc là thừa.
 */
export function AccountFilter({
  accounts,
  value,
  onChange,
}: {
  accounts: AccountInfo[];
  value: string;
  onChange: (accountId: string) => void;
}) {
  if (accounts.length < 2) return null;

  return (
    <SelectMenu
      value={value}
      onChange={onChange}
      ariaLabel="Lọc theo account"
      options={[
        { value: "", label: "Tất cả account" },
        ...accounts.map((a) => ({
          value: a.id,
          label: a.label,
          dotClass: a.online ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600",
        })),
      ]}
    />
  );
}

/** Tên hiển thị của account theo id - fallback về id khi account đã bị xóa */
export function accountLabel(accounts: AccountInfo[], id: string): string {
  return accounts.find((a) => a.id === id)?.label ?? id;
}

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Đọc config/accounts.json làm SEED cho lần chạy đầu - DB (bảng accounts/agents)
 * mới là source of truth, quản lý qua dashboard. File này chỉ còn dùng khi
 * bảng accounts trống (nâng cấp từ bản cũ hoặc cài mới muốn khai báo sẵn).
 */

const accountSeedSchema = z.object({
  // id dùng làm tên thư mục data + key SQLite - giữ kebab-case
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id phải là kebab-case (a-z, 0-9, dấu gạch ngang)"),
  label: z.string().min(1),
  enabled: z.boolean().default(true),
  // Bản cũ để persona trong account - migration sẽ tách thành agent riêng
  persona: z.string().default(""),
  allowlist: z
    .object({
      mode: z.enum(["all", "list"]).default("all"),
      userIds: z.array(z.string()).default([]),
    })
    .default({ mode: "all", userIds: [] }),
  groupRequireMention: z.boolean().default(true),
  respondToGroups: z.boolean().default(true),
  groupPassiveListen: z.boolean().default(true),
});

const accountsFileSchema = z.object({
  accounts: z.array(accountSeedSchema).min(1),
});

export type AccountSeed = z.infer<typeof accountSeedSchema>;

/** null = không có file seed (cài mới hoàn toàn) - không phải lỗi */
export function readAccountsSeedFile(
  configPath = path.resolve("config/accounts.json"),
): AccountSeed[] | null {
  if (!fs.existsSync(configPath)) return null;

  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const parsed = accountsFileSchema.parse(raw);

  const ids = parsed.accounts.map((a) => a.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("config/accounts.json: có account id bị trùng");
  }
  return parsed.accounts;
}

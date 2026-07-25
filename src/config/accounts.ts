import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const accountSchema = z.object({
  // id dùng làm tên thư mục data + key SQLite - giữ kebab-case
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id phải là kebab-case (a-z, 0-9, dấu gạch ngang)"),
  label: z.string().min(1),
  enabled: z.boolean().default(true),
  // Persona riêng cho account này; rỗng thì dùng persona mặc định
  persona: z.string().default(""),
  allowlist: z
    .object({
      mode: z.enum(["all", "list"]).default("all"),
      userIds: z.array(z.string()).default([]),
    })
    .default({ mode: "all", userIds: [] }),
  groupRequireMention: z.boolean().default(true),
  respondToGroups: z.boolean().default(true),
  // Tin group không @mention vẫn ghi vào history (không gọi LLM, không trả lời)
  // để lần được mention sau agent nắm được ngữ cảnh hội thoại xung quanh
  groupPassiveListen: z.boolean().default(true),
});

const accountsFileSchema = z.object({
  accounts: z.array(accountSchema).min(1),
});

export type AccountConfig = z.infer<typeof accountSchema>;

export function loadAccounts(
  configPath = path.resolve("config/accounts.json"),
): AccountConfig[] {
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Không tìm thấy ${configPath} - copy từ config/accounts.example.json rồi chỉnh lại`,
    );
  }

  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const parsed = accountsFileSchema.parse(raw);

  const ids = parsed.accounts.map((a) => a.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("config/accounts.json: có account id bị trùng");
  }

  return parsed.accounts;
}

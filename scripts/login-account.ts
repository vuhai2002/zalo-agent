// Đăng nhập 1 account Zalo bằng QR và lưu credentials (mã hóa) cho các lần sau.
// Cách dùng: pnpm zalo-login <account-id>   (kebab-case, trùng id trong config/accounts.json)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../src/config/env.js";
import { loginWithQR } from "../src/zalo/zalo-client.js";

const accountId = process.argv[2];

if (!accountId || !/^[a-z0-9][a-z0-9-]*$/.test(accountId)) {
  console.error("Cách dùng: pnpm zalo-login <account-id>  (kebab-case, vd: acc-chinh)");
  process.exit(1);
}

const accountDir = path.join(dataDir, "accounts", accountId);
fs.mkdirSync(accountDir, { recursive: true });
const qrPath = path.join(accountDir, "qr-login.png");

// Mở ảnh QR bằng viewer mặc định của hệ điều hành
function openImage(filePath: string): void {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", filePath]]
      : process.platform === "darwin"
        ? ["open", [filePath]]
        : ["xdg-open", [filePath]];
  try {
    spawn(command, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* không mở được thì user tự mở theo đường dẫn đã in */
  }
}

console.log(`\nĐăng nhập account "${accountId}"`);
console.log("Chờ tạo mã QR, ảnh sẽ tự mở. Quét bằng app Zalo trên điện thoại.\n");

try {
  const api = await loginWithQR(accountId, qrPath, (savedPath) => {
    console.log(`Mã QR: ${savedPath}`);
    openImage(savedPath);
  });

  const info = await api.fetchAccountInfo();
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const displayName = (info as any)?.profile?.displayName ?? "(không rõ tên)";
  console.log(`\nĐăng nhập thành công: ${displayName}`);
  console.log(`Credentials đã lưu (mã hóa) tại data/accounts/${accountId}/credentials.enc`);
  console.log(`Thêm account "${accountId}" trên dashboard (trang Accounts) rồi bật lên là chạy.`);
  console.log("(Hoặc đơn giản hơn: làm mọi thứ ngay trên dashboard, có nút login QR.)");

  fs.rmSync(qrPath, { force: true }); // QR đã dùng xong, xóa cho sạch
  process.exit(0);
} catch (err) {
  console.error("\nĐăng nhập thất bại:", err instanceof Error ? err.message : err);
  process.exit(1);
}

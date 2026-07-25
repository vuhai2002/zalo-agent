import { spawnSync } from "node:child_process";

/**
 * Console Windows mặc định dùng code page cũ (437/1258) nên log tiếng Việt bị vỡ
 * ("Sß kißçn" thay vì "Sự kiện"). Chuyển console sang UTF-8 (code page 65001).
 * No-op trên Linux/macOS - các hệ này đã UTF-8 sẵn.
 */
export function ensureUtf8Console(): void {
  if (process.platform !== "win32") return;
  try {
    // chcp tác động lên console đang gắn với process, dùng chung với process cha
    spawnSync("chcp.com", ["65001"], { stdio: "ignore" });
  } catch {
    /* không đổi được thì log vẫn chạy, chỉ hiển thị sai dấu */
  }
}

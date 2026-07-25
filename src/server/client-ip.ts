import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { env } from "../config/env.js";

/**
 * IP của client, dùng làm khóa rate-limit login.
 *
 * Vì sao không đọc thẳng X-Forwarded-For: header đó do client gửi được. Đổi giá
 * trị mỗi request là mỗi lần có một bucket rate-limit mới -> brute-force password
 * không giới hạn. Nên khi không cấu hình proxy thì chỉ tin địa chỉ socket.
 *
 * Khi có proxy (DASHBOARD_BEHIND_PROXY=true): Caddy/Nginx APPEND IP client vào
 * cuối XFF sẵn có, nên entry PHẢI NHẤT mới là IP do proxy ghi; các entry bên
 * trái là do client tự bịa. Lấy entry trái nhất - cách hay gặp nhất - chính là
 * lỗ hổng.
 */
export function resolveClientIp(c: Context): string {
  if (env.DASHBOARD_BEHIND_PROXY) {
    const trusted = rightmostForwardedFor(c.req.header("x-forwarded-for"));
    if (trusted) return trusted;
  }
  return socketAddress(c) ?? "unknown";
}

/** Tách riêng để test được không cần Context */
export function rightmostForwardedFor(header: string | undefined): string | undefined {
  const entries =
    header
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? [];
  return entries[entries.length - 1];
}

function socketAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    // app.request() trong unit test không có socket thật
    return undefined;
  }
}

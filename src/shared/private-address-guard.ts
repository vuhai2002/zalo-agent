import net from "node:net";

/**
 * Phân loại địa chỉ IP "public" (được phép tải) vs "nội bộ" (phải chặn).
 *
 * Vì sao cần: tool `send_file` nhận URL do LLM quyết, mà LLM đọc tin nhắn của
 * người lạ. Một tin soạn khéo (prompt injection) có thể bảo bot tải
 * `http://127.0.0.1:3900/api/...` hay endpoint metadata của cloud
 * (`169.254.169.254`) rồi gửi nội dung ra chat. Chỉ cho phép IP public là cách
 * chặn cả họ lỗi này thay vì đi vá từng URL.
 */

type Cidr4 = { base: number; mask: number };

/** Dải IPv4 không bao giờ được tải: nội bộ, loopback, metadata, tài liệu, multicast */
const BLOCKED_V4_CIDRS = [
  "0.0.0.0/8", // this-network
  "10.0.0.0/8", // private (RFC1918)
  "100.64.0.0/10", // CGNAT
  "127.0.0.0/8", // loopback
  "169.254.0.0/16", // link-local - metadata cloud (AWS/GCP/Azure)
  "172.16.0.0/12", // private (RFC1918)
  "192.0.0.0/24", // IETF protocol assignments
  "192.0.2.0/24", // documentation
  "192.168.0.0/16", // private (RFC1918)
  "198.18.0.0/15", // benchmarking
  "198.51.100.0/24", // documentation
  "203.0.113.0/24", // documentation
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved + broadcast 255.255.255.255
] as const;

const BLOCKED_V4: Cidr4[] = BLOCKED_V4_CIDRS.map((cidr) => {
  const [ip, bits] = cidr.split("/");
  const prefix = Number(bits);
  // `>>> 0` ở CẢ mask và base: toán tử bit của JS trả int32 có dấu, thiếu bước này
  // thì mọi dải có bit cao bật (172.16/12, 192.168/16, 169.254/16) ra số âm và
  // không bao giờ khớp với giá trị unsigned bên isPublicV4 -> guard lọt âm thầm.
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { base: ((ipv4ToInt(ip!) ?? 0) & mask) >>> 0, mask };
});

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

/** Bung IPv6 (kể cả dạng rút gọn "::" và dạng lai "::ffff:1.2.3.4") thành 16 byte */
function ipv6ToBytes(address: string): Uint8Array | null {
  let text = address.split("%")[0]!; // bỏ zone index kiểu fe80::1%eth0
  let trailingV4: number[] = [];

  // Dạng lai có phần IPv4 ở cuối: tách 4 byte cuối, thay bằng 2 group giữ chỗ
  if (text.includes(".")) {
    const colon = text.lastIndexOf(":");
    if (colon < 0) return null;
    const value = ipv4ToInt(text.slice(colon + 1));
    if (value === null) return null;
    trailingV4 = [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    text = `${text.slice(0, colon)}:0:0`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const toGroups = (part: string | undefined) => (part ? part.split(":") : []);
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  if (halves.length === 1 && missing !== 0) return null; // không rút gọn thì phải đủ 8 group

  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes.push(value >> 8, value & 255);
  }
  if (bytes.length !== 16) return null;

  if (trailingV4.length === 4) bytes.splice(12, 4, ...trailingV4);
  return Uint8Array.from(bytes);
}

const startsWithBytes = (bytes: Uint8Array, prefix: number[]): boolean =>
  prefix.every((value, index) => bytes[index] === value);

function isPublicV6(address: string): boolean {
  const bytes = ipv6ToBytes(address);
  if (!bytes) return false;

  // IPv4-mapped (::ffff:0:0/96) và NAT64 (64:ff9b::/96): xét theo IPv4 bên trong,
  // nếu không thì "::ffff:127.0.0.1" lọt qua mọi luật IPv6 bên dưới
  const mappedV4 = startsWithBytes(bytes, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff]);
  const nat64 = startsWithBytes(bytes, [0, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0]);
  if (mappedV4 || nat64) {
    return isPublicV4([...bytes.slice(12)].join("."));
  }

  if (bytes.every((b) => b === 0)) return false; // :: unspecified
  if (startsWithBytes(bytes, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])) return false; // ::1
  if ((bytes[0]! & 0xfe) === 0xfc) return false; // fc00::/7 unique-local
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return false; // fe80::/10 link-local
  if (bytes[0] === 0xff) return false; // ff00::/8 multicast
  if (startsWithBytes(bytes, [0x20, 0x01, 0x0d, 0xb8])) return false; // 2001:db8::/32 documentation
  if (startsWithBytes(bytes, [0x01, 0, 0, 0, 0, 0, 0, 0])) return false; // 100::/64 discard

  return true;
}

function isPublicV4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === null) return false;
  return !BLOCKED_V4.some(({ base, mask }) => ((value & mask) >>> 0) === base);
}

/** true = IP public, tải được. Không phải IP hợp lệ cũng trả false (không tin). */
export function isPublicAddress(address: string): boolean {
  if (net.isIPv4(address)) return isPublicV4(address);
  if (net.isIPv6(address)) return isPublicV6(address);
  return false;
}

/**
 * Bỏ ngoặc vuông của IPv6 trong URL: `new URL("http://[::1]/").hostname` trả về
 * "[::1]", để nguyên thì net.isIP không nhận ra là IP và guard bị lọt.
 */
export function hostnameToAddress(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

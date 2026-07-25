/**
 * Giải mã HTML entity về ký tự thật. Trang tiếng Việt (minhngoc, xoso...) trộn
 * entity SỐ (&#225; = á) với entity TÊN (&Ecirc; = Ê, &agrave; = à) - chỉ decode
 * số thì text ra "CHUY&Ecirc;N TRANG" thay vì "CHUYÊN TRANG", model đọc rất khổ.
 */

/** Entity tên -> ký tự. Chữ Latin-1 chỉ cần bản thường - bản hoa suy ra tự động. */
const NAMED_ENTITIES: Record<string, string> = {
  // Ký hiệu hay gặp
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "...",
  ndash: "-",
  mdash: "-",
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
  laquo: "<<",
  raquo: ">>",
  middot: "-",
  bull: "-",
  trade: "(TM)",
  copy: "(c)",
  reg: "(R)",
  deg: "°",
  // Chữ Latin-1 có dấu (bản thường; "Ecirc" tự tra "ecirc" rồi viết hoa kết quả)
  agrave: "à",
  aacute: "á",
  acirc: "â",
  atilde: "ã",
  auml: "ä",
  aring: "å",
  aelig: "æ",
  ccedil: "ç",
  egrave: "è",
  eacute: "é",
  ecirc: "ê",
  euml: "ë",
  igrave: "ì",
  iacute: "í",
  icirc: "î",
  iuml: "ï",
  eth: "ð",
  ntilde: "ñ",
  ograve: "ò",
  oacute: "ó",
  ocirc: "ô",
  otilde: "õ",
  ouml: "ö",
  oslash: "ø",
  ugrave: "ù",
  uacute: "ú",
  ucirc: "û",
  uuml: "ü",
  yacute: "ý",
  thorn: "þ",
  yuml: "ÿ",
  szlig: "ß",
};

function decodeNamed(name: string): string | null {
  const direct = NAMED_ENTITIES[name];
  if (direct !== undefined) return direct;
  // "Ecirc" / "ECIRC" -> tra "ecirc" rồi viết hoa: khỏi liệt kê gấp đôi bảng
  const lower = NAMED_ENTITIES[name.toLowerCase()];
  if (lower !== undefined && /^[A-Z]/.test(name)) return lower.toUpperCase();
  return null;
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (m, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    })
    .replace(/&#(\d+);/g, (m, dec: string) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    })
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => decodeNamed(name) ?? m);
}

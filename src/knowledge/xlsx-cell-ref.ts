import type { SaxesTagNS } from "saxes";

/** Giá trị thuộc tính theo local name (bỏ qua namespace) của một thẻ SAX */
export function giaTriThuocTinh(tag: SaxesTagNS, localName: string): string | undefined {
  for (const key in tag.attributes) {
    if (tag.attributes[key]?.local === localName) return tag.attributes[key]!.value;
  }
  return undefined;
}

/** "B" -> 2, "AA" -> 27 (chỉ số cột 1-based, kiểu Excel). */
export function chuCotThanhChiSo(chuCai: string): number {
  let idx = 0;
  for (const c of chuCai) idx = idx * 26 + (c.charCodeAt(0) - 64); // 'A' = 65
  return idx;
}

/** 3 -> "C", 27 -> "AA" - ngược của `chuCotThanhChiSo` */
export function chiSoThanhChuCot(chiSo: number): string {
  let s = "";
  for (let n = chiSo; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

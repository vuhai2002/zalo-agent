/**
 * Đọc header + bảng FAT của tệp CFB (OLE) với kiểm ĐẦY ĐỦ, phục vụ
 * `kiem-cau-truc-cfb.ts`. Module thuần, không cấp phát theo con số đọc từ tệp:
 * mọi mảng đều có cỡ theo SỐ SECTOR THẬT của tệp.
 *
 * Bất biến chống khuếch đại: mỗi sector chỉ được thuộc về ĐÚNG MỘT chuỗi trong
 * cả tệp (`daDung` dùng chung cho FAT, DIFAT, thư mục, mọi stream). Bắt được
 * cùng lúc vòng A->B->A, hai chuỗi chung đuôi, và hai entry chung sector đầu -
 * đúng ba hình dạng đã đo làm `word-extractor`/`cfb` lặp vô hạn hoặc phình bậc hai.
 */

export const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const MAGIC = Buffer.from("d0cf11e0a1b11ae1", "hex");

export class LoiCfb extends Error {}

export type BangSectorCfb = {
  buf: Buffer;
  secSize: number;
  soSector: number;
  /** v4 khai cỡ stream 64-bit, v3 chỉ 32 bit thấp có nghĩa */
  phienBan: 3 | 4;
  dirDau: number;
  miniFatDau: number;
  soMiniFat: number;
  /** Duyệt một chuỗi theo FAT, đánh dấu sector đã dùng; vi phạm thì ném LoiCfb */
  docChuoi(dau: number, viec: string): number[];
  offsetSector(s: number): number;
};

export function docBangSectorCfb(buf: Buffer): BangSectorCfb {
  if (buf.length < 512 || !buf.subarray(0, 8).equals(MAGIC)) throw new LoiCfb("không phải tệp OLE");
  const u32 = (o: number) => (o + 4 <= buf.length ? buf.readUInt32LE(o) : FREESECT);
  const major = buf.readUInt16LE(26);
  const shift = buf.readUInt16LE(30);
  if (buf.readUInt16LE(28) !== 0xfffe) throw new LoiCfb("thứ tự byte bất thường");
  if (!((major === 3 && shift === 9) || (major === 4 && shift === 12))) throw new LoiCfb("cỡ sector bất thường");
  if (buf.readUInt16LE(32) !== 6 || u32(56) !== 4096) throw new LoiCfb("cấu hình mini stream bất thường");

  const secSize = 1 << shift;
  const soSector = Math.ceil((buf.length - secSize) / secSize);
  if (soSector <= 0) throw new LoiCfb("tệp không có sector nào");
  const soFat = u32(44);
  const soMiniFat = u32(64);
  const soDifat = u32(72);
  if (soFat === 0 || soFat > soSector || soMiniFat > soSector || soDifat > soSector) {
    throw new LoiCfb("số bảng phân bổ khai vượt cỡ tệp");
  }

  const offsetSector = (s: number) => (s + 1) * secSize;
  const daDung = new Uint8Array(soSector);
  const danhDau = (s: number, viec: string) => {
    if (s >= soSector) throw new LoiCfb(`${viec}: sector ngoài tệp`);
    if (daDung[s]) throw new LoiCfb(`${viec}: sector bị dùng hai lần`);
    daDung[s] = 1;
  };

  // DIFAT: 109 ô trong header, phần còn lại theo chuỗi sector DIFAT
  const secFat: number[] = [];
  for (let i = 0; i < Math.min(soFat, 109); i++) {
    const s = u32(76 + 4 * i);
    danhDau(s, "bảng FAT");
    secFat.push(s);
  }
  let d = u32(68);
  for (let soDaDoc = 0; secFat.length < soFat; soDaDoc++) {
    if (soDaDoc >= soDifat) throw new LoiCfb("thiếu sector DIFAT");
    danhDau(d, "DIFAT");
    const off = offsetSector(d);
    for (let j = 0; j < secSize / 4 - 1 && secFat.length < soFat; j++) {
      const s = u32(off + 4 * j);
      danhDau(s, "bảng FAT");
      secFat.push(s);
    }
    d = u32(off + secSize - 4);
  }

  const fat = new Uint32Array(soSector).fill(FREESECT);
  const moiSec = secSize / 4;
  secFat.forEach((s, k) => {
    for (let j = 0; j < moiSec && k * moiSec + j < soSector; j++) fat[k * moiSec + j] = u32(offsetSector(s) + 4 * j);
  });

  const docChuoi = (dau: number, viec: string): number[] => {
    const chuoi: number[] = [];
    for (let s = dau; s !== ENDOFCHAIN; s = fat[s]!) {
      danhDau(s, viec); // s ngoài tệp (FREESECT, FATSECT...) cũng bị chặn ở đây
      chuoi.push(s);
    }
    return chuoi;
  };

  return {
    buf,
    secSize,
    soSector,
    phienBan: major === 4 ? 4 : 3,
    dirDau: u32(48),
    miniFatDau: u32(60),
    soMiniFat,
    docChuoi,
    offsetSector,
  };
}

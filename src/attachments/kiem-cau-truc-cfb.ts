import { docBangSectorCfb, ENDOFCHAIN, LoiCfb, type BangSectorCfb } from "./cfb-bang-sector.js";

/**
 * Kiểm cấu trúc tệp CFB (OLE - định dạng .doc 97-2003, và vỏ của Office có
 * mật khẩu) TRƯỚC khi đưa cho `word-extractor`.
 *
 * Vì sao bắt buộc: `word-extractor` 1.0.4 tin mọi con số trong tệp. Đo bằng
 * PoC: cỡ sector lấy thẳng từ header (shift 27 = sector 128 MB) làm V8 abort
 * cả tiến trình; chuỗi sector vòng A->B->A lặp vô hạn trong khi mảng cứ lớn;
 * cây thư mục có vòng thì đệ quy vô hạn. Hàm này chỉ đọc, mọi bộ nhớ cấp phát
 * tỉ lệ với cỡ THẬT của tệp, và bỏ qua mọi tệp có hình dạng bất thường.
 */

/**
 * `coEncryptedPackage`: tệp có mật khẩu - Office 2007+ (stream `EncryptedPackage`)
 * HOẶC Word 97 mã hóa RC4/XOR (cờ `fEncrypted` trong FIB của `WordDocument`).
 */
export type KetQuaKiemCfb =
  | { ok: true; coWordDocument: boolean; coEncryptedPackage: boolean }
  | { ok: false; lyDo: string };

const NOSTREAM = 0xffffffff;
const CUTOFF = 4096;
const MINI = 64;

type Entry = { ten: string; loai: number; left: number; right: number; child: number; dau: number; co: number };

function docThuMuc(b: BangSectorCfb): Entry[] {
  const secDir = b.docChuoi(b.dirDau, "thư mục");
  if (secDir.length === 0) throw new LoiCfb("không có thư mục");
  const ds: Entry[] = [];
  for (const s of secDir) {
    for (let off = b.offsetSector(s); off < b.offsetSector(s) + b.secSize; off += 128) {
      if (off + 128 > b.buf.length) throw new LoiCfb("thư mục bị cụt");
      const dai = Math.min(b.buf.readUInt16LE(off + 64), 64);
      const coCao = b.buf.readUInt32LE(off + 124);
      if (b.phienBan === 4 && coCao !== 0) throw new LoiCfb("cỡ stream vượt 4 GB");
      ds.push({
        ten: b.buf.toString("utf16le", off, off + Math.max(dai - 2, 0)),
        loai: b.buf.readUInt8(off + 66),
        left: b.buf.readUInt32LE(off + 68),
        right: b.buf.readUInt32LE(off + 72),
        child: b.buf.readUInt32LE(off + 76),
        dau: b.buf.readUInt32LE(off + 116),
        co: b.buf.readUInt32LE(off + 120),
      });
    }
  }
  if (ds[0]?.loai !== 5) throw new LoiCfb("entry gốc không phải Root");
  return ds;
}

/**
 * Duyệt cây thư mục từ Root, mỗi node đúng một lần. Trả id mọi node đi tới
 * được, và riêng các node nằm NGAY dưới Root (anh em qua left/right của
 * `Root.child`) - `word-extractor` chỉ tìm `WordDocument` ở tầng đó.
 */
function duyetCay(ds: Entry[]): { toi: number[]; capGoc: number[] } {
  const daTham = new Uint8Array(ds.length);
  const toi: number[] = [];
  const capGoc: number[] = [];
  const chong: [number, boolean][] = [[ds[0]!.child, true]];
  while (chong.length > 0) {
    const [id, laCapGoc] = chong.pop()!;
    if (id === NOSTREAM) continue;
    if (id >= ds.length || id === 0 || daTham[id]) throw new LoiCfb("cây thư mục có vòng hoặc trỏ ra ngoài");
    daTham[id] = 1;
    toi.push(id);
    if (laCapGoc) capGoc.push(id);
    const e = ds[id]!;
    chong.push([e.left, laCapGoc], [e.right, laCapGoc]);
    if (e.loai === 1) chong.push([e.child, false]);
  }
  return { toi, capGoc };
}

/** Giá trị âm khi đọc kiểu Int32 - `word-extractor` dừng chuỗi ở mọi giá trị như vậy */
const LA_KET_THUC = (s: number) => s >= 0x80000000;

/**
 * Kiểm mọi stream đi tới được từ Root; trả cờ `fEncrypted` của FIB nếu có
 * `WordDocument` (Word 97 mã hóa RC4/XOR không dùng `EncryptedPackage`).
 */
function kiemStream(b: BangSectorCfb, ds: Entry[], toi: number[]): { fibMaHoa: boolean } {
  const goc = ds[0]!;
  // `word-extractor` đòi chuỗi miniFAT dài ĐÚNG bằng số khai, kể cả khi rỗng
  const secMiniFat = b.docChuoi(b.miniFatDau, "mini FAT");
  if (secMiniFat.length !== b.soMiniFat) throw new LoiCfb("số sector mini FAT không khớp");
  const secMiniStream = b.docChuoi(goc.dau, "mini stream");
  if (goc.co > secMiniStream.length * b.secSize) throw new LoiCfb("mini stream khai lớn hơn chuỗi của nó");
  const soMini = Math.ceil(goc.co / MINI);
  // Đọc TRỌN bảng miniFAT (không cắt theo cỡ mini stream): stream cỡ 0 cũng
  // bị `word-extractor` duyệt chuỗi trên bảng này ngay khi mở
  const moiSec = b.secSize / 4;
  const miniFat = new Uint32Array(secMiniFat.length * moiSec);
  secMiniFat.forEach((s, k) => {
    for (let j = 0; j < moiSec; j++) miniFat[k * moiSec + j] = b.buf.readUInt32LE(b.offsetSector(s) + 4 * j);
  });
  const daDungMini = new Uint8Array(soMini);
  const offsetMini = (m: number) => {
    const o = m * MINI;
    return b.offsetSector(secMiniStream[Math.floor(o / b.secSize)]!) + (o % b.secSize);
  };
  let fibMaHoa = false;

  for (const id of toi) {
    const e = ds[id]!;
    if (e.loai !== 2) continue;
    if (e.co >= CUTOFF) {
      const chuoi = b.docChuoi(e.dau, `stream "${e.ten}"`);
      if (e.co > chuoi.length * b.secSize) throw new LoiCfb("cỡ stream khai lớn hơn chuỗi sector");
      if (e.ten === "WordDocument") fibMaHoa = (b.buf.readUInt16LE(b.offsetSector(e.dau) + 0x0a) & 0x0100) !== 0;
      continue;
    }
    if (e.co === 0) {
      // Rỗng: chỉ cần chắc chuỗi (nếu có) không vòng - cùng điều kiện dừng của word-extractor
      const daTham = new Uint8Array(miniFat.length);
      for (let s = e.dau; !LA_KET_THUC(s) && s < miniFat.length; s = miniFat[s]!) {
        if (daTham[s]) throw new LoiCfb(`stream rỗng "${e.ten}" trỏ vào chuỗi mini vòng`);
        daTham[s] = 1;
      }
      continue;
    }
    let soO = 0;
    for (let s = e.dau; s !== ENDOFCHAIN; s = miniFat[s]!) {
      if (s >= soMini || s >= miniFat.length || daDungMini[s]) throw new LoiCfb("chuỗi mini sector hỏng");
      daDungMini[s] = 1;
      soO++;
    }
    if (e.co > soO * MINI) throw new LoiCfb("cỡ mini stream khai lớn hơn chuỗi");
    if (e.ten === "WordDocument" && e.co >= 0x0c) fibMaHoa = (b.buf.readUInt16LE(offsetMini(e.dau) + 0x0a) & 0x0100) !== 0;
  }
  return { fibMaHoa };
}

export function kiemCauTrucCfb(buf: Buffer): KetQuaKiemCfb {
  try {
    const b = docBangSectorCfb(buf);
    const ds = docThuMuc(b);
    const { toi, capGoc } = duyetCay(ds);
    const { fibMaHoa } = kiemStream(b, ds, toi);
    const conCuaGoc = capGoc.filter((id) => ds[id]!.loai === 2).map((id) => ds[id]!.ten);
    const coWordDocument = conCuaGoc.includes("WordDocument");
    return {
      ok: true,
      coWordDocument,
      coEncryptedPackage: conCuaGoc.includes("EncryptedPackage") || (coWordDocument && fibMaHoa),
    };
  } catch (err) {
    if (err instanceof LoiCfb) return { ok: false, lyDo: err.message };
    return { ok: false, lyDo: `cấu trúc OLE hỏng: ${err instanceof Error ? err.message : String(err)}` };
  }
}

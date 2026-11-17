/**
 * Dựng tệp CFB (OLE, định dạng của .doc 97-2003) tối thiểu cho test - CHỈ test dùng.
 *
 * Bố cục v3, sector 512 byte: [FAT][thư mục][dữ liệu từng stream]. Mọi stream
 * được đệm lên >= 4096 byte để nằm ở sector thường (không cần mini stream).
 * Thư mục: entry 0 là Root, các stream xâu thành chuỗi qua con trỏ `right`.
 */

const SEC = 512;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const FATSECT = 0xfffffffd;
const NOSTREAM = 0xffffffff;

export type StreamCfb = { ten: string; data: Buffer };

export type CfbDaDung = {
  buf: Buffer;
  /** sector đầu của từng stream (theo thứ tự truyền vào) - để test tự làm hỏng chuỗi */
  sectorDau: number[];
  soSectorMoiStream: number[];
  /** offset của bảng FAT trong buf - FAT[i] nằm ở offsetFat + 4*i */
  offsetFat: number;
  /** offset entry thư mục thứ i = offsetThuMuc + 128*i */
  offsetThuMuc: number;
};

function ghiEntry(b: Buffer, off: number, ten: string, loai: number, right: number, child: number, start: number, co: number) {
  const tenBuf = Buffer.from(`${ten}\0`, "utf16le");
  tenBuf.copy(b, off);
  b.writeUInt16LE(tenBuf.length, off + 64);
  b.writeUInt8(loai, off + 66);
  b.writeUInt8(1, off + 67);
  b.writeUInt32LE(NOSTREAM, off + 68);
  b.writeUInt32LE(right, off + 72);
  b.writeUInt32LE(child, off + 76);
  b.writeUInt32LE(start, off + 116);
  b.writeUInt32LE(co, off + 120);
}

export function taoCfb(streams: StreamCfb[]): CfbDaDung {
  const data = streams.map((s) => (s.data.length >= 4096 ? s.data : Buffer.concat([s.data, Buffer.alloc(4096 - s.data.length)])));
  const soSectorMoiStream = data.map((d) => Math.ceil(d.length / SEC));
  const soEntry = 1 + streams.length;
  const soSecDir = Math.ceil(soEntry / 4);
  const soSecDuLieu = soSecDir + soSectorMoiStream.reduce((a, b) => a + b, 0);
  let soFat = 1;
  while (soFat * 128 < soFat + soSecDuLieu) soFat++;
  const tongSec = soFat + soSecDuLieu;

  const buf = Buffer.alloc(SEC * (1 + tongSec));
  Buffer.from("d0cf11e0a1b11ae1", "hex").copy(buf, 0);
  buf.writeUInt16LE(0x003e, 24);
  buf.writeUInt16LE(3, 26);
  buf.writeUInt16LE(0xfffe, 28);
  buf.writeUInt16LE(9, 30);
  buf.writeUInt16LE(6, 32);
  buf.writeUInt32LE(soFat, 44);
  buf.writeUInt32LE(soFat, 48); // thư mục bắt đầu ngay sau FAT
  buf.writeUInt32LE(4096, 56);
  buf.writeUInt32LE(ENDOFCHAIN, 60);
  buf.writeUInt32LE(0, 64);
  buf.writeUInt32LE(ENDOFCHAIN, 68);
  buf.writeUInt32LE(0, 72);
  for (let i = 0; i < 109; i++) buf.writeUInt32LE(i < soFat ? i : FREESECT, 76 + 4 * i);

  const offsetFat = SEC;
  const fat = new Array<number>(soFat * 128).fill(FREESECT);
  for (let i = 0; i < soFat; i++) fat[i] = FATSECT;
  const xau = (dau: number, so: number) => {
    for (let k = 0; k < so; k++) fat[dau + k] = k === so - 1 ? ENDOFCHAIN : dau + k + 1;
  };
  xau(soFat, soSecDir);
  const sectorDau: number[] = [];
  let ke = soFat + soSecDir;
  data.forEach((d, i) => {
    sectorDau.push(ke);
    xau(ke, soSectorMoiStream[i]!);
    d.copy(buf, SEC * (1 + ke));
    ke += soSectorMoiStream[i]!;
  });
  fat.forEach((v, i) => buf.writeUInt32LE(v, offsetFat + 4 * i));

  const offsetThuMuc = SEC * (1 + soFat);
  ghiEntry(buf, offsetThuMuc, "Root Entry", 5, NOSTREAM, streams.length > 0 ? 1 : NOSTREAM, ENDOFCHAIN, 0);
  streams.forEach((s, i) => {
    const right = i + 1 < streams.length ? i + 2 : NOSTREAM;
    ghiEntry(buf, offsetThuMuc + 128 * (i + 1), s.ten, 2, right, NOSTREAM, sectorDau[i]!, data[i]!.length);
  });
  // entry trống còn lại trong sector thư mục: con trỏ phải là NOSTREAM
  for (let i = soEntry; i < soSecDir * 4; i++) {
    const off = offsetThuMuc + 128 * i;
    buf.writeUInt32LE(NOSTREAM, off + 68);
    buf.writeUInt32LE(NOSTREAM, off + 72);
    buf.writeUInt32LE(NOSTREAM, off + 76);
  }

  return { buf, sectorDau, soSectorMoiStream, offsetFat, offsetThuMuc };
}

/**
 * Tệp .doc (Word 97-2003) TỐI THIỂU mà `word-extractor` đọc được: stream
 * `WordDocument` có FIB (magic 0xA5EC, cờ chọn bảng 1Table, ccpText, fcClx) và
 * chữ UTF-16 ở offset 0x800; stream `1Table` chứa bảng piece một mảnh. Máy dev
 * không có Word chạy được qua COM nên dựng tay theo đặc tả [MS-DOC].
 */
export function taoDocToiThieu(chu: string): Buffer {
  const noiDung = `${chu}\r`;
  const fib = Buffer.alloc(0x800 + noiDung.length * 2);
  fib.writeUInt16LE(0xa5ec, 0);
  fib.writeUInt16LE(0x0200, 0x0a); // fWhichTblStm = 1Table
  fib.writeUInt32LE(noiDung.length, 0x4c); // ccpText
  fib.writeUInt32LE(0, 0x1a2); // fcClx: bảng piece ở đầu 1Table
  fib.write(noiDung, 0x800, "utf16le");

  const bang = Buffer.alloc(1 + 4 + 16);
  bang.writeUInt8(2, 0); // clxt = Pcdt
  bang.writeUInt32LE(16, 1); // lcb PlcPcd = (n+1)*4 + n*8, n = 1
  bang.writeUInt32LE(0, 5); // CP[0]
  bang.writeUInt32LE(noiDung.length, 9); // CP[1]
  bang.writeUInt32LE(0x800, 15); // PCD.fc (bit 30 tắt = UTF-16)
  return taoCfb([
    { ten: "WordDocument", data: fib },
    { ten: "1Table", data: bang },
  ]).buf;
}

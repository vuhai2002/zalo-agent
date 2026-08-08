/**
 * Cắt chữ thô thành các đoạn để lưu vào `kb_chunks` (qua `luuDoan`).
 *
 * Cắt theo RANH GIỚI TỰ NHIÊN, không cắt cứng theo số ký tự: cắt giữa câu là
 * mất nghĩa, và đoạn mất nghĩa thì bm25 có tìm ra cũng vô dụng. Thứ tự ưu
 * tiên ranh giới: tiêu đề markdown (`#`) > dòng trống > xuống dòng > câu
 * (`. `) > ký tự (chỉ dùng khi không còn ranh giới nào khác).
 *
 * Giữ TIÊU ĐỀ markdown gần nhất phía trên vào từng đoạn - mẹo rẻ nhất bù cho
 * việc không có embedding ở đợt này: đoạn "trong vòng 7 ngày" một mình thì vô
 * nghĩa, kèm tiêu đề "Chính sách đổi trả" thì model đọc ra ngay.
 *
 * Hàm thuần, không import gì - chunk-text chỉ biết cắt chữ, không biết đọc
 * file (đó là việc của doc-text-extract.ts) hay lưu DB (kb-chunk-store.ts).
 */

export type ThamSoCat = { coDoanToiDa: number; chongLan: number };

type DoanChuaGanSo = { tieuDe: string; noiDung: string };

/** Heading markdown: 1-6 dấu #, có khoảng trắng, có chữ theo sau */
const HEADING_RE = /^#{1,6}\s+(.+)$/;

/**
 * Vị trí cắt tốt nhất trong `text.slice(0, maxLen)`: ưu tiên xuống dòng gần
 * cuối nhất, rồi tới dấu chấm câu gần cuối nhất, cuối cùng mới cắt cứng tại
 * đúng `maxLen`. Chỉ nhận vị trí > 0 để đảm bảo mỗi vòng lặp gọi hàm này đều
 * tiến ít nhất 1 ký tự - không thì vòng lặp cắt ở chunk-text có thể đứng yên.
 */
function viTriCatTotNhat(text: string, maxLen: number): number {
  const doanDau = text.slice(0, maxLen);

  const viTriXuongDong = doanDau.lastIndexOf("\n");
  if (viTriXuongDong > 0) return viTriXuongDong + 1;

  const viTriCauCham = doanDau.lastIndexOf(". ");
  if (viTriCauCham > 0) return viTriCauCham + 1; // giữ dấu chấm, bỏ dấu cách sau nó

  return maxLen;
}

/**
 * Cắt văn bản KHÔNG còn ranh giới đoạn trống (đã tách ở `catThanhDoan`) thành
 * các mảnh <= maxLen, dùng ranh giới xuống dòng rồi câu rồi ký tự.
 */
function catVanBanPhang(text: string, maxLen: number): string[] {
  const ra: string[] = [];
  let con = text;
  while (con.length > maxLen) {
    const viTriCat = viTriCatTotNhat(con, maxLen);
    const manh = con.slice(0, viTriCat).trim();
    if (manh) ra.push(manh);
    con = con.slice(viTriCat);
  }
  const cuoi = con.trim();
  if (cuoi) ra.push(cuoi);
  return ra;
}

/**
 * Chèn phần chồng lấn: đoạn sau mang theo `overlapChars` ký tự cuối của đoạn
 * liền trước - CHỈ khi hai đoạn cùng tiêu đề (khác tiêu đề nghĩa là đã sang
 * một mục khác, chồng lấn nội dung cũ vào là sai ngữ cảnh). Lùi điểm bắt đầu
 * phần chồng lấn tới khoảng trắng gần nhất để không mở đầu đoạn sau bằng nửa
 * chữ.
 */
function chenChongLan(doan: DoanChuaGanSo[], overlapChars: number): DoanChuaGanSo[] {
  if (overlapChars <= 0 || doan.length < 2) return doan;

  const ra: DoanChuaGanSo[] = [doan[0]!];
  for (let i = 1; i < doan.length; i++) {
    const truoc = doan[i - 1]!;
    const hienTai = doan[i]!;
    if (truoc.tieuDe !== hienTai.tieuDe) {
      ra.push(hienTai);
      continue;
    }

    const duoi = truoc.noiDung.slice(Math.max(0, truoc.noiDung.length - overlapChars));
    const viTriKhoangTrang = duoi.indexOf(" ");
    const phanChongLan = viTriKhoangTrang === -1 ? duoi : duoi.slice(viTriKhoangTrang + 1);
    ra.push({
      tieuDe: hienTai.tieuDe,
      noiDung: phanChongLan ? `${phanChongLan} ${hienTai.noiDung}` : hienTai.noiDung,
    });
  }
  return ra;
}

export function catThanhDoan(
  chu: string,
  p: ThamSoCat,
): { thuTu: number; tieuDe: string; noiDung: string }[] {
  // Chuẩn hóa xuống dòng MỘT LẦN ở cửa vào - toàn bộ logic dưới đây (tách đoạn
  // trống, dò heading ở dòng đầu) đều dựa vào "\n" trần. File .txt/.md do
  // Windows Notepad/Word "Save as" ghi CRLF ("\r\n\r\n" cho dòng trống): không
  // có 2 ký tự "\n" nào LIỀN NHAU nên `split(/\n{2,}/)` không tách được gì,
  // cả tài liệu rơi vào MỘT đoạn duy nhất - hỏng câm tính năng "giữ tiêu đề
  // gần nhất" (chỉ dò được heading ở dòng đầu tài liệu). `\r\n?` bắt cả CRLF
  // lẫn CR đơn (Mac cổ).
  chu = chu.replace(/\r\n?/g, "\n");

  const maxLen = Math.max(1, p.coDoanToiDa);
  const overlapChars = Math.max(0, Math.floor(maxLen * (p.chongLan / 100)));

  const ketQua: DoanChuaGanSo[] = [];
  let tieuDeHienTai = "";
  let buffer = "";

  /** Chốt buffer đang gom thành 1 (hoặc nhiều, nếu buffer vượt maxLen) đoạn */
  const chotBuffer = () => {
    const noiDung = buffer.trim();
    buffer = "";
    if (!noiDung) return;
    for (const manh of catVanBanPhang(noiDung, maxLen)) {
      ketQua.push({ tieuDe: tieuDeHienTai, noiDung: manh });
    }
  };

  for (const doanTho of chu.split(/\n{2,}/)) {
    const doanVan = doanTho.trim();
    if (!doanVan) continue;

    const dong = doanVan.split("\n");
    const khopTieuDe = HEADING_RE.exec(dong[0]!.trim());
    let than = doanVan;
    if (khopTieuDe) {
      // Sang mục mới: chốt lại mọi thứ đang gom dưới tiêu đề CŨ trước khi đổi
      chotBuffer();
      tieuDeHienTai = khopTieuDe[1]!.trim();
      than = dong.slice(1).join("\n").trim();
    }
    if (!than) continue; // heading không kèm thân bài (vd cuối văn bản) - bỏ qua

    const ghep = buffer ? `${buffer}\n\n${than}` : than;
    if (ghep.length <= maxLen) {
      buffer = ghep;
    } else {
      chotBuffer();
      buffer = than;
    }
  }
  chotBuffer();

  return chenChongLan(ketQua, overlapChars).map((d, i) => ({ thuTu: i, ...d }));
}

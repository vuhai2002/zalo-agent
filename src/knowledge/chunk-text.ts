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
 * Hàm thuần (không env, không DB, không đọc file) - chỉ import bộ lọc ký tự ẩn
 * dùng chung (`tag-ky-tu-an.ts`, cũng THUẦN). Đây là TẦNG NẠP: lọc dải Tags
 * (ASCII smuggling, xem docstring của `locKyTuAn`) ở ĐÂY chứ không ở tầng bọc
 * (`wrap-untrusted-content.ts`) - tài liệu vào kho đã sạch, không phải lọc lại
 * mỗi lần tra.
 */

import { locKyTuAn } from "../agent/tools/tag-ky-tu-an.js";

export type ThamSoCat = { coDoanToiDa: number; chongLan: number };

type DoanChuaGanSo = { tieuDe: string; noiDung: string };

/** Heading markdown: 1-6 dấu #, có khoảng trắng, có chữ theo sau. Nhóm 1 = số dấu # (cấp), nhóm 2 = chữ tiêu đề */
const HEADING_RE = /^(#{1,6})\s+(.+)$/;

/** Số cấp heading tối đa markdown hỗ trợ (khớp `#{1,6}` ở trên) */
const CAP_TOI_DA = 6;

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
  //
  // Lọc dải Tags NGAY TẠI ĐÂY - điểm chốt duy nhất mọi tài liệu KB đi qua
  // trước khi cắt đoạn, nên lọc một lần ở cửa vào là đủ sạch cho cả kho.
  chu = locKyTuAn(chu.replace(/\r\n?/g, "\n"));

  const maxLen = Math.max(1, p.coDoanToiDa);
  const overlapChars = Math.max(0, Math.floor(maxLen * (p.chongLan / 100)));

  const ketQua: DoanChuaGanSo[] = [];
  // Ngăn xếp tiêu đề theo CẤP (chỉ số 1..6, chỉ số 0 luôn rỗng, không dùng) -
  // sửa đúng lỗi I1: bản cũ chỉ giữ MỘT `tieuDeHienTai`, bị H2 ghi đè trước khi
  // có đoạn nào chốt dưới H1, nên H1 (thường TRÙNG TÊN TÀI LIỆU) không bao giờ
  // vào chỉ mục khi có H2 bên dưới. Gặp heading cấp N thì XÓA mọi cấp SÂU HƠN
  // N (sang mục mới thì heading con cũ không còn hợp lệ) rồi ghép các cấp còn
  // lại (nông -> sâu) thành breadcrumb "H1 > H2 > H3".
  const nganXepTieuDe: string[] = new Array(CAP_TOI_DA + 1).fill("");
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
      // Sang mục mới: chốt lại mọi thứ đang gom dưới breadcrumb CŨ trước khi đổi
      chotBuffer();
      const cap = khopTieuDe[1]!.length;
      nganXepTieuDe[cap] = khopTieuDe[2]!.trim();
      for (let l = cap + 1; l <= CAP_TOI_DA; l++) nganXepTieuDe[l] = "";
      tieuDeHienTai = nganXepTieuDe.filter(Boolean).join(" > ");
      than = dong.slice(1).join("\n").trim();
    }
    // Heading không kèm thân bài NGAY DƯỚI (vd "# Tiêu đề tài liệu" đứng một
    // mình rồi mới tới "## Mục con") - KHÔNG bỏ qua breadcrumb: ngăn xếp ở
    // trên đã ghi nhận nó rồi, chỉ không có gì để CHỐT thành đoạn ở vòng này.
    if (!than) continue;

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

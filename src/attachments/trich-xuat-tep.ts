import {
  chayTienTrinhCon,
  LoiTuTienTrinhCon,
  urlScriptCon,
  type TranTienTrinhCon,
} from "../shared/chay-tien-trinh-con-co-tran.js";
import { xepHangTrichXuat } from "../shared/hang-doi-trich-xuat.js";
import { LoiTep, type KetQuaTrichXuatTep, type MaLoiTep } from "./attachment-extract-types.js";
import type { DuLieuTrichXuat } from "./trich-xuat-tep-trong-con.js";

/**
 * Đọc chữ một tệp người dùng gửi, trong TIẾN TRÌNH CON có trần (xếp chung hàng
 * đợi một-việc với Kho tri thức). Module thuần: trần truyền vào từ caller.
 *
 * Ném `LoiTep` (lỗi nội dung, mã có kiểu) hoặc `LoiTienTrinhConBiNgat` (con bị
 * giết giữa chừng - không biết tệp hỏng thật hay máy chật, được thử lại).
 */

const SCRIPT_CON = urlScriptCon("./attachment-extract-child", import.meta.url);
const MA_HOP_LE = new Set<MaLoiTep>(["mat-khau", "chua-ho-tro", "hong", "qua-lon"]);

export type ThamSoTrichXuatTep = {
  duoiKhai: string;
  tranKyTu: number;
  tranTrangPdf: number;
  tran: TranTienTrinhCon;
  baoKhongDoDuocRss?: () => void;
};

export async function trichXuatTep(buf: Buffer, p: ThamSoTrichXuatTep): Promise<KetQuaTrichXuatTep> {
  try {
    return await xepHangTrichXuat(() =>
      chayTienTrinhCon<DuLieuTrichXuat, KetQuaTrichXuatTep>({
        script: SCRIPT_CON,
        duLieu: { buf, duoiKhai: p.duoiKhai, tranKyTu: p.tranKyTu, tranTrangPdf: p.tranTrangPdf },
        tran: p.tran,
        baoKhongDoDuocRss: p.baoKhongDoDuocRss,
      }),
    );
  } catch (err) {
    if (err instanceof LoiTuTienTrinhCon) {
      const ma = MA_HOP_LE.has(err.ma as MaLoiTep) ? (err.ma as MaLoiTep) : "hong";
      throw new LoiTep(ma, err.message);
    }
    throw err;
  }
}

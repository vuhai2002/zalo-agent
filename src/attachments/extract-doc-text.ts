import WordExtractor from "word-extractor";
import { LoiTep } from "./attachment-extract-types.js";
import { kiemCauTrucCfb } from "./kiem-cau-truc-cfb.js";

/**
 * Đọc chữ từ .doc (Word 97-2003).
 *
 * `word-extractor` CHỈ được gọi sau khi `kiemCauTrucCfb` xác nhận cấu trúc
 * OLE sạch - thư viện tin mọi con số trong tệp (xem đầu `kiem-cau-truc-cfb.ts`
 * cho PoC). Phần còn lại (bảng piece trong stream Word) chỉ có thể phình heap
 * JS, việc đó trần heap của tiến trình con đọc tài liệu chặn. Gọi với Buffer
 * nên thư viện không bao giờ đi đường đọc file hay đường docx (yauzl).
 */
export async function extractDocText(buf: Buffer): Promise<string> {
  const kiem = kiemCauTrucCfb(buf);
  if (!kiem.ok) throw new LoiTep("hong", `Tệp Word cũ (.doc) bị hỏng cấu trúc, không đọc được (${kiem.lyDo})`);
  if (kiem.coEncryptedPackage) throw new LoiTep("mat-khau", "Tệp này có mật khẩu, chưa đọc được");
  if (!kiem.coWordDocument) {
    throw new LoiTep("chua-ho-tro", "Tệp Office đời cũ này không phải văn bản Word (.doc) - chưa đọc được loại này");
  }
  let chu: string;
  try {
    chu = (await new WordExtractor().extract(buf)).getBody();
  } catch (err) {
    const chiTiet = err instanceof Error ? err.message : String(err);
    throw new LoiTep("hong", `Tệp Word cũ (.doc) bị hỏng, không đọc được: ${chiTiet}`);
  }
  if (!chu.trim()) throw new LoiTep("hong", "Không đọc được chữ nào từ tệp Word cũ (.doc)");
  return chu;
}

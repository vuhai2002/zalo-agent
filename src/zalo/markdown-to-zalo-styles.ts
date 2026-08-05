import { TextStyle, type Style } from "zca-js";
import { apDungInline, MOC } from "./markdown-inline-styles.js";
import { chuanHoaStyles } from "./normalize-zalo-styles.js";

/**
 * Dịch markdown của model thành TEXT TRẦN + danh sách `Style` của Zalo.
 *
 * Vì sao đổi từ XÓA sang DỊCH: docstring cũ của `sanitize-reply-text.ts` nêu lý
 * do xóa markdown là "Zalo không render markdown". Điều đó đúng với KÝ TỰ
 * markdown nhưng SAI với định dạng - `sendMessage` của zca-js nhận
 * `styles: Style[]` và Zalo render đậm/cỡ chữ/danh sách bình thường
 * (`zca-js/src/apis/sendMessage.ts`, enum `TextStyle`). Người dùng chỉ ra rằng
 * tin Zalo thật có in đậm và tiêu đề, còn bot thì trả lời một khối chữ phẳng.
 *
 * MỨC ĐỘ: cố ý CHỈ dùng nhóm không màu - đậm, nghiêng, gạch ngang, tiêu đề
 * to-đậm, danh sách. Zalo có sẵn 4 màu nhưng bot trả lời hội thoại mà tô màu
 * thì đọc như tin quảng cáo; màu để dành cho ca thông báo, quyết định sau.
 *
 * OFFSET ĐẾM THEO ĐƠN VỊ UTF-16 (`String.length` của JS), KHÔNG phải code
 * point. zca-js gói thẳng `start`/`len` vào `textProperties` JSON, không đổi gì,
 * nên phải khớp cách Zalo Web đếm. Emoji là cặp surrogate = 2 đơn vị: "sửa cho
 * đúng" thành đếm ký tự thật sẽ lệch toàn bộ phần sau emoji đầu tiên, mà tin
 * nhắn thật đầy emoji.
 *
 * Phỏng theo `zalo-personal/src/send.ts` (MIT) - bản đó đã chạy thật và trả giá
 * cho đúng cái bẫy mô tả ở `apDungInline` bên dưới.
 *
 * Module THUẦN: không env, không logger, không DB.
 */

export type KetQuaDinhDang = { text: string; styles: Style[] };

/**
 * Dịch cả đoạn: xử lý TỪNG DÒNG, bóc dấu khối (tiêu đề / gạch đầu dòng / đánh
 * số) rồi chạy inline trên phần nội dung còn lại, cộng dồn con trỏ toàn cục để
 * mọi span nằm ở offset của CHUỖI CUỐI.
 */
export function markdownSangStyleZalo(input: string): KetQuaDinhDang {
  // Model có thể sinh ra chính ký tự mốc (JSON escape được ). Dọn trước
  // khi dùng nó làm mốc, không thì chuỗi dạng MOC+số+MOC va đúng token và
  // `apDungInline` nhét nhầm nội dung. Cùng lá chắn với `MOC_KHOI` ở
  // `sanitize-reply-text.ts`.
  let src = input.includes(MOC) ? input.split(MOC).join("") : input;

  // Rào code CÙNG DÒNG: chỉ gỡ rào, giữ nguyên nội dung
  src = src.replace(/```([^\n`]*)```/g, (_ca, than: string) => than);

  const dongs = src.split("\n");
  const phan: string[] = [];
  const styles: Style[] = [];
  let conTro = 0;
  let trongKhoiCode = false;

  for (let i = 0; i < dongs.length; i++) {
    const dong = dongs[i]!;

    // Dòng rào ``` chỉ bật/tắt trạng thái rồi biến mất khỏi tin
    if (/^\s*```/.test(dong)) {
      trongKhoiCode = !trongKhoiCode;
      continue;
    }

    // Nội dung trong khối code đi thẳng, KHÔNG qua bước khối hay inline. Bỏ
    // bước này thì `# Tính tổng` trong đoạn Python bị hiểu là tiêu đề và mất
    // dấu thăng - đúng lỗi mà `sanitize-code-block.ts` đã được viết ra để chữa.
    if (trongKhoiCode) {
      phan.push(dong);
      conTro += dong.length;
      if (i < dongs.length - 1) {
        phan.push("\n");
        conTro += 1;
      }
      continue;
    }

    // Dòng kẻ ngăn của bảng markdown (|---|:---:|) chỉ là rác trên Zalo - bỏ
    // hẳn dòng, giữ nguyên các dòng dữ liệu. Giữ lại hành vi của lớp làm sạch cũ.
    if (/^\s*\|?[-:|\s]*--[-:|\s]*\|?\s*$/.test(dong) && dong.includes("-")) continue;

    // [chữ](url) -> "chữ (url)" để URL vẫn bấm được; trùng nhau thì chỉ giữ url.
    // Làm TỪNG DÒNG chứ không trên cả đoạn, để dòng trong khối code không bị đụng.
    // Bỏ khoảng trắng CUỐI dòng: trong markdown hai dấu cách cuối dòng nghĩa là
    // "ngắt dòng", nhưng ở đây ký tự xuống dòng đã làm việc đó rồi - giữ lại chỉ
    // tổ cho span ôm thêm mấy ô trắng vô nghĩa. Dòng trong khối code đã đi
    // đường riêng ở trên nên không bị đụng.
    const dongLink = dong.replace(/[ \t]+$/, "").replace(
      /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|tel:[^\s)]+)\)/g,
      (_ca, chu: string, url: string) => (chu.trim() === url.trim() ? url : `${chu} (${url})`),
    );

    let noiDung = dongLink;
    let thutLe = "";
    const khoi: Exclude<TextStyle, TextStyle.Indent>[] = [];

    const mTieuDe = /^(#{1,6})[ \t]+(.+)$/.exec(dongLink);
    const mGach = !mTieuDe && /^(\s*)[-*+][ \t]+(.+)$/.exec(dongLink);
    const mSo = !mTieuDe && !mGach && /^(\s*)\d+\.[ \t]+(.+)$/.exec(dongLink);

    if (mTieuDe) {
      noiDung = mTieuDe[2]!.trimEnd();
      // Big cho to hơn thấy rõ, Bold thêm độ đậm cho client cũ
      khoi.push(TextStyle.Big, TextStyle.Bold);
    } else if (mGach) {
      thutLe = mGach[1]!;
      noiDung = mGach[2]!;
      khoi.push(TextStyle.UnorderedList);
    } else if (mSo) {
      thutLe = mSo[1]!;
      noiDung = mSo[2]!;
      khoi.push(TextStyle.OrderedList);
    }

    const { text: daInline, spans } = apDungInline(noiDung);
    const batDauDong = conTro + thutLe.length;
    const chuCuaDong = `${thutLe}${daInline}`;
    phan.push(chuCuaDong);

    if (daInline.length > 0) {
      for (const st of khoi) styles.push({ start: batDauDong, len: daInline.length, st });
      for (const s of spans) styles.push({ start: batDauDong + s.start, len: s.len, st: s.st });

      // Danh sách lồng: mỗi 2 khoảng trắng là một cấp. zca-js mã hóa Indent
      // bằng cách thay "$" trong "ind_$" thành `${indentSize}0`.
      if ((mGach || mSo) && thutLe.length >= 2) {
        styles.push({
          start: batDauDong,
          len: daInline.length,
          st: TextStyle.Indent,
          indentSize: Math.floor(thutLe.length / 2),
        });
      }
    }

    conTro += chuCuaDong.length;
    if (i < dongs.length - 1) {
      phan.push("\n");
      conTro += 1;
    }
  }

  // Chuẩn hóa ở ĐÂY chứ không ở nơi gửi: mọi span đều sinh ra từ hàm này, nên
  // đây là chỗ duy nhất bảo đảm được bất biến "không span nào chồng span cùng
  // kiểu". Bộ cắt tin bên `split-styled-message.ts` chỉ CẮT span có sẵn nên
  // không thể tạo ra chồng lấn mới.
  return { text: phan.join(""), styles: chuanHoaStyles(styles) };
}

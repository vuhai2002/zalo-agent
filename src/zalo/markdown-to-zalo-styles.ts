import { TextStyle, type Style } from "zca-js";
import { apDungInline, MOC } from "./markdown-inline-styles.js";
import { raiDinhDangNhieuDong } from "./multiline-markup-per-line.js";
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
 * to-đậm. Zalo có sẵn 4 màu nhưng bot trả lời hội thoại mà tô màu thì đọc như
 * tin quảng cáo; màu để dành cho ca thông báo, quyết định sau. Danh sách CỐ Ý
 * không dùng style của Zalo - xem docstring `laDongKhoi`.
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

const TIEU_DE_RE = /^(#{1,6})[ \t]+(.+)$/;

const DANH_SACH_RE = /^\s*(?:[-*+]|\d+\.)[ \t]+\S/;

/** Dòng này là một mục danh sách (gạch đầu dòng hoặc đánh số) */
function laDongDanhSach(dong: string | undefined): boolean {
  return dong !== undefined && DANH_SACH_RE.test(dong);
}

/**
 * Dòng này có DẪN VÀO danh sách ngay dưới không - dấu hiệu là kết thúc bằng
 * dấu hai chấm ("Đối chiếu vé 645300:", "Kết quả Tiền Giang:").
 *
 * Cần phân biệt vì bản đầu bỏ dòng trống trước MỌI danh sách, kể cả khi đoạn
 * trên chẳng liên quan. Đo trên tin thật: bản tin công nghệ có "Nguồn: CNBC"
 * rồi URL, rồi mục "2. Nvidia thúc đẩy..." - dòng trống giữa URL và mục 2 bị
 * xóa nên mục mới dính luôn vào cuối tin trước, trong khi các mục khác vẫn có
 * khoảng cách. Nhìn ra là cách dòng lộn xộn.
 */
function laCauDan(dong: string | undefined): boolean {
  if (dong === undefined) return false;
  const s = dong.trimEnd();
  return s.length > 0 && s.endsWith(":");
}

/**
 * VÌ SAO KHÔNG DÙNG `lst_1`/`lst_2` CỦA ZALO - đo trên máy thật 2026-08-05:
 * hai client render KHÁC NHAU. Zalo Web vẽ một dấu đầu dòng cho mỗi dòng nằm
 * trong span; Zalo trên điện thoại chỉ vẽ MỘT dấu cho cả span rồi thụt các dòng
 * sau vào như xuống dòng mềm. Danh sách 9 mục hiện thành 1 mục trên điện thoại.
 *
 * Đã thử hướng "mỗi dòng một span" - đúng trên cả hai client, nhưng một danh
 * sách 40 dòng là 40 span, mà JSON định dạng vốn đã ngốn gấp đôi chữ và Zalo
 * chặn theo TỔNG byte. Trả giá bằng thêm tin cho người dùng phải đọc.
 *
 * Nên: GIỮ NGUYÊN ký tự "- " và "1. " làm chữ thường. Chữ thường hiện y hệt
 * nhau ở mọi client, tốn 0 span, và người dùng thấy dễ đọc hơn dấu chấm tròn.
 * Đây là lựa chọn của người dùng sau khi nhìn cả hai bản.
 */
function laDongKhoi(dong: string | undefined): boolean {
  if (dong === undefined) return false;
  return TIEU_DE_RE.test(dong);
}

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

  // Rải dấu VẮT NHIỀU DÒNG thành dấu từng dòng, TRƯỚC khi cắt dòng. Model bọc
  // cả khối nhiều dòng trong một cặp dấu (`<xanh>` quanh cả bài thơ) là chuyện
  // thường, mà vòng lặp dưới đây xử theo dòng nên cặp đó không bao giờ khớp -
  // người dùng nhận nguyên chuỗi `<xanh>` giữa bài.
  src = raiDinhDangNhieuDong(src);

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

    // Dòng TRỐNG: giữ hay bỏ tùy hai bên nó là gì. Luật này dựng theo đúng chỗ
    // người dùng chỉ trên ảnh chụp màn hình thật, không phải suy đoán.
    //
    //   BỎ - ngay SAU dòng tiêu đề: tiêu đề và câu dẫn của nó thuộc về nhau.
    //   BỎ - giữa CÂU DẪN và danh sách ngay dưới nó: danh sách là phần khai
    //        triển của chính câu đó ("Đối chiếu vé 645300:" rồi tới các mục),
    //        tách ra là làm rời hai thứ đi liền nhau.
    //   GIỮ - ngay TRƯỚC dòng tiêu đề: đó là ranh giới giữa hai mục, thiếu nó
    //        thì "Kết luận: Không trúng." dính luôn vào tiêu đề mục sau.
    //   GIỮ - mọi chỗ còn lại (giữa hai đoạn văn, sau một khối danh sách).
    if (dong.trim() === "") {
      const truoc = dongs[i - 1];
      const sau = dongs[i + 1];
      if (laDongKhoi(truoc)) continue;
      if (laCauDan(truoc) && laDongDanhSach(sau) && !laDongDanhSach(truoc)) continue;
    }

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

    // CÙNG biểu thức mà `laDongKhoi` dùng - hai nơi lệch nhau thì việc bỏ dòng
    // trống sẽ nhắm sai dòng, mà lỗi đó không lộ ra ở đâu ngoài mắt người đọc.
    //
    // Chỉ còn TIÊU ĐỀ là khối: gạch đầu dòng và đánh số cố ý đi qua đây như chữ
    // thường, giữ nguyên ký tự "- " / "1. " - lý do ở docstring `laDongKhoi`.
    const mTieuDe = TIEU_DE_RE.exec(dongLink);
    const noiDung = mTieuDe ? mTieuDe[2]!.trimEnd() : dongLink;

    const { text: daInline, spans } = apDungInline(noiDung);
    phan.push(daInline);

    if (daInline.length > 0) {
      // Big cho to hơn thấy rõ, Bold thêm độ đậm cho client cũ
      if (mTieuDe) {
        styles.push({ start: conTro, len: daInline.length, st: TextStyle.Big });
        styles.push({ start: conTro, len: daInline.length, st: TextStyle.Bold });
      }
      for (const s of spans) styles.push({ start: conTro + s.start, len: s.len, st: s.st });
    }

    conTro += daInline.length;
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

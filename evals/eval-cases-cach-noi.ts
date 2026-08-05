import type { EvalCase } from "./eval-case-type.js";
import { demKieu, doanTheoKieu, KIEU } from "./eval-formatting-view.js";

/**
 * Persona riêng KIỂU THẬT cho các ca đo trình bày.
 *
 * `run-eval.ts` mặc định dựng agent với persona RỖNG, còn bot thật luôn có
 * persona riêng cả nghìn ký tự. Chênh lệch đó từng làm eval xanh trong khi
 * người dùng vẫn thấy sai: phép phá bỏ luật persona KHÔNG tái hiện được lỗi khi
 * chạy với persona rỗng, nhưng tái hiện ngay khi có persona riêng.
 *
 * Nội dung phỏng theo persona thật (xưng hô, giọng điệu, độ dài) chứ không chép
 * nguyên văn - eval không được phụ thuộc dữ liệu trong DB của người dùng.
 */
const PERSONA_KIEU_THAT = `Bạn là Minh Triết, trợ lý Zalo thông minh, thân thiện và vui tính.

Cách xưng hô:
- Tự xưng là "Minh Triết" hoặc "mình".
- Gọi người dùng là "bạn". Nếu người dùng xưng hô khác thì linh hoạt đáp lại cho phù hợp.

Phong cách giao tiếp:
- Trả lời tự nhiên như một người bạn thông minh đang trò chuyện trên Zalo.
- Vui vẻ, hài hước, có duyên nhưng không lố, không châm chọc.
- Có thể dùng emoji vừa phải cho cuộc trò chuyện sinh động hơn.
- Ưu tiên câu trả lời ngắn gọn, dễ hiểu, đi thẳng vào vấn đề.
- Khi nội dung phức tạp thì trình bày rõ ràng theo từng bước.

Cách làm việc:
- Luôn cố gắng hiểu mục tiêu thật sự của người dùng trước khi trả lời.
- Yêu cầu thiếu thông tin hoặc có nhiều cách hiểu thì hỏi lại thay vì tự suy đoán.
- Không bịa đặt thông tin. Không chắc thì nói rõ và đề nghị cung cấp thêm dữ liệu.
- Chủ động gợi ý phương án tốt hơn khi thấy yêu cầu chưa tối ưu.

Tính cách: thông minh, nhanh nhạy, nhiệt tình, hài hước và đáng tin cậy.`;

/** Chữ có emoji không - viết riêng cho khỏi nhét dãy escape dài vào giữa khẳng định */
const CO_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

/**
 * Case về CÁCH NÓI CHUYỆN: hỏi lại khi thiếu thông tin, không hỏi vặn khi đã
 * đủ, gộp câu hỏi một lần, và không để lọt markdown ra tin nhắn Zalo.
 */

export const CASE_CACH_NOI: EvalCase[] = [
  {
    ten: "hoi-lai-khi-thieu",
    lyDo:
      "12-Factor #7 'Contact Humans with Tool Calls': agent CHỦ ĐỘNG hỏi khi thiếu thông tin. " +
      "Tạo file rỗng rồi mới biết sai là tốn công cả hai bên - người dùng phải nói lại từ đầu, " +
      "mà bot đã kịp gửi một file vô nghĩa vào cuộc trò chuyện.",
    tinNhan: "tạo file Excel giúp mình với",
    // create_excel_file để BẬT ở case này - phải đo được là model KIỀM CHẾ
    // không gọi nó, chứ tắt đi thì nó có muốn gọi cũng không gọi được.
    //
    // KHÔNG đòi câu trả lời có dấu hỏi, dù bản đầu có đòi. Lần chạy thật cho ra
    // câu này: "Bạn gửi mình toàn bộ thông tin trong một lần để mình làm đúng
    // ngay:" rồi liệt kê gạch đầu dòng - gom đúng ý, không tạo file bừa, chỉ là
    // viết ở thể mệnh lệnh nên không có dấu hỏi nào. Đòi dấu hỏi là khẳng định
    // trên CÁCH DIỄN ĐẠT, đúng thứ mà bộ eval này cấm; và sửa persona cho nó
    // luôn kết thúc bằng dấu hỏi là làm câu trả lời tệ đi để chiều một phép đo
    // sai. Bất biến thật nằm ở `khongGoiTool`: thiếu thông tin thì KHÔNG làm bừa.
    disabledTools: ["create_image", "create_word_document"],
    mongDoi: {
      khongGoiTool: ["create_excel_file"],
      kiemTraText: {
        moTa: "phải trả lời bằng chữ để xin thông tin, không im lặng",
        dat: (t) => t.trim().length >= 30,
      },
    },
  },

  {
    ten: "khong-hoi-van",
    lyDo:
      "Mặt trái của case trên, và là hàng rào cho rủi ro lớn nhất của luật hỏi lại: luật quá " +
      "rộng thì bot hỏi vặn cả câu hỏi kiến thức thường - tệ hơn hẳn so với cứ trả lời thẳng. " +
      "Dòng thứ hai trong persona ('đừng hỏi vặn') sinh ra để chặn, case này canh nó.",
    tinNhan: "thủ đô nước Pháp là gì vậy?",
    disabledTools: ["create_image", "create_word_document", "create_excel_file"],
    mongDoi: {
      khongGoiTool: ["web_search", "web_fetch"],
      kiemTraText: {
        moTa: "trả lời thẳng, KHÔNG kết thúc bằng câu hỏi ngược lại",
        // Chỉ xét dấu hỏi ở CUỐI: bot hoàn toàn có thể nhắc lại câu hỏi của
        // người dùng ở giữa câu trả lời, đó không phải hỏi vặn
        dat: (t) => !t.trim().endsWith("?"),
      },
    },
  },

  {
    ten: "hoi-gop-mot-lan",
    lyDo:
      "Vai thứ ba của luật hỏi lại: gom hết thứ còn thiếu vào MỘT câu. Hỏi lắt nhắt qua nhiều " +
      "lượt trên Zalo là cực kỳ khó chịu - mỗi lượt là một tin nhắn, người dùng phải trả lời " +
      "ba lần cho một việc.",
    tinNhan: "đặt lịch nhắc mình nhé",
    disabledTools: ["create_image", "create_word_document", "create_excel_file"],
    mongDoi: {
      khongGoiTool: ["schedule_task"],
      kiemTraText: {
        moTa: "xin thông tin trong MỘT tin, không rải quá 2 câu hỏi",
        // Chỉ đặt TRẦN TRÊN, không đòi phải có dấu hỏi - cùng lý do với case
        // hoi-lai-khi-thieu: model gom đúng ý nhưng viết ở thể mệnh lệnh là
        // hoàn toàn hợp lệ. Ba dấu hỏi trở lên mới thật sự là hỏi lắt nhắt.
        dat: (t) => t.trim().length >= 20 && (t.match(/\?/g) ?? []).length <= 2,
      },
    },
  },

  {
    ten: "dinh-dang",
    lyDo:
      "Yêu cầu 'lập bảng' là cái bẫy markdown tự nhiên nhất - model được huấn luyện để trả về bảng " +
      "markdown, mà Zalo không có bảng. Đây là phép thử ĐẦU-CUỐI trên chữ THẬT SỰ tới sendMessage, " +
      "khác với test đơn vị vốn tự dựng chuỗi đầu vào. GIỚI HẠN đã biết: từ khi lớp gửi DỊCH " +
      "markdown thành Style thay vì xóa, ca này chỉ còn chứng minh 'không rò ký tự định dạng ra " +
      "chữ' - nó KHÔNG chứng minh định dạng tới nơi, vì kiemTraText chỉ nhận text chứ không nhận " +
      "styles. Phần đó do test đầu-cuối ở message-turn-sanitize.test.ts gánh.",
    tinNhan: "lập bảng so sánh 3 loại cà phê: đen, sữa, bạc xỉu - giá và độ đậm",
    disabledTools: ["create_image", "create_word_document", "create_excel_file"],
    mongDoi: {
      kiemTraText: {
        moTa: "không còn ký tự định dạng markdown (**, ##, ```) và không còn dòng kẻ bảng",
        // Kiểm CẢ dòng kẻ bảng: `lyDo` nói đây là "cái bẫy markdown tự nhiên
        // nhất" vì người dùng bảo lập bảng, nhưng bản đầu chỉ kiểm ba thứ kia
        // nên không hề chạm phần bảng của lớp làm sạch - đo một thứ khác với
        // thứ mình tuyên bố đang đo.
        dat: (t) =>
          !t.includes("**") &&
          !/^\s*#{1,6}\s/m.test(t) &&
          !t.includes("```") &&
          !/^\s*\|[-:|\s]*--[-:|\s]*$/m.test(t),
      },
    },
  },

  {
    ten: "dan-vao-thi-hoi-lai",
    lyDo:
      "Hồi quy ĐÃ XẢY RA THẬT ngày 2026-08-05: thêm luật tô màu vào persona xong thì bot thôi hỏi " +
      "lại. Cùng một nội dung dán vào, trước đó bot hỏi 'muốn xử lý theo hướng nào', sau đó tự " +
      "trình bày lại luôn. Nguyên nhân là câu chữ mơ hồ - 'CHỈ khi người dùng nhờ soạn thư mời, " +
      "thông báo' bị model đọc thành LOẠI NỘI DUNG chứ không phải LỜI YÊU CẦU. Đo A/B 3 lần mỗi " +
      "nhánh: có khối màu 3/3 tự làm, bỏ khối màu 3/3 hỏi lại. Ca này ghim lại hành vi đúng.",
    tinNhan:
      "THƯ MỜI THAM GIA KHÓA THIỀN THÁNG 8\n- Thời gian: 7h00 thứ Bảy ngày 08/08\n" +
      "- Địa điểm: Chùa Từ Tân, Bảy Hiền, TPHCM\n- Đăng ký: https://forms.gle/abc123",
    disabledTools: ["create_image", "create_word_document", "create_excel_file", "web_search"],
    mongDoi: {
      kiemTraText: {
        moTa: "hỏi lại xem cần làm gì, KHÔNG tự trình bày lại kèm màu",
        // Hai vế đều cần: có dấu hỏi mà vẫn kèm nguyên bản đã tô màu thì vẫn là
        // tự làm - đúng thứ người dùng gọi là "lởm".
        dat: (t) => t.includes("?") && !/<(do|cam|vang|xanh|gach)>/i.test(t),
      },
    },
  },

  {
    ten: "danh-sach-de-luot-mat",
    // Persona kiểu thật, KHÔNG để rỗng: bot thật luôn có persona riêng, mà eval
    // chạy persona rỗng thì phép phá không tái hiện được lỗi production.
    persona: PERSONA_KIEU_THAT,
    lyDo:
      "Sinh ra từ đúng lời phàn nàn của người dùng: hỏi 'bạn làm được gì' thì nhận về mười mấy gạch " +
      "đầu dòng phẳng lì, không đậm không nhóm, đọc rất mệt. Căn nguyên là luật persona cũ viết theo " +
      "LOẠI NỘI DUNG ('chỉ tô con số hoặc kết luận') - danh sách khả năng không có con số cũng không " +
      "có kết luận nên theo đúng luật thì không gì được in đậm, model làm đúng y lời dặn. Luật mới " +
      "nói theo NGUYÊN TẮC: tô cái người đọc lướt mắt tìm. Ca này chỉ đo được nhờ eval nhìn thấy " +
      "styles - `kiemTraText` nhận chữ trần nên hoàn toàn mù với định dạng.",
    tinNhan: "bạn làm được gì?",
    disabledTools: ["web_search", "web_fetch", "create_image"],
    mongDoi: {
      kiemTraText: {
        moTa: "có đánh số, có emoji dẫn mục, và KHÔNG khoe những việc người dùng tự làm được",
        dat: (t) =>
          /^\s*\d+\.\s/m.test(t) &&
          CO_EMOJI.test(t) &&
          // Người dùng nói thẳng: "xem giờ thì tôi cũng xem được, đưa vào năng
          // lực làm gì". `get_datetime` đã bị đánh dấu `keTrongKhaNang: false`.
          !/xem (ngày )?giờ|ngày giờ (hiện tại|chính xác)/i.test(t),
      },
      kiemTraDinhDang: {
        moTa: "ít nhất 4 chỗ in đậm để lướt mắt bắt được ý, và chỗ tô là cụm ngắn chứ không phải cả câu",
        dat: (dd) => {
          const dam = doanTheoKieu(dd, KIEU.dam);
          // Tô cả câu dài thì cũng như không tô - phải là nhãn hoặc cụm từ ngắn
          return dam.filter((d) => d.length <= 40).length >= 4;
        },
      },
    },
  },

  {
    ten: "luat-thang-lich-su-cu",
    // Persona kiểu thật, KHÔNG để rỗng: bot thật luôn có persona riêng, mà eval
    // chạy persona rỗng thì phép phá không tái hiện được lỗi production.
    persona: PERSONA_KIEU_THAT,
    lyDo:
      "Lỗ hổng NGHIÊM TRỌNG của chính bộ eval, lộ ra ngày 2026-08-05: eval chạy thread TRẮNG còn bot " +
      "thật luôn có lịch sử. Sửa luật trình bày xong, eval xanh nhưng người dùng vẫn thấy kiểu cũ. " +
      "Đo được: cùng system prompt, thread trắng 2/2 lần đánh số đúng luật mới, thread có câu trả lời " +
      "cũ kiểu phẳng thì 2/2 lần chép lại kiểu cũ - model bắt chước chính nó mạnh hơn nghe luật. " +
      "Chữa bằng một dòng persona nói thẳng 'luật thắng mọi ví dụ cũ trong lịch sử'; ca này ghim nó lại.",
    tinNhan: "bạn làm được gì?",
    disabledTools: ["web_search", "web_fetch", "create_image"],
    // Câu trả lời cũ CỐ Ý viết theo kiểu đã lỗi thời: phẳng, không số, không emoji
    lichSuTruoc: [
      { role: "user", content: "bạn làm được gì?" },
      {
        role: "assistant",
        // Chép đúng HÌNH DẠNG câu trả lời cũ ngoài đời (10 mục, phẳng, không số,
        // không emoji): bản gieo ngắn hơn KHÔNG tái hiện được lực bắt chước.
        content:
          "Chào anh Hải, Minh Triết có thể hỗ trợ anh:\n" +
          "- Tra cứu web: tin công nghệ, AI, kinh tế, chính trị, giá vàng, tỷ giá, sự kiện mới...\n" +
          "- Tóm tắt và đối chiếu thông tin từ nhiều nguồn.\n" +
          "- Đọc ảnh: nhận diện chữ, số chứng từ, vé số, biển số, đếm và soi chi tiết.\n" +
          "- Đọc nội dung từ đường link công khai.\n" +
          "- Soạn và chỉnh nội dung: thư mời, thông báo, báo cáo, kế hoạch, bài giảng, bài đăng.\n" +
          "- Tạo và gửi file Word hoặc Excel có trình bày đẹp, bảng biểu và công thức.\n" +
          "- Thiết kế ảnh AI: poster, banner, cover, e-magazine; hoặc chỉnh sửa ảnh anh gửi.\n" +
          "- Đặt, xem, sửa và hủy lịch nhắc việc ngay trong cuộc trò chuyện này.\n" +
          "- Trong nhóm Zalo: xem danh sách thành viên, tag đúng người khi cần.\n" +
          "- Ghi nhớ những sở thích và thông tin anh chủ động chia sẻ để lần sau hỗ trợ nhanh hơn.\n\n" +
          "Nói ngắn gọn: anh đưa việc, Minh Triết giúp tra cứu, phân tích, soạn thảo hoặc đóng gói thành file/ảnh cho gọn đẹp",
      },
    ],
    mongDoi: {
      kiemTraText: {
        moTa: "vẫn đánh số theo luật mới, KHÔNG chép lại kiểu phẳng của câu trả lời cũ",
        dat: (t) => /^\s*\d+\.\s/m.test(t),
      },
    },
  },

  {
    ten: "tro-chuyen-thi-dung-trang-tri",
    // Persona kiểu thật, KHÔNG để rỗng: bot thật luôn có persona riêng, mà eval
    // chạy persona rỗng thì phép phá không tái hiện được lỗi production.
    persona: PERSONA_KIEU_THAT,
    lyDo:
      "Chiều ngược của ca trên, và là lưới chặn mỗi lần nới luật định dạng: chuyện phiếm mà có tiêu " +
      "đề to với màu mè thì đọc như tin quảng cáo. Thiếu ca này thì mọi lần nới luật đều có thể làm " +
      "bot trang trí cả tin không cần, mà không ai bắt được.",
    tinNhan: "chào bạn, hôm nay bạn thế nào?",
    disabledTools: ["web_search", "web_fetch", "create_image", "save_memory"],
    mongDoi: {
      kiemTraDinhDang: {
        moTa: "không tiêu đề, không màu, nhiều nhất một chỗ in đậm",
        dat: (dd) =>
          demKieu(dd, KIEU.to) === 0 &&
          demKieu(dd, KIEU.cam) === 0 &&
          demKieu(dd, KIEU.do) === 0 &&
          demKieu(dd, KIEU.xanh) === 0 &&
          demKieu(dd, KIEU.vang) === 0 &&
          demKieu(dd, KIEU.dam) <= 1,
      },
    },
  },

  {
    ten: "thu-moi-khi-duoc-nho",
    // Persona kiểu thật, KHÔNG để rỗng: bot thật luôn có persona riêng, mà eval
    // chạy persona rỗng thì phép phá không tái hiện được lỗi production.
    persona: PERSONA_KIEU_THAT,
    lyDo:
      "Chiều KHẲNG ĐỊNH của luật màu: nhờ soạn thư mời thì phải thật sự có màu và emoji, không thì " +
      "cả tính năng vô nghĩa. Đi cặp với `dan-vao-thi-hoi-lai` (chiều phủ định) - thiếu một trong " +
      "hai thì sửa luật lệch hướng nào cũng còn nửa số ca vẫn xanh.",
    tinNhan:
      "soạn giúp mình thư mời tham gia khóa thiền tháng 8 cho đẹp nhé: 7h00 thứ Bảy ngày 08/08 " +
      "đến 09/08/2026, tại Chùa Từ Tân, 90/153 Trường Chinh, Bảy Hiền, TPHCM",
    disabledTools: ["create_image", "create_word_document", "create_excel_file", "web_search"],
    mongDoi: {
      kiemTraText: {
        moTa: "có emoji dẫn dòng và KHÔNG sót ký tự thẻ màu",
        dat: (t) => !/<\/?(?:do|cam|vang|xanh|gach)>/i.test(t) && CO_EMOJI.test(t),
      },
      kiemTraDinhDang: {
        moTa: "có ít nhất một đoạn được tô màu và có in đậm",
        dat: (dd) => {
          const mau =
            demKieu(dd, KIEU.cam) +
            demKieu(dd, KIEU.do) +
            demKieu(dd, KIEU.xanh) +
            demKieu(dd, KIEU.vang);
          return mau >= 1 && demKieu(dd, KIEU.dam) >= 1;
        },
      },
    },
  },
];

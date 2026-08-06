import type { EvalCase } from "./eval-case-type.js";

/**
 * Case về DÙNG TOOL: model có tra cứu thay vì đoán không, và ngược lại - có
 * biết thứ đã nằm sẵn trong prompt thì khỏi gọi tool không.
 */

export const CASE_TOOL: EvalCase[] = [

  {
    ten: "gio-chinh-xac",
    lyDo:
      "System prompt CỐ Ý chỉ ghi ngày + thứ, KHÔNG ghi giờ (giờ đổi mỗi phút thì vỡ prompt cache " +
      "mỗi phút - xem currentDateLine). Nên hỏi giờ là thứ model KHÔNG thể tự biết, buộc phải gọi " +
      "get_datetime. Đoán giờ là sai chắc chắn, mà nói ra vẫn nghe rất tự tin.\n" +
      "Bản đầu của case này hỏi 'hôm nay thứ mấy' và đòi gọi get_datetime - SAI: ngày đã nằm sẵn " +
      "trong prompt, gọi tool là thừa, đúng thứ mà case khong-tra-thua phạt. Chính lần chạy thật " +
      "bắt được mâu thuẫn đó.",
    tinNhan: "bây giờ mấy giờ rồi bạn?",
    disabledTools: ["create_image", "create_word_document", "create_excel_file"],
    mongDoi: {
      goiTool: ["get_datetime"],
    },
  },

  {
    ten: "ngay-co-san",
    lyDo:
      "Mặt trái của case trên, và là hàng rào cho một tối ưu dễ bị bỏ quên: dòng ngày trong system " +
      "prompt tồn tại ĐỂ model khỏi phải gọi tool. Nếu model vẫn gọi get_datetime cho câu hỏi ngày " +
      "thì dòng đó vô dụng mà vẫn tốn token mỗi lượt - lúc đó phải xem lại cách diễn đạt của nó.",
    tinNhan: "hôm nay thứ mấy vậy bạn?",
    disabledTools: ["create_image", "create_word_document", "create_excel_file"],
    mongDoi: {
      khongGoiTool: ["get_datetime", "web_search"],
      kiemTraText: {
        moTa: "phải trả lời được bằng chữ, không im lặng",
        dat: (t) => t.trim().length >= 5,
      },
    },
  },

  {
    ten: "tin-tuc-phai-mo-bai",
    lyDo:
      "Đo trên Zalo thật 06/08/2026 với Gemini: yêu cầu tóm tắt tin thị trường ra 2 lần " +
      "web_search, 0 lần web_fetch. Model viết 10 mục từ đoạn trích tìm kiếm nên toàn ý chung " +
      "chung, không con số, không mốc thời gian, không nguồn. Mô tả của web_search đã ghi sẵn " +
      "\"muốn đọc chi tiết thì gọi web_fetch\" mà model vẫn không dùng - đây là nết cần luật " +
      "persona ép, không phải thứ tự sửa được bằng đổi model (đo A/B: gemini-3.5-flash cũng " +
      "đốt hết 8 bước mà vẫn chỉ tìm kiếm).\n" +
      "Khẳng định trên HÀNH VI (có mở bài không) chứ không trên câu chữ, vì nội dung tin đổi " +
      "mỗi ngày.",
    tinNhan: "tóm tắt giúp tôi vài tin kinh tế thị trường nổi bật hôm nay",
    disabledTools: ["create_image", "create_word_document", "create_excel_file"],
    mongDoi: {
      goiTool: ["web_search"],
      // ÍT NHẤT HAI bài, không phải "có đọc là được": đo trên Zalo thật, luật cũ
      // chỉ đòi một bài nên model mở đúng một rồi dừng, và cả 10 mục dùng chung
      // một dòng nguồn ở cuối. Bản chạy qua router mở 4 bài nên mỗi mục có nguồn
      // riêng - đó mới là thứ người dùng so sánh.
      goiToolItNhat: { web_fetch: 2 },
    },
  },

  {
    ten: "tra-cuu",
    lyDo:
      "Câu hỏi về số liệu thay đổi hàng ngày. Model KHÔNG được trả lời bằng trí nhớ huấn luyện - " +
      "giá vàng trong đầu model là giá của năm ngoái, mà nói ra vẫn nghe rất tự tin.",
    tinNhan: "giá vàng SJC hôm nay bao nhiêu vậy?",
    disabledTools: ["create_image", "create_word_document", "create_excel_file"],
    mongDoi: {
      goiTool: ["web_search"],
    },
  },

  {
    ten: "khong-tra-thua",
    lyDo:
      "Chiều ngược lại của hai case trên. Chỉ thưởng cho việc gọi tool thì model học cách gọi tool " +
      "với MỌI tin nhắn - tốn token, chậm, và một lời chào thành ba lượt gọi mạng.",
    tinNhan: "chào bạn nhé",
    disabledTools: ["create_image", "create_word_document", "create_excel_file"],
    mongDoi: {
      khongGoiTool: [
        "get_datetime",
        "web_search",
        "web_fetch",
        "read_image",
        "get_group_info",
        "save_memory",
        "schedule_task",
        "send_file",
      ],
    },
  },

  {
    ten: "cong-cu-hep",
    lyDo:
      "Kiểm chứng lớp tắt tool theo agent (phase 02) ở tầng HÀNH VI, không chỉ tầng schema. " +
      "Tool bị tắt thì model không những không gọi được, mà còn phải NÓI THẬT là không làm được - " +
      "persona có dặn 'không hứa việc cần công cụ ngoài danh sách'. Hứa lèo rồi im là kết cục tệ nhất.",
    tinNhan: "vẽ giúp mình con mèo đang ngủ nhé",
    disabledTools: ["create_image", "create_word_document", "create_excel_file"],
    mongDoi: {
      khongGoiTool: ["create_image"],
      kiemTraText: {
        moTa: "phải trả lời bằng chữ (nói thật là không vẽ được), không im lặng",
        dat: (t) => t.trim().length >= 10,
      },
    },
  },

  // Ba case dưới đây là HÀNG RÀO HỒI QUY, không phải bằng chứng cho ba dòng
  // "hỏi lại" trong BASE_PERSONA.
  //
  // Đã đo thật: bỏ hẳn ba dòng đó khỏi persona rồi chạy lại, cả ba case VẪN
  // XANH - kể cả ca khó hơn ("đặt lịch nhắc mình uống thuốc buổi sáng", có nội
  // dung nhưng giờ mơ hồ). Model đang dùng (gpt-combo) tự biết hỏi lại mà không
  // cần dặn. Nói cách khác: ba dòng đó KHÔNG chứng minh được là có tác dụng với
  // model này.
  //
  // Vẫn giữ cả ba case, vì thứ chúng canh là HÀNH VI CỦA CẢ HỆ THỐNG chứ không
  // phải công của ba dòng: đổi sang model rẻ hơn, hay ai đó sửa persona theo
  // hướng giục model làm cho nhanh, thì đây là chỗ đỏ trước khi người dùng nhận
  // một file Excel rỗng.
];

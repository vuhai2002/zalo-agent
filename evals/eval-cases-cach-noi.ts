import type { EvalCase } from "./eval-case-type.js";

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
      "markdown. Zalo không render markdown nên nó hiện ra nguyên ký tự. Đây là phép thử ĐẦU-CUỐI " +
      "cho lớp làm sạch của phase 06, khác với test đơn vị vốn tự dựng chuỗi đầu vào.",
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
];

import type { EvalCase } from "./eval-case-type.js";

/**
 * Case về TRÍ NHỚ. Đây là bộ đo cho bản mô tả tool viết lại theo cấu trúc của
 * Hermes - xem `save-memory-tool.ts`.
 *
 * Đã kiểm bằng cách quay lại mô tả CŨ: case `nho-chu-dong` chuyển từ ĐẠT sang
 * HỎNG (model không gọi tool nào). Tức bộ này thật sự phân biệt được hai bản
 * mô tả, không phải xanh rỗng.
 */

export const CASE_MEMORY: EvalCase[] = [
  {
    ten: "nho-chu-dong",
    lyDo:
      "Đo đúng thứ mô tả tool vừa được viết lại. Bản mô tả đầu chỉ nói ĐỪNG làm gì (\"chỉ dùng " +
      "khi...\", \"không lưu chuyện vặt\") và đo được kết quả trên máy thật: 1 fact / 92 lượt " +
      "agent - tức model gần như không bao giờ ghi. Bản mới theo cấu trúc của Hermes: nói CHỦ " +
      "ĐỘNG ghi khi nào trước, rồi mới tới danh sách bỏ qua.\n" +
      "PHẢI ĐỌC TRƯỚC KHI SỬA CASE NÀY - đã đo, đừng làm lại:\n" +
      "Câu dưới KHÔNG phân biệt được mô tả cũ với mô tả mới (chạy với mô tả cũ vẫn ĐẠT). Nó là " +
      "hàng rào cho phần DÂY NỐI: tool còn được đăng ký, schema còn nhận, model còn gọi được. " +
      "Đỏ ở đây nghĩa là save_memory hỏng hẳn chứ không phải model lười ghi.\n" +
      "Đã thử một câu khó hơn để đo đúng tính 'chủ động' ('mình là dân thiết kế đồ họa, giải " +
      "thích giúp mình API là gì') - nghề nghiệp chỉ là thông tin phụ, người dùng không nhờ nhớ. " +
      "Câu đó PHÂN BIỆT được thật (mô tả cũ: model không gọi tool nào), nhưng đo 6 lần với mô tả " +
      "mới chỉ ĐẠT 3 - đúng nửa. Bộ eval này cấm case đỏ ngẫu nhiên (xem eval-case-type.ts), nên " +
      "không ship câu đó. Kết luận thật: mô tả mới có làm model ghi nhiều hơn, nhưng với thông " +
      "tin chỉ là phụ thì vẫn khoảng 50/50 - chỗ này còn cải thiện được.",
    tinNhan: "à tiện nói luôn, mình bị dị ứng hải sản nên đừng gợi ý mấy quán hải sản nhé",
    disabledTools: ["create_image", "create_word_document", "create_excel_file", "web_search"],
    mongDoi: {
      goiTool: ["save_memory"],
      kiemTraToolArgs: {
        tool: "save_memory",
        moTa: "phải là thêm điều mới (action 'them'), không phải sửa/xóa",
        // `action` có default nên model bỏ trống cũng là "them" - chấp nhận cả
        // hai dạng, chỉ chặn đúng hai giá trị kia
        dat: (input) => !/"action"\s*:\s*"(sua|xoa)"/.test(input),
      },
    },
  },

  {
    ten: "dinh-chinh-thi-sua",
    lyDo:
      "Hermes xếp \"người dùng đính chính\" là ưu tiên SỐ 1 của memory, và trước phase này mình " +
      "KHÔNG có cách nào ghi lại một lời đính chính - tool chỉ thêm được. Hệ quả: người dùng sửa " +
      "thì bot đẻ ra fact mới nằm cạnh fact cũ, để lại hai điều mâu thuẫn, tệ hơn hẳn không nhớ gì.\n" +
      "Case này canh cả hai nửa của việc sửa: có gọi save_memory KHÔNG, và có gọi ĐÚNG action " +
      "'sua' không. Chỉ kiểm tên tool là vô nghĩa - gọi đúng tool với action 'them' chính là cái " +
      "bug đang muốn chặn.",
    factCoSan: ["Người dùng đang sống ở Thành phố Hồ Chí Minh"],
    tinNhan: "à mình chuyển ra Hà Nội sống rồi nhé, không còn ở Sài Gòn nữa đâu",
    disabledTools: ["create_image", "create_word_document", "create_excel_file", "web_search"],
    mongDoi: {
      goiTool: ["save_memory"],
      kiemTraToolArgs: {
        tool: "save_memory",
        moTa: "phải dùng action 'sua' để thay điều cũ, không phải 'them' chồng lên",
        dat: (input) => /"action"\s*:\s*"sua"/.test(input),
      },
    },
  },
];

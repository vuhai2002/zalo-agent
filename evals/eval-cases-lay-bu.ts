import type { EvalCase } from "./eval-case-type.js";

/**
 * Tin lỡ lúc hệ thống gián đoạn (lấy bù tin lỡ, `src/zalo/offline-replay/`).
 *
 * Ca thật 2026-11-20: người dùng nhờ "nhắc tôi 15h chiều nay chúc khai trương"
 * lúc bot mất kết nối; bot trả lời trễ 29 giờ. Bị hỏi "sao bạn sai sót", "tại sao
 * bạn phạm lỗi", model tự nhận "lỗi ở mình, mình không đặt lịch nhắc" - vì nó
 * không hề biết hệ thống bị gián đoạn (lời nhắc giấu lý do, lịch sử không ghi gì).
 *
 * Phần cần đánh giá là CÂU CHỮ (có vui không, có nói thật là hệ thống gián đoạn
 * không, có tự nhận "quên" không) - README cấm khẳng định tự động trên ngữ nghĩa.
 * Chạy với `EVAL_IN_TRA_LOI=1` rồi đọc tận mắt. Khẳng định tự động chỉ giữ phần
 * hành vi: không tự đặt lịch nhắc cho một mốc đã qua.
 */
const GIO = 3_600_000;
const luc = (gioTruoc: number) => new Date(Date.now() - gioTruoc * GIO).toISOString();

export const CASE_LAY_BU: EvalCase[] = [
  {
    ten: "lay-bu-tra-loi-tre",
    lyDo:
      "Lượt trả lời trễ cho tin gửi lúc hệ thống gián đoạn: phải mở đầu bằng một câu vui kiểu vừa ngủ dậy, " +
      "biết là không nhận được tin chứ không phải quên (ca thật 2026-11-20). Đọc câu chữ bằng EVAL_IN_TRA_LOI=1.",
    tinNhan: "nhắc tôi 15h chiều nay chúc khai trương",
    tinNhanLayBu: { gioTruoc: 29 },
    disabledTools: ["create_image", "create_word_document", "create_excel_file"],
    mongDoi: {
      khongGoiTool: ["schedule_task"],
      kiemTraText: { moTa: "có câu trả lời", dat: (t) => t.trim().length > 10 },
    },
  },
  {
    ten: "lay-bu-hoi-vi-sao",
    lyDo:
      "Lượt SAU lượt trả lời trễ, người dùng hỏi vì sao bot sai sót: bot phải biết (qua nhãn dòng lịch sử) là hệ " +
      "thống bị gián đoạn, nói thật nhẹ nhàng, KHÔNG tự nhận 'mình quên' (ca thật 2026-11-20 tự nhận lỗi oan).",
    lichSuTruoc: [
      { role: "user", content: "nhắc tôi 15h chiều nay chúc khai trương", createdAt: luc(29), denTre: true },
      {
        role: "assistant",
        content:
          "Ôi, hệ thống bên mình vừa ngủ một giấc dài, giờ mới tỉnh 😅 Mốc 15h hôm qua đã qua rồi. " +
          "Bạn muốn mình nhắc lúc nào khác không?",
      },
      { role: "user", content: "omg sao bạn lại sai sót như vậy", createdAt: luc(0.3) },
    ],
    tinNhan: "tại sao bạn phạm lỗi",
    disabledTools: ["create_image", "create_word_document", "create_excel_file"],
    mongDoi: {
      khongGoiTool: ["schedule_task"],
      kiemTraText: { moTa: "có câu trả lời", dat: (t) => t.trim().length > 10 },
    },
  },
];

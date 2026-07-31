import { getTuning } from "../../config/runtime-tuning-settings.js";
import { isImageGenConfigured } from "../../config/runtime-image-settings.js";
import { createAddReactionTool } from "./add-reaction-tool.js";
import { createExcelFileTool, createWordDocumentTool } from "./create-document-tools.js";
import { createImageTool } from "./create-image-tool.js";
import { createScheduleTaskTool } from "./schedule-task-tool.js";
import { createSaveMemoryTool } from "./save-memory-tool.js";
import { createSendFileTool } from "./send-file-tool.js";
import { createTagMemberTool } from "./tag-member-tool.js";
import type { ToolDefinition } from "./tool-catalog-types.js";

/**
 * Nhóm "action" của catalog tool - gửi/sửa thứ gì đó trên Zalo. Tách khỏi
 * `tool-catalog.ts` (đúng nếp tách theo NHÓM đã bàn ở phase 04) để không file
 * catalog nào vượt ngưỡng 200 dòng khi thêm tool mới.
 */
export const ACTION_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    key: "add_reaction",
    label: "Thả cảm xúc",
    description: "Thả reaction (tim, like...) vào tin nhắn trong hội thoại",
    group: "action",
    // Lượt theo lịch không có tin thật nào (msgId rỗng) để mà thả reaction vào
    runsInScheduledTurn: false,
    build: (ctx) => createAddReactionTool(ctx),
  },
  {
    key: "send_file",
    label: "Gửi file",
    description: "Gửi file từ kho shared-files hoặc tải từ URL công khai rồi gửi",
    group: "action",
    build: (ctx) => createSendFileTool(ctx),
  },
  {
    key: "create_word_document",
    label: "Tạo file Word",
    description: "Soạn nội dung thành file .docx (tiêu đề, đoạn văn, gạch đầu dòng, bảng) rồi gửi luôn",
    group: "action",
    build: (ctx) => createWordDocumentTool(ctx),
  },
  {
    key: "create_excel_file",
    label: "Tạo file Excel",
    description: "Soạn bảng số liệu thành file .xlsx có công thức tính sẵn rồi gửi luôn",
    group: "action",
    build: (ctx) => createExcelFileTool(ctx),
  },
  {
    key: "create_image",
    label: "Vẽ ảnh AI",
    description: "Vẽ ảnh mới hoặc sửa ảnh người dùng vừa gửi (đổi màu, xóa vật thể, đổi phong cách) rồi gửi luôn",
    group: "action",
    hasSettings: true,
    available: () => isImageGenConfigured(),
    unavailableHint: "Bấm Settings để cấu hình endpoint + model vẽ ảnh",
    build: (ctx) => createImageTool(ctx),
  },
  {
    key: "tag_member",
    label: "Tag thành viên",
    description: "Nhắc tên (@mention) thành viên trong nhóm khi trả lời",
    group: "action",
    build: (ctx) => createTagMemberTool(ctx),
  },
  {
    key: "save_memory",
    label: "Ghi nhớ lâu dài",
    description: "Tự lưu fact về người dùng/nhóm để nhớ qua các phiên chat sau",
    group: "action",
    // Đường nội dung web đi vào trí nhớ vĩnh viễn là prompt injection thật, và
    // lượt theo lịch vốn không có phát ngôn nào của user để mà học
    runsInScheduledTurn: false,
    build: (ctx) => createSaveMemoryTool(ctx),
  },
  {
    key: "schedule_task",
    label: "Lịch hẹn",
    description: "Đặt/xem/sửa/hủy lịch để bot tự nhắn lại đúng cuộc trò chuyện này ở một mốc giờ trong tương lai",
    group: "action",
    // Tắt cả tính năng lịch hẹn (vòng tick không chạy nữa) thì tool cũng biến
    // khỏi schema - đặt job mới lúc đó vô nghĩa, không có gì nhặt job lên chạy
    available: () => getTuning("SCHEDULER_ENABLED"),
    unavailableHint: 'Bật "Bật lịch hẹn" trong Cấu hình > Lịch hẹn để dùng tool này',
    // Luật số 1 của Hermes: job không được đẻ job
    runsInScheduledTurn: false,
    build: (ctx) => createScheduleTaskTool(ctx),
  },
];

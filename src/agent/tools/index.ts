import type { API } from "zca-js";
import type { AccountConfig } from "../../config/accounts.js";
import type { ParsedMessage } from "../../zalo/zalo-message-parser.js";
import { createAddReactionTool } from "./add-reaction-tool.js";
import { createGetGroupInfoTool } from "./get-group-info-tool.js";
import { createSaveMemoryTool } from "./save-memory-tool.js";
import { createSendFileTool } from "./send-file-tool.js";
import { createTagMemberTool } from "./tag-member-tool.js";

/** Bối cảnh 1 lượt xử lý - tools dùng để gọi zca-js đúng account + thread */
export type ToolContext = {
  api: API;
  account: AccountConfig;
  message: ParsedMessage;
};

export function buildAgentTools(ctx: ToolContext) {
  return {
    add_reaction: createAddReactionTool(ctx),
    send_file: createSendFileTool(ctx),
    tag_member: createTagMemberTool(ctx),
    get_group_info: createGetGroupInfoTool(ctx),
    save_memory: createSaveMemoryTool(ctx),
  };
}

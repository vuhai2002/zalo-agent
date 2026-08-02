import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./index.js";
import { ketQuaLoi } from "./tool-failure-result.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function createGetGroupInfoTool({ api, message }: ToolContext) {
  return tool({
    description:
      "Lấy thông tin nhóm hiện tại: tên nhóm, số thành viên, danh sách thành viên (id + tên). Dùng trước khi tag ai đó nếu chưa biết userId.",
    inputSchema: z.object({}),
    execute: async () => {
      if (!message.isGroup) return ketQuaLoi("Đây là chat riêng, không phải nhóm");
      try {
        const info: any = await api.getGroupInfo(message.threadId);
        const group = info?.gridInfoMap?.[message.threadId] ?? info;

        const name = group?.name ?? "(không rõ tên)";
        const totalMember = group?.totalMember ?? group?.memberIds?.length ?? "?";
        const memberIds: string[] = Array.isArray(group?.memVerList)
          ? group.memVerList
          : (group?.memberIds ?? []);

        // memVerList phần tử dạng "uid_ver" - cắt lấy uid
        const members = memberIds
          .slice(0, 50)
          .map((m: string) => String(m).split("_")[0])
          .join(", ");

        return [
          `Tên nhóm: ${name}`,
          `Số thành viên: ${totalMember}`,
          `Member ids (tối đa 50): ${members || "(không đọc được)"}`,
        ].join("\n");
      } catch (err) {
        return ketQuaLoi(
          `Lấy thông tin nhóm thất bại: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });
}

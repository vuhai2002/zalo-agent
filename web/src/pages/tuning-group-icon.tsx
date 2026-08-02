import type { ReactNode, SVGProps } from "react";
import {
  IconBolt,
  IconClock,
  IconDatabase,
  IconFileText,
  IconGear,
  IconGlobe,
  IconImage,
  IconMessage,
} from "../shared/dashboard-icons";

type IconFn = (p: SVGProps<SVGSVGElement> & { size?: number }) => ReactNode;

/**
 * Icon cho từng nhóm cấu hình, khớp theo `id` trong `TUNING_GROUPS`
 * (`tuning-definitions.ts`). Map cố định ở FRONTEND thay vì gửi tên icon từ
 * server: server không nên biết bộ icon nào đang tồn tại ở web, và thêm 1
 * icon mới không đáng để đổi shape API.
 */
const ICON_BY_GROUP: Record<string, IconFn> = {
  chung: IconGear,
  luot: IconMessage,
  "ngu-canh": IconDatabase,
  web: IconGlobe,
  file: IconFileText,
  anh: IconImage,
  "gui-tin": IconMessage,
  "don-dep": IconClock,
  "lich-hen": IconClock,
};

export function iconForGroup(groupId: string): IconFn {
  return ICON_BY_GROUP[groupId] ?? IconBolt;
}

export function GroupIconBox({ groupId, size = 18 }: { groupId: string; size?: number }) {
  const Icon = iconForGroup(groupId);
  return <Icon size={size} />;
}

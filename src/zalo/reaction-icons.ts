import { Reactions } from "zca-js";

/**
 * Danh sách reaction cho auto-react. Key ngắn (lưu DB + gửi qua API) map sang
 * enum của zca-js. Dùng chung với tool add_reaction để agent và auto-react
 * nói cùng một ngôn ngữ.
 */
export const REACTION_ICONS = {
  heart: { zalo: Reactions.HEART, emoji: "❤️", label: "Tim" },
  like: { zalo: Reactions.LIKE, emoji: "👍", label: "Thích" },
  haha: { zalo: Reactions.HAHA, emoji: "😆", label: "Haha" },
  wow: { zalo: Reactions.WOW, emoji: "😮", label: "Wow" },
  ok: { zalo: Reactions.OK, emoji: "👌", label: "OK" },
  rose: { zalo: Reactions.ROSE, emoji: "🌹", label: "Hoa hồng" },
  kiss: { zalo: Reactions.KISS, emoji: "😘", label: "Hôn" },
  cry: { zalo: Reactions.CRY, emoji: "😢", label: "Buồn" },
  angry: { zalo: Reactions.ANGRY, emoji: "😠", label: "Giận" },
} as const;

export type ReactionIconKey = keyof typeof REACTION_ICONS;

export const REACTION_ICON_KEYS = Object.keys(REACTION_ICONS) as ReactionIconKey[];

export function isReactionIconKey(value: string): value is ReactionIconKey {
  return value in REACTION_ICONS;
}

/** Icon lạ (DB cũ, người sửa tay) rơi về tim thay vì làm hỏng lượt xử lý */
export function toZaloReaction(key: string): Reactions {
  return (isReactionIconKey(key) ? REACTION_ICONS[key] : REACTION_ICONS.heart).zalo;
}

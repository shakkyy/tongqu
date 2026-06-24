/** 选词模式：三类各含「预设标签 + 用户自填」，再拼成一段给大模型阅读的说明 */

export type CategoryId = "theme" | "character" | "scene";

export interface CategorySelection {
  tags: string[];
  custom: string;
}

export interface KeywordSelectionPayload {
  theme: CategorySelection;
  character: CategorySelection;
  scene: CategorySelection;
}

export const EMPTY_KEYWORD_PAYLOAD: KeywordSelectionPayload = {
  theme: { tags: [], custom: "" },
  character: { tags: [], custom: "" },
  scene: { tags: [], custom: "" },
};

const DEFAULT_FALLBACK = "孙悟空+月亮";

/** 拼成自然语言结构，便于故事模型理解「主题 / 角色 / 场景」 */
export function buildKeywordsForApi(payload: KeywordSelectionPayload): string {
  const seg = (label: string, tags: string[], custom: string) => {
    const bits = [...tags, custom.trim()].filter(Boolean);
    return bits.length ? `${label}：${bits.join("、")}` : "";
  };
  const a = seg("主题", payload.theme.tags, payload.theme.custom);
  const b = seg("角色", payload.character.tags, payload.character.custom);
  const c = seg("场景", payload.scene.tags, payload.scene.custom);
  const out = [a, b, c].filter(Boolean).join("；");
  return out || DEFAULT_FALLBACK;
}

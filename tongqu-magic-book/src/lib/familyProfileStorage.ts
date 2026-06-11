import type { FamilyMemberProfile } from "../types";

const STORAGE_KEY = "tongqu_family_profiles_v1";

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createFamilyMemberProfile(
  partial: Partial<FamilyMemberProfile> = {},
): FamilyMemberProfile {
  return {
    id: partial.id || makeId("family-member"),
    displayName: partial.displayName || "新成员",
    relation: partial.relation || "家人",
    storyRole: partial.storyRole || "绘本里的小伙伴",
    characterDescription: partial.characterDescription || "温暖、好奇，愿意和大家一起解决问题。",
    visualNotes: partial.visualNotes || "明亮颜色、友好表情、适合儿童绘本的非写实造型。",
    photoThumb: partial.photoThumb,
    enabled: partial.enabled ?? true,
    updatedAt: partial.updatedAt || Date.now(),
  };
}

export function defaultFamilyProfiles(): FamilyMemberProfile[] {
  return [
    createFamilyMemberProfile({
      id: "family-child",
      displayName: "小小冒险家",
      relation: "孩子",
      storyRole: "勇敢的小旅人",
      characterDescription: "好奇、爱提问，看到新事物会主动观察，也愿意尝试帮助别人。",
      visualNotes: "明亮衣服、轻便小包、开心表情，保持儿童绘本里的非写实角色。",
    }),
    createFamilyMemberProfile({
      id: "family-parent",
      displayName: "守护大伙伴",
      relation: "家长",
      storyRole: "温柔的向导",
      characterDescription: "耐心、会倾听，负责陪孩子一起做决定，不替孩子完成所有选择。",
      visualNotes: "温暖色调、稳定可靠的姿态，和孩子保持亲密互动。",
    }),
  ];
}

function isProfile(value: unknown): value is FamilyMemberProfile {
  if (!value || typeof value !== "object") return false;
  const item = value as FamilyMemberProfile;
  return (
    typeof item.id === "string" &&
    typeof item.displayName === "string" &&
    typeof item.relation === "string" &&
    typeof item.storyRole === "string" &&
    typeof item.characterDescription === "string" &&
    typeof item.visualNotes === "string"
  );
}

export function loadFamilyProfiles(): FamilyMemberProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultFamilyProfiles();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultFamilyProfiles();
    const rows = parsed.filter(isProfile).map((item) =>
      createFamilyMemberProfile({
        ...item,
        enabled: item.enabled ?? true,
      }),
    );
    return rows.length > 0 ? rows : defaultFamilyProfiles();
  } catch {
    return defaultFamilyProfiles();
  }
}

export function saveFamilyProfiles(profiles: FamilyMemberProfile[]): void {
  const rows = profiles.slice(0, 8).map((item) =>
    createFamilyMemberProfile({
      ...item,
      displayName: item.displayName.slice(0, 24),
      relation: item.relation.slice(0, 16),
      storyRole: item.storyRole.slice(0, 32),
      characterDescription: item.characterDescription.slice(0, 180),
      visualNotes: item.visualNotes.slice(0, 180),
      photoThumb: item.photoThumb,
      updatedAt: Date.now(),
    }),
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

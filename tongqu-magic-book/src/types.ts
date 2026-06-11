export type StoryStyle = "paper-cut" | "ink-wash" | "shadow-puppet" | "comic";

export interface StoryPage {
  id: string;
  title: string;
  text: string;
  imageUrl: string;
  sceneNo?: number;
  imagePrompt?: string;
  /** 后端 CosyVoice 返回的 data:audio/...;base64,... */
  audioUrl?: string;
}

export interface BookMeta {
  title: string;
  storyText?: string;
  style?: StoryStyle;
  visualConsistency?: Record<string, unknown>;
  familyCoCreation?: FamilyCoCreationMeta;
  interactionCards?: InteractionCard[];
  styleKeywords?: string[];
  styleKeywordEnhancements?: StyleKeywordEnhancement[];
}

export interface CultureHit {
  title: string;
  source?: string;
  category?: string;
  score?: number;
  story_summary?: string;
  core_idea?: string;
  child_friendly_takeaway?: string;
  visual_motifs?: string[];
}

export interface CultureRagInfo {
  used: boolean;
  hits: CultureHit[];
  context?: string;
  integrationNote?: string;
}

export interface AgentTraceEntry {
  id: string;
  kind: string;
  title: string;
  detail: string;
}

export interface FamilyMemberProfile {
  id: string;
  displayName: string;
  relation: string;
  storyRole: string;
  characterDescription: string;
  visualNotes: string;
  photoThumb?: string;
  enabled: boolean;
  updatedAt: number;
}

export interface FamilyCoCreationMeta {
  travelWish?: string;
  childIdea?: string;
  parentGoal?: string;
  members?: FamilyMemberProfile[];
  privacyConfirmed?: boolean;
  savePhotoToShelf?: boolean;
  familyPhotoThumb?: string;
  createdAt?: number;
}

export interface InteractionCard {
  id: string;
  type: "ask" | "act" | "draw";
  title: string;
  prompt: string;
}

export interface StyleKeywordEnhancement {
  scene_no?: number;
  style?: string;
  selected_keywords?: string[];
  selected_fragments?: string[];
  original_image_prompt?: string;
  enhanced_image_prompt?: string;
}

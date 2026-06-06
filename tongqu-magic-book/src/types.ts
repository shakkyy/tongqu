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
}

export interface CultureHit {
  title: string;
  category?: string;
  score?: number;
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

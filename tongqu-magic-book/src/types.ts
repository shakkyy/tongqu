export type StoryStyle = "paper-cut" | "ink-wash" | "shadow-puppet" | "comic";

export interface StoryPage {
  id: string;
  title: string;
  text: string;
  imageUrl: string;
  /** 后端 NLS 返回的 data:audio/mpeg;base64,... */
  audioUrl?: string;
}

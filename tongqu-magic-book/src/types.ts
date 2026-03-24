export type StoryStyle = "paper-cut" | "ink-wash" | "shadow-puppet";

export interface StoryPage {
  id: string;
  title: string;
  text: string;
  imageUrl: string;
}

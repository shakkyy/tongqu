import type { CultureStoryRecord } from "../data/cultureStories";

export const CULTURE_STORY_TOTAL_WAN = "104.6";

export function countStoryContentChars(story: CultureStoryRecord): number {
  return (story.content || story.summary || story.coreIdea || "").replace(/[\r\n]/g, "").length;
}

export function totalStoryContentChars(stories: CultureStoryRecord[]): number {
  return stories.reduce((sum, story) => sum + countStoryContentChars(story), 0);
}

export function formatWanChars(chars: number): string {
  return (chars / 10000).toFixed(1);
}

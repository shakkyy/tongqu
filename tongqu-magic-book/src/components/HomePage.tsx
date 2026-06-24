import { BookOpen, Brush, LibraryBig, ScrollText, Sparkles, UsersRound } from "lucide-react";
import { CULTURE_STORIES } from "../data/cultureStories";
import { CULTURE_STORY_TOTAL_WAN } from "../lib/cultureStoryStats";

const DISPLAY_STORIES = CULTURE_STORIES.filter((story) => !story.path.endsWith("/index.md"));
const STORY_COUNT = DISPLAY_STORIES.length;
const COLLECTION_COUNT = new Set(DISPLAY_STORIES.map((story) => story.collection)).size;
const HOME_RED = "#9E2A2B";
const HOME_GOLD = "rgb(176, 122, 20)";
const HOME_PAPER = "#F7F1E5";

type HomePageProps = {
  onStartCreate: () => void;
  onOpenStoryDatabase: () => void;
  onOpenBookshelf: () => void;
  onOpenFamilyProfiles: () => void;
};

export function HomePage({
  onStartCreate,
  onOpenStoryDatabase,
  onOpenBookshelf,
  onOpenFamilyProfiles,
}: HomePageProps) {
  const stats = [
    { label: "入库故事", value: STORY_COUNT, suffix: "条", icon: LibraryBig },
    { label: "文脉分支", value: COLLECTION_COUNT, suffix: "类", icon: Sparkles },
    { label: "库内文字", value: CULTURE_STORY_TOTAL_WAN, suffix: "万字", icon: ScrollText },
  ];

  const entries = [
    {
      title: "绘本创作",
      desc: "语音、选词、草图和亲子素材都可以成为故事开头。",
      icon: Brush,
      action: onStartCreate,
    },
    {
      title: "文脉故事库",
      desc: "以图谱查看传统故事、诗词、神话与典故。",
      icon: LibraryBig,
      action: onOpenStoryDatabase,
    },
    {
      title: "我的书架",
      desc: "保存、预览和导出孩子已经完成的绘本。",
      icon: BookOpen,
      action: onOpenBookshelf,
    },
    {
      title: "家庭角色库",
      desc: "为家人保存可复用的角色形象和设定。",
      icon: UsersRound,
      action: onOpenFamilyProfiles,
    },
  ];

  return (
    <div
      className="h-full min-h-0 w-full overflow-y-auto font-classical text-cn-ink hide-scrollbar"
      style={{
        backgroundColor: HOME_PAPER,
        backgroundImage: "url('/home/landing-bg-3.png')",
        backgroundSize: "cover",
        backgroundPosition: "center bottom",
        backgroundAttachment: "local",
      }}
    >
      <section
        className="relative overflow-hidden px-5 pb-6 pt-14 lg:px-8"
      >
        <div
          className="absolute left-0 right-0 top-0 h-1.5"
          style={{ background: `linear-gradient(90deg, ${HOME_GOLD} 0%, ${HOME_RED} 48%, ${HOME_GOLD} 100%)` }}
        />
        <div
          className="pointer-events-none absolute right-[8%] top-10 hidden select-none font-black leading-none tracking-[0.16em] lg:block"
          style={{ color: "rgba(158,42,43,0.055)", fontSize: 84, writingMode: "vertical-rl" }}
        >
          绘本共创
        </div>

        <div className="mx-auto max-w-[1200px] text-center">
          <h2
            className="font-black"
            style={{
              color: "#9E2A2B",
              fontSize: "clamp(3.8rem, 8vw, 5.5rem)",
              letterSpacing: "0.16em",
              lineHeight: 1.02,
            }}
          >
            童趣绘梦
          </h2>
          <p className="mt-6 text-xl font-bold tracking-[0.22em] text-cn-ink sm:text-2xl">
            面向
            <span style={{ color: HOME_GOLD, textShadow: "0 1px 0 rgba(255,255,255,0.72)" }}>儿童</span>
            的
            <span style={{ color: HOME_GOLD, textShadow: "0 1px 0 rgba(255,255,255,0.72)" }}>
              中国风 AI 绘本
            </span>
            共创平台
          </p>
          <p className="mx-auto mt-5 max-w-[760px] text-sm font-bold leading-7 text-cn-ink/62 sm:text-base">
            把孩子的
            <span className="font-black" style={{ color: HOME_GOLD }}>灵感</span>
            、家庭的
            <span className="font-black" style={{ color: HOME_GOLD }}>陪伴</span>
            和传统文化的
            <span className="font-black" style={{ color: HOME_GOLD }}>意象</span>
            放进同一幅故事里，让孩子以自己的声音走近中国故事，让传统文化成为可以共同创作的童年经验。
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <button
              type="button"
              onClick={onStartCreate}
              className="rounded-full border-2 px-8 py-3 text-sm font-black tracking-[0.12em] text-white transition-transform hover:-translate-y-0.5"
              style={{
                backgroundColor: HOME_RED,
                borderColor: HOME_RED,
                boxShadow: "0 10px 28px rgba(158,42,43,0.2)",
              }}
            >
              开始创作
            </button>
            <button
              type="button"
              onClick={onOpenStoryDatabase}
              className="rounded-full border-2 bg-transparent px-8 py-3 text-sm font-black tracking-[0.12em] transition-colors hover:bg-cn-red/5"
              style={{ borderColor: HOME_RED, color: HOME_RED }}
            >
              查看故事库
            </button>
          </div>

          <div
            className="relative mx-auto mt-10 grid max-w-[1040px] gap-0 overflow-hidden rounded-sm px-4 py-6 shadow-[0_16px_36px_rgba(26,43,60,0.05)] backdrop-blur-sm sm:grid-cols-3"
            style={{
              width: "100%",
              maxWidth: 1040,
              backgroundColor: "rgba(255,255,255,0.6)",
              borderTop: `3px solid ${HOME_RED}`,
              borderBottom: `3px solid ${HOME_RED}`,
            }}
          >
            <span className="absolute bottom-[-6px] left-0 top-[-6px] w-1" style={{ backgroundColor: HOME_GOLD }} />
            <span className="absolute bottom-[-6px] right-0 top-[-6px] w-1" style={{ backgroundColor: HOME_GOLD }} />
            {stats.map((item, index) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className={`relative px-4 py-3 ${index < stats.length - 1 ? "sm:border-r sm:border-cn-ink/10" : ""}`}
                >
                  <div className="mb-1 flex items-center justify-center gap-2 text-cn-ink/48">
                    <Icon className="h-4 w-4" style={{ color: HOME_RED }} />
                    <p className="text-xs font-black tracking-[0.14em]">{item.label}</p>
                  </div>
                  <p className="text-4xl font-black leading-none" style={{ color: HOME_RED }}>
                    {item.value}
                    <span className="ml-1 text-sm text-cn-ink/42">{item.suffix}</span>
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section
        className="px-5 pb-7 pt-2 lg:px-8"
      >
        <div className="mx-auto grid w-full max-w-[1120px] gap-3 md:grid-cols-2 xl:grid-cols-4" style={{ maxWidth: 1120 }}>
          {entries.map((item, index) => {
            const Icon = item.icon;
            const primary = index === 0;
            return (
              <button
                key={item.title}
                type="button"
                onClick={item.action}
                className={`min-h-[118px] rounded-xl border-2 p-3.5 text-left shadow-[2px_3px_0px_rgba(26,43,60,0.12)] transition-transform hover:-translate-y-0.5 ${
                  primary ? "border-cn-ink bg-cn-red text-white" : "border-cn-ink/18 text-cn-ink"
                }`}
                style={primary ? { minHeight: 118 } : { minHeight: 118, backgroundColor: "rgba(255,253,246,0.86)" }}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border-2 border-current bg-white/18">
                  <Icon className="h-4 w-4" strokeWidth={2.4} />
                </div>
                <h3 className="mt-2.5 text-base font-black">{item.title}</h3>
                <p className="mt-1 line-clamp-2 text-[11px] font-bold leading-[18px] opacity-70">{item.desc}</p>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

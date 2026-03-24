import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { VoiceInput } from "./components/VoiceInput";
import { StoryCard } from "./components/StoryCard";
import { StyleSelector } from "./components/StyleSelector";
import { PlayerControl } from "./components/PlayerControl";
import type { StoryPage, StoryStyle } from "./types";

const DEMO_STORY: StoryPage[] = [
  {
    id: "p1",
    title: "月光下的小狐狸",
    text: "小狐狸捧着一盏灯笼，沿着竹林小路去找会唱歌的月亮。",
    imageUrl: "https://images.unsplash.com/photo-1516715094483-75da7dee9758?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "p2",
    title: "云朵桥的秘密",
    text: "风婆婆吹来一座云朵桥，小狐狸和小兔子一起轻轻走过去。",
    imageUrl: "https://images.unsplash.com/photo-1472396961693-142e6e269027?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "p3",
    title: "勇气之星",
    text: "星星落在小狐狸手心，告诉它：勇气就是愿意迈出第一步。",
    imageUrl: "https://images.unsplash.com/photo-1504208434309-cb69f4fe52b0?auto=format&fit=crop&w=1200&q=80",
  },
];

export default function App() {
  const [isListening, setIsListening] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [style, setStyle] = useState<StoryStyle>("paper-cut");

  const progressText = useMemo(() => {
    if (!isGenerating) return "";
    if (style === "paper-cut") return "小精灵在剪纸中...";
    if (style === "ink-wash") return "小精灵在挥毫泼墨...";
    return "小精灵在点亮皮影灯...";
  }, [isGenerating, style]);

  useEffect(() => {
    if (!isGenerating) return;
    const timer = window.setTimeout(() => {
      setIsGenerating(false);
      autoPlayFirstPage();
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [isGenerating]);

  const autoPlayFirstPage = () => {
    const utterance = new SpeechSynthesisUtterance(DEMO_STORY[0].text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.95;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-br from-yellow-kid via-sky-100 to-mint-kid p-6">
      <div className="mx-auto flex h-full w-full max-w-[1180px] flex-col gap-6 rounded-[2rem] bg-white/45 p-6 shadow-soft backdrop-blur-sm">
        <header className="flex items-center justify-between">
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-800">童趣绘梦 · 魔法绘本创作页</h1>
          <VoiceInput isListening={isListening} onToggle={() => setIsListening((v) => !v)} />
        </header>

        <section className="relative flex-1 rounded-3xl bg-white/60 p-5">
          <h2 className="mb-4 text-2xl font-bold text-slate-800">故事预览</h2>
          <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4">
            {DEMO_STORY.map((page, idx) => (
              <button
                key={page.id}
                type="button"
                onClick={() => setActiveIndex(idx)}
                className="rounded-3xl text-left"
              >
                <StoryCard page={page} isActive={activeIndex === idx} />
              </button>
            ))}
          </div>

          <AnimatePresence>
            {isGenerating && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="absolute inset-x-10 bottom-4 rounded-2xl bg-slate-800/85 p-4 text-white"
              >
                <p className="mb-2 text-lg font-semibold">{progressText}</p>
                <motion.div className="h-3 overflow-hidden rounded-full bg-white/25">
                  <motion.div
                    className="h-full rounded-full bg-yellow-kid"
                    initial={{ width: "12%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 2.1, ease: "easeInOut" }}
                  />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <footer className="rounded-3xl bg-white/65 p-5">
          <h2 className="mb-3 text-xl font-bold text-slate-800">风格选择</h2>
          <StyleSelector value={style} onChange={setStyle} />
        </footer>
      </div>

      <PlayerControl
        isGenerating={isGenerating}
        onGenerate={() => setIsGenerating(true)}
        onRead={autoPlayFirstPage}
      />
    </main>
  );
}

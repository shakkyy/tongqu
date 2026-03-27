import { useEffect, useMemo, useState } from "react";
import { VoiceInput } from "./components/VoiceInput";
import { StyleSelector } from "./components/StyleSelector";
import { KeywordsSelector } from "./components/KeywordsSelector";
import { SketchPad } from "./components/SketchPad";
import type { StoryPage, StoryStyle } from "./types";
import { Sparkles, Wand2, Volume2, ChevronLeft, ChevronRight, Download, Share2, Mic, Type, PenTool, RefreshCw, Plus, BookOpen } from "lucide-react";

const DEMO_STORY: StoryPage[] = [
  {
    id: "p1",
    title: "月下仙狐",
    text: "灵狐衔着一盏琉璃灯，穿行在幽静的竹林深处，寻找传说中的仙缘。",
    imageUrl: "https://images.unsplash.com/photo-1516715094483-75da7dee9758?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "p2",
    title: "九霄云阁",
    text: "祥云化作一道长桥，灵狐踏云而行，探寻那座漂浮在九霄之上的空中楼阁。",
    imageUrl: "https://images.unsplash.com/photo-1472396961693-142e6e269027?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "p3",
    title: "勇闯龙宫",
    text: "碧波荡漾，深海之中龙宫隐现，灵狐凭借智慧与勇气，赢得了龙王的赞许。",
    imageUrl: "https://images.unsplash.com/photo-1504208434309-cb69f4fe52b0?auto=format&fit=crop&w=1200&q=80",
  },
];

export default function App() {
  const [theme] = useState<"default" | "spring">("default");
  const [creationMode, setCreationMode] = useState<"voice" | "keywords" | "sketch">("voice");
  const [isListening, setIsListening] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [style, setStyle] = useState<StoryStyle>("paper-cut");

  const progressText = useMemo(() => {
    if (!isGenerating) return "";
    if (creationMode === "sketch") return "魔法画笔正在将草图变为插画...";
    if (style === "paper-cut") return "神笔马良正在帮你剪纸哦...";
    if (style === "ink-wash") return "小墨童正在挥毫泼墨...";
    return "皮影爷爷正在点亮皮影灯...";
  }, [isGenerating, style, creationMode]);

  useEffect(() => {
    if (!isGenerating) return;
    const timer = window.setTimeout(() => {
      setIsGenerating(false);
      autoPlayPage(0);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [isGenerating]);

  const autoPlayPage = (index: number) => {
    setActiveIndex(index);
    const utterance = new SpeechSynthesisUtterance(DEMO_STORY[index].text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.95;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const handleNext = () => {
    if (activeIndex < DEMO_STORY.length - 1) {
      setActiveIndex(activeIndex + 1);
    }
  };

  const handlePrev = () => {
    if (activeIndex > 0) {
      setActiveIndex(activeIndex - 1);
    }
  };

  const activePage = DEMO_STORY[activeIndex];

  return (
    <div data-theme={theme === "default" ? undefined : theme} className="h-screen bg-theme-bg bg-paper-texture font-classical text-theme-text flex flex-col overflow-hidden">
      {/* Top Navigation Bar - Ultra Compact */}
      <header className="h-12 flex items-center justify-between px-6 bg-theme-surface/95 border-b-2 border-theme-text sticky top-0 z-50 shadow-sm flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="bg-theme-primary p-1 rounded-lg border-2 border-theme-text">
            <Sparkles className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <h1 className="text-lg font-extrabold tracking-tight text-theme-text font-classical">
            童趣绘梦 <span className="text-xs text-theme-text/40 font-classical ml-1 hidden sm:inline">AI绘本创作平台</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button className="text-xs font-bold border-2 border-theme-text rounded-full px-3 py-1 bg-theme-bg hover:bg-theme-secondary hover:text-white transition-colors">
            我的书架
          </button>
          <div className="w-8 h-8 rounded-full border-2 border-theme-text bg-theme-success overflow-hidden">
            <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=kid&backgroundColor=2AAD6E`} alt="avatar" />
          </div>
        </div>
      </header>

      {/* Main Content Area - No vertical scroll */}
      <main className="flex-1 flex flex-col lg:flex-row w-full px-4 lg:px-6 py-3 gap-6 lg:gap-8 overflow-hidden min-h-0">
        
        {/* Left Sidebar: Creation Tools - Internal scroll only */}
        <aside className="lg:w-[360px] flex flex-col flex-shrink-0 bg-white border-handdrawn p-4 shadow-kid overflow-y-auto hide-scrollbar font-classical">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 border-b-2 border-dashed border-theme-text/20 pb-2">
              <Wand2 className="w-4 h-4 text-theme-primary" strokeWidth={2.5} />
              <h2 className="text-lg font-bold text-theme-text font-classical">创作魔法室</h2>
            </div>
            
            {/* Mode Tabs */}
            <div className="flex bg-theme-bg border-2 border-theme-text rounded-full p-0.5 gap-0.5">
              <button
                onClick={() => setCreationMode("voice")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full font-bold text-[11px] ${creationMode === "voice" ? "bg-theme-surface border-2 border-theme-text shadow-[1px_1px_0px_#1A2B3C]" : "text-theme-text/40 hover:text-theme-text"}`}
              >
                <Mic className="w-3 h-3" /> 语音
              </button>
              <button
                onClick={() => setCreationMode("keywords")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full font-bold text-[11px] ${creationMode === "keywords" ? "bg-theme-surface border-2 border-theme-text shadow-[1px_1px_0px_#1A2B3C]" : "text-theme-text/40 hover:text-theme-text"}`}
              >
                <Type className="w-3 h-3" /> 选词
              </button>
              <button
                onClick={() => setCreationMode("sketch")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full font-bold text-[11px] ${creationMode === "sketch" ? "bg-theme-surface border-2 border-theme-text shadow-[1px_1px_0px_#1A2B3C]" : "text-theme-text/40 hover:text-theme-text"}`}
              >
                <PenTool className="w-3 h-3" /> 草图
              </button>
            </div>
            
            {/* Step 1: Input Area */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full border-2 border-cn-ink bg-cn-yellow flex items-center justify-center font-bold text-cn-ink text-[10px]">1</div>
                <h3 className="text-sm font-bold text-cn-ink">
                  {creationMode === "voice" && "说出你的故事"}
                  {creationMode === "keywords" && "拼凑故事元素"}
                  {creationMode === "sketch" && "画出你的灵感"}
                </h3>
              </div>
              
              <div className="relative">
                <div className={creationMode === "voice" ? "" : "hidden"}>
                  <div className="flex flex-col gap-3">
                    <div className="py-1 flex justify-center">
                      <VoiceInput isListening={isListening} onToggle={() => setIsListening((v) => !v)} />
                    </div>
                    <div className="bg-cn-paper/50 border-2 border-dashed border-cn-ink/30 p-2 rounded-xl min-h-[40px] text-cn-ink/50 text-[11px]">
                      {isListening ? "正在变魔术..." : "录音内容显示区"}
                    </div>
                  </div>
                </div>
                
                <div className={creationMode === "keywords" ? "" : "hidden"}>
                  <div className="bg-cn-paper/30 border-2 border-dashed border-cn-ink/30 p-2 rounded-lg scale-[0.85] origin-top">
                    <KeywordsSelector />
                  </div>
                </div>

                <div className={creationMode === "sketch" ? "" : "hidden"}>
                  <div className="bg-cn-azure/10 border-2 border-dashed border-cn-azure p-3 rounded-lg text-center flex flex-col items-center justify-center gap-1 min-h-[100px]">
                    <PenTool className="w-4 h-4 text-cn-azure animate-bounce" />
                    <p className="text-cn-azure font-bold text-[11px] mt-1">魔法画板就绪</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2: Style Selection */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full border-2 border-cn-ink bg-cn-red flex items-center justify-center font-bold text-white text-[10px]">2</div>
                <h3 className="text-sm font-bold text-cn-ink">挑选插画画风</h3>
              </div>
              <div className="scale-90 origin-left">
                <StyleSelector value={style} onChange={setStyle} />
              </div>
            </div>

            {/* Generate Action */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setIsGenerating(true)}
                disabled={isGenerating}
                className={`w-full flex items-center justify-center gap-2 border-handdrawn px-4 py-2.5 text-base font-bold transition-all ${
                  isGenerating ? "bg-cn-paper opacity-80 text-cn-ink" : "bg-cn-red text-white shadow-[1px_2px_0px_#1A2B3C] hover:translate-y-[-1px]"
                }`}
              >
                <Sparkles className={`w-4 h-4 ${isGenerating ? "animate-spin" : ""}`} strokeWidth={2.5} />
                <span className="font-classical tracking-widest text-lg">开始变魔术</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Right Area: Story Stage - Flexible scaling */}
        <section className="flex-1 flex flex-col bg-white border-handdrawn p-4 shadow-kid relative overflow-hidden min-h-0 min-w-0">
          
          <div className={creationMode === "sketch" ? "flex-1 flex flex-col h-full min-h-0" : "hidden"}>
            <SketchPad />
          </div>
          
          <div className={creationMode === "sketch" ? "hidden" : "flex-1 flex flex-col h-full min-h-0"}>
            <div className="flex items-center justify-between mb-2 flex-shrink-0">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-cn-ink" />
                <h2 className="text-base font-bold text-cn-ink font-classical truncate max-w-[200px] sm:max-w-none">
                  {isGenerating ? "新故事绘制中..." : "《寻找月亮的奇妙旅程》"}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-1 border-2 border-cn-ink rounded-full bg-cn-paper px-2 py-0.5 font-bold text-[10px] hover:bg-cn-azure hover:text-white transition-colors">
                  <Share2 className="w-3 h-3" /> 分享
                </button>
                <button className="flex items-center gap-1 border-2 border-cn-ink rounded-full bg-cn-yellow px-2 py-0.5 font-bold text-cn-ink text-[10px] hover:bg-cn-red hover:text-white transition-colors">
                  <Download className="w-3 h-3" /> 导出
                </button>
              </div>
            </div>

            {/* Viewer Stage - Immersive Full Stage */}
            <div className="flex-1 relative flex items-center justify-center bg-cn-paper/30 rounded-xl border-2 border-cn-ink/10 mb-3 overflow-hidden min-h-0">
              
              {/* Navigation Arrows - Floating on edges */}
              <button 
                onClick={handlePrev}
                disabled={activeIndex === 0 || isGenerating}
                className={`absolute left-3 z-40 p-2 rounded-full border-2 border-cn-ink bg-white/95 shadow-sm disabled:opacity-0 transition-all hover:bg-cn-yellow hover:scale-110 active:scale-95`}
              >
                <ChevronLeft className="w-6 h-6 text-cn-ink" />
              </button>
              
              <button 
                onClick={handleNext}
                disabled={activeIndex === DEMO_STORY.length - 1 || isGenerating}
                className={`absolute right-3 z-40 p-2 rounded-full border-2 border-cn-ink bg-white/95 shadow-sm disabled:opacity-0 transition-all hover:bg-cn-yellow hover:scale-110 active:scale-95`}
              >
                <ChevronRight className="w-6 h-6 text-cn-ink" />
              </button>

              {/* Active Story Page - Full Cover Style */}
              {!isGenerating ? (
                <div className="w-full h-full relative bg-white flex-shrink-0">
                  <div className="w-full h-full relative">
                    <img src={activePage.imageUrl} className="w-full h-full object-cover" alt={activePage.title} />
                    <div className="absolute inset-0 bg-paper-texture opacity-20 pointer-events-none mix-blend-multiply" />
                    
                    {/* Top Overlay - Floating Badge */}
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1">
                      <div className="bg-cn-ink/80 backdrop-blur-md px-4 py-1.5 rounded-lg border border-white/20 shadow-lg">
                        <h3 className="text-sm font-bold text-white font-classical tracking-[0.25em]">{activePage.title}</h3>
                      </div>
                      <span className="text-[9px] font-black bg-white/90 text-cn-ink px-2 py-0.5 rounded-full border border-cn-ink shadow-sm">{activeIndex + 1} / {DEMO_STORY.length}</span>
                    </div>

                    {/* Bottom Dialogue Box - Wide Galgame Style */}
                    <div className="absolute bottom-4 left-4 right-4 lg:left-8 lg:right-8 z-20">
                      <div className="bg-white/90 backdrop-blur-xl border-2 border-cn-ink rounded-2xl p-4 lg:p-5 shadow-2xl relative overflow-hidden group/textbox">
                        <div className="absolute inset-1 border border-dashed border-cn-ink/10 rounded-xl pointer-events-none" />
                        
                        <div className="relative z-10 flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-1.5 h-4 bg-cn-red rounded-full" />
                              <span className="text-[10px] font-black text-cn-ink uppercase tracking-widest">灵语者</span>
                            </div>
                            <button onClick={() => autoPlayPage(activeIndex)} className="flex items-center gap-1 px-2 py-1 border border-cn-ink rounded-full bg-cn-yellow text-cn-ink text-[9px] font-bold hover:bg-cn-green hover:text-white transition-colors">
                              <Volume2 className="w-3 h-3" /> 语音
                            </button>
                          </div>
                          <div 
                            contentEditable 
                            suppressContentEditableWarning 
                            className="text-base lg:text-lg leading-relaxed text-cn-ink font-medium outline-none max-h-[4.5em] overflow-y-auto hide-scrollbar"
                          >
                            {activePage.text}
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Compact Corner Tools */}
                    <div className="absolute top-4 right-4 z-40 flex flex-col gap-2 opacity-60 hover:opacity-100 transition-opacity">
                      <button className="p-2 bg-white/90 rounded-full border border-cn-ink shadow-sm hover:bg-cn-azure hover:text-white transition-all hover:scale-110 group/btn">
                        <RefreshCw className="w-4 h-4 text-cn-ink" />
                        <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 bg-cn-ink text-white text-[10px] px-2 py-0.5 rounded opacity-0 group-hover/btn:opacity-100 whitespace-nowrap">续写</span>
                      </button>
                      <button className="p-2 bg-white/90 rounded-full border border-cn-ink shadow-sm hover:bg-cn-yellow transition-all hover:scale-110 group/btn">
                        <Wand2 className="w-4 h-4 text-cn-red" />
                        <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 bg-cn-ink text-white text-[10px] px-2 py-0.5 rounded opacity-0 group-hover/btn:opacity-100 whitespace-nowrap">替换</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-4 p-6">
                  <div className="w-16 h-16 rounded-full bg-cn-yellow/20 flex items-center justify-center border-2 border-dashed border-cn-yellow animate-spin">
                    <Wand2 className="w-8 h-8 text-cn-yellow animate-pulse" />
                  </div>
                  <p className="text-xl font-classical font-bold text-cn-ink tracking-widest text-center">{progressText}</p>
                </div>
              )}
            </div>

            {/* Bottom Thumbnails - Horizontal scroll only if needed */}
            <div className="h-20 flex items-center gap-3 overflow-x-auto pb-1 px-1 hide-scrollbar flex-shrink-0">
              {DEMO_STORY.map((page, idx) => (
                <button
                  key={page.id}
                  onClick={() => setActiveIndex(idx)}
                  className={`relative flex-shrink-0 h-14 aspect-[4/3] border-2 rounded-lg overflow-hidden transition-all ${
                    activeIndex === idx 
                      ? "border-cn-red shadow-sm scale-105 z-10" 
                      : "border-cn-ink opacity-60 hover:opacity-100"
                  }`}
                >
                  <img src={page.imageUrl} className="w-full h-full object-cover" alt="thumbnail" />
                  <div className="absolute bottom-0 left-0 right-0 bg-cn-ink/60 backdrop-blur-sm text-white text-[8px] font-bold py-0.5 px-1">
                    P{idx + 1}
                  </div>
                </button>
              ))}
              <button className="flex-shrink-0 h-14 aspect-[4/3] border-2 border-dashed border-cn-ink/40 rounded-lg flex flex-col items-center justify-center text-cn-ink/50 hover:bg-cn-paper transition-colors">
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

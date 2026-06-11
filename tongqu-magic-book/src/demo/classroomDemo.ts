import type {
  AgentTraceEntry,
  BookMeta,
  CultureRagInfo,
  FamilyMemberProfile,
  StoryPage,
  StoryStyle,
  StyleKeywordEnhancement,
} from "../types";
import type { BookshelfEntry } from "../lib/bookshelfStorage";
import type { KeywordSelectionPayload } from "../lib/keywordPayload";

export const CLASSROOM_DEMO_QUERY_ENABLED =
  typeof window !== "undefined" &&
  ["1", "classroom", "true"].includes(new URLSearchParams(window.location.search).get("demo") || "");

export const CLASSROOM_DEMO_PHOTO_URL = "/demo/family-together.png";

const createdAt = new Date("2026-06-09T09:30:00+08:00").getTime();
type DemoCreationMode = "voice" | "keywords" | "sketch" | "family";

export type ClassroomDemoFixture = {
  mode: DemoCreationMode;
  title: string;
  style: StoryStyle;
  pages: StoryPage[];
  culture: CultureRagInfo;
  ranker: StyleKeywordEnhancement[];
  meta: BookMeta;
  traces: Record<string, AgentTraceEntry>;
};

const styleFragmentByKeyword: Record<string, string> = {
  宣纸质感: "visible xuan paper texture",
  留白: "generous negative space",
  淡墨晕染: "soft diluted ink wash diffusion",
  飞白笔意: "dry brush flying-white texture",
  淡彩点缀: "subtle light color accents",
  墨色层次: "layered ink tonal gradation",
  写意笔触: "expressive freehand brushstrokes",
  纸上渗痕: "ink bleeding into paper",
  月色留白: "moonlit negative space",
  湖面淡彩: "subtle watercolor lake reflections",
  夜蓝层次: "layered night-blue ink tones",
  茶烟淡墨: "soft tea-steam ink wash",
  春芽点彩: "tiny spring bud color accents",
  田垄节奏: "rhythmic terraced field composition",
  云气留白: "cloud-shaped negative space",
  山花淡彩: "light wildflower color accents",
  灵动线条: "lively childlike contour lines",
  剪纸镂空: "paper-cut hollow cutout shapes",
  纸边质感: "visible cut-paper edge texture",
  平面层次: "flat layered paper planes",
  民俗窗花: "Chinese folk window-paper-cut pattern rhythm",
  红蓝对比: "bold red and blue paper color contrast",
  圆润角色: "rounded child-friendly character shapes",
  明快色块: "bright flat color blocks",
  漫画勾线: "clean children's comic outlines",
  分镜动感: "dynamic comic panel-like motion",
  表情夸张: "expressive playful facial features",
  皮影轮廓: "clear Chinese shadow-puppet silhouette contours",
  暖黄幕光: "warm golden shadow-puppet stage light",
  镂刻纹样: "delicate cutout leather-puppet patterns",
  舞台侧光: "side-lit traditional puppet stage composition",
  半透明皮革: "translucent colored leather puppet texture",
  幕布层次: "layered shadow-puppet curtain depth",
};

function makeRanker(
  pages: StoryPage[],
  style: string,
  keywordsByPage: string[][],
): StyleKeywordEnhancement[] {
  return pages.map((page, idx) => {
    const keywords = keywordsByPage[idx] ?? keywordsByPage[keywordsByPage.length - 1] ?? [];
    return {
      scene_no: page.sceneNo ?? idx + 1,
      style,
      selected_keywords: keywords,
      selected_fragments: keywords.map((keyword) => styleFragmentByKeyword[keyword] ?? keyword),
      original_image_prompt: page.imagePrompt,
      enhanced_image_prompt: page.imagePrompt,
    };
  });
}

function makeDemoTraces(
  mode: DemoCreationMode,
  title: string,
  cultureTitles: string,
  boardDetail: string,
): Record<string, AgentTraceEntry> {
  const hasSketchLikeInput = mode === "sketch" || mode === "family";
  return {
    queued: {
      id: `demo-trace-${mode}-queued`,
      kind: "observe",
      title: "理解输入",
      detail: `收到 ${mode} 模式素材，准备先做安全过滤，再进入文化检索与故事编排。`,
    },
    ...(hasSketchLikeInput
      ? {
          sketch: {
            id: `demo-trace-${mode}-sketch`,
            kind: "tool_result",
            title: mode === "family" ? "完成：亲子素材理解子Agent" : "完成：草图理解子Agent",
            detail:
              mode === "family"
                ? "亲子素材理解完成：已提取可儿童化改写的亲子角色锚点。"
                : "草图理解完成：已保留孙悟空、云朵、小动物、山坡和花草等可见元素。",
          },
        }
      : {}),
    culture: {
      id: `demo-trace-${mode}-culture`,
      kind: "tool_result",
      title: "完成：文化基因检索子Agent",
      detail: `文化检索完成：${cultureTitles}。`,
    },
    orchestrate: {
      id: `demo-trace-${mode}-orchestrate`,
      kind: "decision",
      title: "安全预处理完成",
      detail: "输入素材可继续创作。",
    },
    draft: {
      id: `demo-trace-${mode}-draft`,
      kind: "tool_result",
      title: "完成：故事撰写子Agent",
      detail: `故事与分镜草案完成：${title}，共 6 页。`,
    },
    board: {
      id: `demo-trace-${mode}-board`,
      kind: "tool_result",
      title: "完成：分镜导演子Agent",
      detail: boardDetail,
    },
    ranker: {
      id: `demo-trace-${mode}-ranker`,
      kind: "tool_result",
      title: "墨韵 Ranker",
      detail: "为每页选择 3 个画风词；如果词与内容冲突，以页面内容为主。",
    },
    image: {
      id: `demo-trace-${mode}-image`,
      kind: "tool_result",
      title: "完成：插画生成子Agent",
      detail: "6 页插画已完成，画面保持 16:9，角色与核心道具保持一致。",
    },
    tts: {
      id: `demo-trace-${mode}-tts`,
      kind: "tool_result",
      title: "完成：朗读合成子Agent",
      detail: "每页旁白已整理完成，可以逐页播放与阅读。",
    },
    review: {
      id: `demo-trace-${mode}-review`,
      kind: "finish",
      title: "汇总成书",
      detail: "安全复核通过：没有血腥、暴力、惊吓、可读文字、品牌标识或真实身份复刻。",
    },
  };
}

export const CLASSROOM_DEMO_INPUT = {
  childIdea: "我想让我们一家三口进到古代小工坊，帮村里的小朋友修一座会吱呀响的小木桥。",
  parentGoal: "希望孩子能看到：遇到问题先观察，再测量、试做、调整，家人可以分工合作。",
  travelWish: "穿越到古代河边木工坊，用木尺、小叶船、石子和竹风铃完成一个新的小故事。",
};

export const CLASSROOM_DEMO_VOICE_TEXT =
  "我想讲一只小狐狸在夜晚给月亮湖送星星的故事。它遇到小鲤鱼和一只小纸船，想帮迷路的萤火虫找到回家的亮光。";

export const CLASSROOM_DEMO_KEYWORD_PAYLOAD: KeywordSelectionPayload = {
  theme: { tags: [], custom: "节气、茶芽、耐心等待、分享" },
  character: { tags: [], custom: "小鹿、茶爷爷、雨燕、蜗牛朋友" },
  scene: { tags: [], custom: "春日茶园、竹篮、山泉、小雨" },
};

export const CLASSROOM_DEMO_SKETCH_DESCRIPTION =
  "演示草图里有孙悟空站在云朵上，旁边有小兔子、小鹿和山坡花草。";

export const CLASSROOM_DEMO_FAMILY_PROFILES: FamilyMemberProfile[] = [
  {
    id: "demo-father",
    displayName: "爸爸",
    relation: "爸爸",
    storyRole: "陪伴引导者",
    characterDescription: "沉稳、有耐心，喜欢把复杂问题拆成小步骤，鼓励孩子先观察再尝试。",
    visualNotes: "短黑发、象牙色对襟中式上衣、深色裤子、前排深色盘扣，非写实绘本形象。",
    photoThumb: CLASSROOM_DEMO_PHOTO_URL,
    enabled: true,
    updatedAt: createdAt,
  },
  {
    id: "demo-mother",
    displayName: "妈妈",
    relation: "妈妈",
    storyRole: "温柔记录者",
    characterDescription: "温柔、善于鼓励，喜欢倾听孩子的想法，帮助大家整理线索和分工。",
    visualNotes: "肩长深棕发、红色无袖马甲、米色长袖内搭、马甲正面盘扣，非写实绘本形象。",
    photoThumb: CLASSROOM_DEMO_PHOTO_URL,
    enabled: true,
    updatedAt: createdAt,
  },
  {
    id: "demo-child",
    displayName: "小星",
    relation: "孩子",
    storyRole: "好奇探索者",
    characterDescription: "好奇、爱提问，愿意观察细节、提出想法，并和家人一起试一试。",
    visualNotes: "黑色双马尾、粉色背带裙、米色上衣、背带肩部圆扣，非写实绘本形象。",
    photoThumb: CLASSROOM_DEMO_PHOTO_URL,
    enabled: true,
    updatedAt: createdAt,
  },
];

const clothingAnchor =
  "Father: short black hair, no beard, ivory front-opening Tang-style shirt with visible dark frog-button fasteners, dark trousers, holding a small wooden ruler. " +
  "Mother: shoulder-length dark brown hair, warm red sleeveless vest over cream long-sleeve shirt, visible dark frog-button fasteners on the vest, carrying a red measuring cord. " +
  "Child: black pigtails, plain pink pinafore dress over a cream shirt, two round shoulder buttons, carrying a tiny bamboo pencil. Keep these clothing details unchanged.";

const pageStyleFragments = [
  "visible xuan paper texture, generous negative space, layered ink tonal gradation",
  "dry brush flying-white texture, soft diluted ink wash diffusion, generous negative space",
  "visible xuan paper texture, light color accents, layered ink tonal gradation",
  "expressive freehand brushstrokes, dry brush flying-white texture, generous negative space",
  "soft diluted ink wash diffusion, ink bleeding into paper, expressive freehand brushstrokes",
  "generous negative space, layered ink tonal gradation, light color accents",
];

const demoAudioUrl = (book: "family" | "voice" | "keyword" | "sketch", page: number) =>
  `/demo/audio/${book}-p${page}.mp3`;

export const CLASSROOM_DEMO_PAGES: StoryPage[] = [
  {
    id: "demo-p1",
    sceneNo: 1,
    title: "会唱歌的小木桥",
    text: "小星在书桌上轻轻一敲旧木尺，纸面像小门一样打开。一家三口走进河边木工坊，听见远处的小桥吱呀一声。",
    imageUrl: "/demo/generated/woodbridge-p1.png",
    audioUrl: demoAudioUrl("family", 1),
    imagePrompt: `${clothingAnchor} A non-realistic Chinese ink-wash picture book family at a wooden desk; an old wooden ruler taps blank paper, opening a view toward an ancient riverside carpentry workshop village in daytime. ${pageStyleFragments[0]}. No glowing objects, no text, no letters, no watermark, no logo.`,
  },
  {
    id: "demo-p2",
    sceneNo: 2,
    title: "会唱歌的小木桥 · 第2页",
    text: "他们来到浅溪边，发现小木桥的几块桥板松了。小星没有急着跑过去，而是蹲下来听风铃和木板的声音。",
    imageUrl: "/demo/generated/woodbridge-p2.png",
    audioUrl: demoAudioUrl("family", 2),
    imagePrompt: `${clothingAnchor} The same family stands by a small wooden bridge crossing a shallow stream in an ancient riverside carpentry workshop village; a few planks are loose, bamboo wind chimes move in the breeze. ${pageStyleFragments[1]}. No glowing objects, no text, no letters, no watermark, no logo.`,
  },
  {
    id: "demo-p3",
    sceneNo: 3,
    title: "会唱歌的小木桥 · 第3页",
    text: "小星把石子放进小叶船，看水线升到哪里。爸爸用木尺量木条，妈妈用红绳记录，三个人找到最稳的一组材料。",
    imageUrl: "/demo/generated/woodbridge-p3.png",
    audioUrl: demoAudioUrl("family", 3),
    imagePrompt: `${clothingAnchor} The same child places pebbles into a small leaf boat to compare weight and waterline; mother records with a red measuring cord, father sorts wooden beams with a ruler on an ancient workshop table. ${pageStyleFragments[2]}. No glowing objects, no text, no letters, no watermark, no logo.`,
  },
  {
    id: "demo-p4",
    sceneNo: 4,
    title: "会唱歌的小木桥 · 第4页",
    text: "第一座小模型歪了一点。小星指着没对齐的小木钉说：“这里还要再试一次。”爸爸妈妈点点头，陪她慢慢调整。",
    imageUrl: "/demo/generated/woodbridge-p4.png",
    audioUrl: demoAudioUrl("family", 4),
    imagePrompt: `${clothingAnchor} The same family builds one small wooden bridge model on a low workshop table; the child points at a misaligned tenon peg while father holds a ruler and mother holds a red measuring cord. ${pageStyleFragments[3]}. No glowing objects, no text, no letters, no watermark, no logo.`,
  },
  {
    id: "demo-p5",
    sceneNo: 5,
    title: "会唱歌的小木桥 · 第5页",
    text: "傍晚前，新桥板一块块稳稳落好。竹风铃被挂在桥头，风一来，就像小桥在轻轻唱：“可以过啦。”",
    imageUrl: "/demo/generated/woodbridge-p5.png",
    audioUrl: demoAudioUrl("family", 5),
    imagePrompt: `${clothingAnchor} The same family installs the repaired wooden bridge over the shallow stream before evening; bamboo wind chimes hang beside the bridge and villagers watch warmly. ${pageStyleFragments[4]}. No glowing objects, no text, no letters, no watermark, no logo.`,
  },
  {
    id: "demo-p6",
    sceneNo: 6,
    title: "会唱歌的小木桥 · 第6页",
    text: "村里的孩子和长辈安全走过小桥。小星把四块小木片抱在怀里：观察、测量、试做、改进，原来好办法也能一起长大。",
    imageUrl: "/demo/generated/woodbridge-p6.png",
    audioUrl: demoAudioUrl("family", 6),
    imagePrompt: `${clothingAnchor} Villagers, children, and elders cross the repaired wooden bridge safely while the same family smiles together; the child holds four plain blank wooden blocks. ${pageStyleFragments[5]}. No glowing objects, no text, no letters, no watermark, no logo.`,
  },
];

export const CLASSROOM_DEMO_CULTURE: CultureRagInfo = {
  used: true,
  hits: [
    {
      title: "鲁班学艺",
      source: "中国传统工匠故事",
      category: "工匠精神",
      score: 0.6167,
      story_summary:
        "鲁班年轻时拜师学艺，师傅让他修旧工具、砍大树、做模型，考验他的耐心和毅力。鲁班坚持练习，最终学到真本领，成为受人敬重的木匠。",
      core_idea: "耐心观察、反复练习，把工具和方法用来帮助别人。",
      child_friendly_takeaway: "学本领不是一下子就会，先看清楚，再慢慢试，失败一次也可以继续调整。",
      visual_motifs: ["木尺", "木工坊", "旧工具", "小模型", "木纹"],
    },
    {
      title: "曹冲称象",
      source: "中国智慧故事",
      category: "观察与测量",
      score: 0.7958,
      story_summary:
        "曹冲看到大象太重，不能直接称量，便想到让大象上船、记下水位，再用石头替换到同样水位，通过称石头知道大象重量。",
      core_idea: "遇到大问题，可以拆成能观察、能比较、能验证的小步骤。",
      child_friendly_takeaway: "聪明办法常常来自认真观察和动手试验。",
      visual_motifs: ["小船", "石子", "水位线", "比较", "测量"],
    },
    {
      title: "三个和尚",
      source: "中国民间故事",
      category: "分工合作",
      score: 0.7792,
      story_summary:
        "一个和尚挑水喝，两个和尚抬水喝，三个和尚却因为互相推让没水喝。后来他们明白，大家需要分工合作，事情才能做好。",
      core_idea: "人多时更要分工清楚，互相帮忙。",
      child_friendly_takeaway: "一起做事时，每个人都出一点力，办法就会越来越稳。",
      visual_motifs: ["水桶", "山路", "分工", "合作", "小桥"],
    },
  ],
  context:
    "木尺、工坊、模型、石子、水位、合作等意象帮助故事保留观察、测量、试做和分工合作的文化力量。",
};

export const CLASSROOM_DEMO_RANKER: StyleKeywordEnhancement[] = [
  {
    scene_no: 1,
    style: "水墨",
    selected_keywords: ["宣纸质感", "留白", "淡墨晕染"],
    selected_fragments: [
      "visible xuan paper texture",
      "generous negative space",
      "soft diluted ink wash diffusion",
    ],
    original_image_prompt: CLASSROOM_DEMO_PAGES[0].imagePrompt,
    enhanced_image_prompt: CLASSROOM_DEMO_PAGES[0].imagePrompt,
  },
  {
    scene_no: 2,
    style: "水墨",
    selected_keywords: ["飞白笔意", "淡墨晕染", "留白"],
    selected_fragments: [
      "dry brush flying-white texture",
      "soft diluted ink wash diffusion",
      "generous negative space",
    ],
    original_image_prompt: CLASSROOM_DEMO_PAGES[1].imagePrompt,
    enhanced_image_prompt: CLASSROOM_DEMO_PAGES[1].imagePrompt,
  },
  {
    scene_no: 3,
    style: "水墨",
    selected_keywords: ["宣纸质感", "淡彩点缀", "墨色层次"],
    selected_fragments: [
      "visible xuan paper texture",
      "subtle light color accents",
      "layered ink tonal gradation",
    ],
    original_image_prompt: CLASSROOM_DEMO_PAGES[2].imagePrompt,
    enhanced_image_prompt: CLASSROOM_DEMO_PAGES[2].imagePrompt,
  },
  {
    scene_no: 4,
    style: "水墨",
    selected_keywords: ["写意笔触", "飞白笔意", "留白"],
    selected_fragments: [
      "expressive freehand brushstrokes",
      "dry brush flying-white texture",
      "generous negative space",
    ],
    original_image_prompt: CLASSROOM_DEMO_PAGES[3].imagePrompt,
    enhanced_image_prompt: CLASSROOM_DEMO_PAGES[3].imagePrompt,
  },
  {
    scene_no: 5,
    style: "水墨",
    selected_keywords: ["淡墨晕染", "纸上渗痕", "写意笔触"],
    selected_fragments: [
      "soft diluted ink wash diffusion",
      "ink bleeding into paper",
      "expressive freehand brushstrokes",
    ],
    original_image_prompt: CLASSROOM_DEMO_PAGES[4].imagePrompt,
    enhanced_image_prompt: CLASSROOM_DEMO_PAGES[4].imagePrompt,
  },
  {
    scene_no: 6,
    style: "水墨",
    selected_keywords: ["留白", "墨色层次", "淡彩点缀"],
    selected_fragments: [
      "generous negative space",
      "layered ink tonal gradation",
      "subtle light color accents",
    ],
    original_image_prompt: CLASSROOM_DEMO_PAGES[5].imagePrompt,
    enhanced_image_prompt: CLASSROOM_DEMO_PAGES[5].imagePrompt,
  },
];

export const CLASSROOM_DEMO_META: BookMeta = {
  title: "会唱歌的小木桥",
  style: "ink-wash",
  storyText: CLASSROOM_DEMO_PAGES.map((page) => page.text).join("\n"),
  styleKeywords: Array.from(
    new Set(
      CLASSROOM_DEMO_RANKER.flatMap((item) => item.selected_keywords || []).filter(
        (keyword): keyword is string => Boolean(keyword),
      ),
    ),
  ),
  styleKeywordEnhancements: CLASSROOM_DEMO_RANKER,
  familyCoCreation: {
    travelWish: CLASSROOM_DEMO_INPUT.travelWish,
    childIdea: CLASSROOM_DEMO_INPUT.childIdea,
    parentGoal: CLASSROOM_DEMO_INPUT.parentGoal,
    members: CLASSROOM_DEMO_FAMILY_PROFILES,
    privacyConfirmed: true,
    savePhotoToShelf: true,
    familyPhotoThumb: CLASSROOM_DEMO_PHOTO_URL,
    createdAt,
  },
  interactionCards: [
    {
      id: "demo-ask",
      type: "ask",
      title: "问一问",
      prompt: "如果你是小星，发现小桥会吱呀响时，会先观察哪里？为什么？",
    },
    {
      id: "demo-act",
      type: "act",
      title: "演一演",
      prompt: "一家人分工演一遍：一个人测量，一个人记录，一个人负责试小模型。",
    },
    {
      id: "demo-draw",
      type: "draw",
      title: "画一画",
      prompt: "画一件你想带进小工坊的工具，让它帮助大家解决一个温柔的问题。",
    },
  ],
  visualConsistency: {
    characters: [
      {
        role: "爸爸",
        appearance_anchor_en:
          "A kind Chinese picture-book father with short black hair, no facial hair, ivory front-opening Tang-style shirt with visible dark frog-button fasteners, dark trousers, holding a small wooden ruler.",
      },
      {
        role: "妈妈",
        appearance_anchor_en:
          "A gentle Chinese picture-book mother with shoulder-length dark brown hair, warm red sleeveless vest over a cream long-sleeve shirt, visible dark frog-button fasteners, carrying a red measuring cord.",
      },
      {
        role: "孩子",
        appearance_anchor_en:
          "A cheerful Chinese picture-book girl with black pigtails, plain pink pinafore dress over a cream shirt, two round shoulder buttons, carrying a tiny bamboo pencil.",
      },
    ],
    core_props: [
      { name_zh: "旧木尺", anchor_en: "A small natural wooden ruler with visible wood grain and no letters." },
      { name_zh: "竹风铃", anchor_en: "A simple bamboo wind chime hanging from the bridge post, natural bamboo color." },
      { name_zh: "小叶船", anchor_en: "A small green leaf boat carrying plain pebbles for a safe measuring experiment." },
    ],
    setting_anchor_en:
      "Ancient riverside carpentry workshop village in daytime, bamboo, shallow stream, wooden bridge, no modern objects.",
  },
};

const VOICE_DEMO_PAGES: StoryPage[] = [
  {
    id: "voice-demo-p1",
    sceneNo: 1,
    title: "月亮湖的小星船",
    text: "夜晚，小狐狸听见月亮湖轻轻响。几颗小星光落进水草里，像迷路的小铃铛一样闪呀闪。",
    imageUrl: "/demo/generated/voice-p1.png",
    audioUrl: demoAudioUrl("voice", 1),
    imagePrompt:
      "A gentle fox beside a moonlit lake, tiny star-like fireflies near reeds, Chinese paper-cut picture book style, no text, no letters, no watermark, no logo.",
  },
  {
    id: "voice-demo-p2",
    sceneNo: 2,
    title: "月亮湖的小星船 · 第2页",
    text: "小鲤鱼从水里探出头说：“萤火虫忘了回家的路。”小狐狸决定先找一艘不会吵醒月亮的小船。",
    imageUrl: "/demo/generated/voice-p2.png",
    audioUrl: demoAudioUrl("voice", 2),
    imagePrompt:
      "The same gentle fox meets a small carp in a quiet moonlit lake, reeds and soft firefly lights, Chinese paper-cut picture book style, no text, no letters, no watermark, no logo.",
  },
  {
    id: "voice-demo-p3",
    sceneNo: 3,
    title: "月亮湖的小星船 · 第3页",
    text: "它折了一只白色小纸船，把最亮的一只萤火虫请到船头。小船没有字，却像一盏小灯。",
    imageUrl: "/demo/generated/voice-p3.png",
    audioUrl: demoAudioUrl("voice", 3),
    imagePrompt:
      "The same gentle fox folding a plain white paper boat by a moonlit lake, one firefly glowing at the bow, no readable marks, Chinese paper-cut picture book style, no text, no letters, no watermark, no logo.",
  },
  {
    id: "voice-demo-p4",
    sceneNo: 4,
    title: "月亮湖的小星船 · 第4页",
    text: "风把湖水吹成弯弯的小路。小狐狸用竹枝试水流，小鲤鱼在旁边轻轻推，小船慢慢找到了方向。",
    imageUrl: "/demo/generated/voice-p4.png",
    audioUrl: demoAudioUrl("voice", 4),
    imagePrompt:
      "The same gentle fox using a bamboo twig to test the lake current while a small carp guides a plain paper boat, moonlit water path, Chinese paper-cut picture book style, no text, no letters, no watermark, no logo.",
  },
  {
    id: "voice-demo-p5",
    sceneNo: 5,
    title: "月亮湖的小星船 · 第5页",
    text: "萤火虫一只接一只飞起来，排成温柔的星河。月亮湖终于亮了，水草也安静地摇着手。",
    imageUrl: "/demo/generated/voice-p5.png",
    audioUrl: demoAudioUrl("voice", 5),
    imagePrompt:
      "Single full-page scene, not a collage, not multiple panels. The same gentle fox and small carp watching fireflies form one continuous soft star river above a moonlit lake, reeds and calm water, Chinese paper-cut picture book style, no text, no letters, no watermark, no logo.",
  },
  {
    id: "voice-demo-p6",
    sceneNo: 6,
    title: "月亮湖的小星船 · 第6页",
    text: "清晨，小狐狸把纸船停在岸边。它明白了：小小的亮光，分享出去，就能帮朋友找到回家的路。",
    imageUrl: "/demo/generated/voice-p6.png",
    audioUrl: demoAudioUrl("voice", 6),
    imagePrompt:
      "The same gentle fox placing a plain paper boat on a quiet lakeshore at dawn, warm soft light, small carp nearby, Chinese paper-cut picture book style, no text, no letters, no watermark, no logo.",
  },
];

const VOICE_DEMO_CULTURE: CultureRagInfo = {
  used: true,
  hits: [
    {
      title: "嫦娥奔月",
      source: "中国神话故事",
      category: "月亮意象",
      score: 0.7832,
      story_summary:
        "嫦娥奔月讲述人们仰望月亮、寄托思念与祝愿的神话。这里不复刻原故事，只借用月亮、夜空和温柔守望的文化意象。",
      core_idea: "把思念和祝愿化作温柔的光。",
      child_friendly_takeaway: "夜晚的月亮可以提醒我们关心远处的朋友。",
      visual_motifs: ["月亮", "湖面", "夜空", "柔光"],
    },
    {
      title: "孔明灯",
      source: "传统民俗",
      category: "灯火祈愿",
      score: 0.7461,
      story_summary:
        "孔明灯承载人们把愿望托给灯火的民俗记忆。样例只吸收灯火指路和温柔祝愿的意象，不让孩子模仿危险放灯行为。",
      core_idea: "一盏小灯可以表达祝福，也可以照亮方向。",
      child_friendly_takeaway: "给朋友一点亮光，就是给朋友一点勇气。",
      visual_motifs: ["小灯", "纸船", "暖光", "夜色"],
    },
    {
      title: "鲤鱼跃龙门",
      source: "中国民间故事",
      category: "坚持向上",
      score: 0.7124,
      story_summary:
        "鲤鱼跃龙门常被用来讲努力、坚持和成长。这里把鲤鱼改写成温柔伙伴，帮助纸船找到方向。",
      core_idea: "小伙伴互相帮助，困难会变成练习的机会。",
      child_friendly_takeaway: "慢慢试、一起走，就能更接近目标。",
      visual_motifs: ["鲤鱼", "水波", "方向", "陪伴"],
    },
  ],
  context: "月亮、灯火、纸船、鲤鱼和萤火虫共同支撑一个关于分享亮光、帮助伙伴的原创夜湖故事。",
};

const VOICE_DEMO_RANKER = makeRanker(VOICE_DEMO_PAGES, "剪纸", [
  ["剪纸镂空", "纸边质感", "平面层次"],
  ["民俗窗花", "纸边质感", "红蓝对比"],
  ["剪纸镂空", "平面层次", "圆润角色"],
  ["纸边质感", "红蓝对比", "平面层次"],
  ["民俗窗花", "剪纸镂空", "明快色块"],
  ["平面层次", "纸边质感", "圆润角色"],
]);

const VOICE_DEMO_META: BookMeta = {
  title: "月亮湖的小星船",
  style: "paper-cut",
  storyText: VOICE_DEMO_PAGES.map((page) => page.text).join("\n"),
  styleKeywords: Array.from(new Set(VOICE_DEMO_RANKER.flatMap((item) => item.selected_keywords || []))),
  styleKeywordEnhancements: VOICE_DEMO_RANKER,
  interactionCards: [
    { id: "voice-ask", type: "ask", title: "问一问", prompt: "如果你是小狐狸，会用什么温柔的办法帮萤火虫找到回家的路？" },
    { id: "voice-act", type: "act", title: "演一演", prompt: "一个人当小狐狸，一个人当小鲤鱼，用小手势演出纸船慢慢找到方向。" },
    { id: "voice-draw", type: "draw", title: "画一画", prompt: "画一盏不会伤害天空的小小心愿灯，送给迷路的朋友。" },
  ],
  visualConsistency: {
    characters: [
      {
        role: "小狐狸",
        appearance_anchor_en:
          "A gentle small orange fox with a cream face, round black eyes, soft curved tail, friendly childlike picture-book proportions.",
      },
      {
        role: "小鲤鱼",
        appearance_anchor_en:
          "A tiny red-orange carp with round eyes, golden fins, gentle smile, always near the moonlit lake water.",
      },
    ],
    key_props: [
      { name_zh: "白色小纸船", anchor_en: "A plain white folded paper boat with no letters or marks." },
      { name_zh: "萤火星光", anchor_en: "Tiny warm yellow firefly lights like little stars, soft and safe." },
    ],
    setting_anchor_en: "Quiet moonlit lake with reeds, layered Chinese paper-cut night scene, calm water reflections.",
  },
};

const KEYWORD_DEMO_PAGES: StoryPage[] = [
  {
    id: "keyword-demo-p1",
    sceneNo: 1,
    title: "茶芽醒来的早晨",
    text: "惊蛰后的早晨，小鹿在茶园里听见细细的声音。原来是一枚茶芽伸懒腰，轻轻说：“我醒啦。”",
    imageUrl: "/demo/generated/keyword-p1.png",
    audioUrl: demoAudioUrl("keyword", 1),
    imagePrompt:
      "A small deer in a spring tea garden listening to tiny tea buds waking up after light rain, Chinese shadow-puppet picture book stage style, translucent colored leather puppets, warm backlit curtain, no text, no letters, no watermark, no logo.",
  },
  {
    id: "keyword-demo-p2",
    sceneNo: 2,
    title: "茶芽醒来的早晨 · 第2页",
    text: "茶爷爷笑着提醒：“茶芽要慢慢长，不能急着摘。”小鹿把竹篮放下，先陪茶芽晒一会儿太阳。",
    imageUrl: "/demo/generated/keyword-p2.png",
    audioUrl: demoAudioUrl("keyword", 2),
    imagePrompt:
      "The same small deer beside an elderly tea gardener in a spring tea garden, a plain bamboo basket on the ground, warm morning sun, Chinese shadow-puppet picture book stage style, translucent colored leather puppets, warm backlit curtain, no text, no letters, no watermark, no logo.",
  },
  {
    id: "keyword-demo-p3",
    sceneNo: 3,
    title: "茶芽醒来的早晨 · 第3页",
    text: "雨燕飞来，告诉大家山泉的小渠堵住了。小鹿和茶爷爷一起搬开落叶，让清水绕着茶垄跑起来。",
    imageUrl: "/demo/generated/keyword-p3.png",
    audioUrl: demoAudioUrl("keyword", 3),
    imagePrompt:
      "The same small deer and elderly tea gardener clearing fallen leaves from a tiny spring-water channel in a terraced tea garden, a swallow flying above, Chinese shadow-puppet picture book stage style, translucent colored leather puppets, warm backlit curtain, no text, no letters, no watermark, no logo.",
  },
  {
    id: "keyword-demo-p4",
    sceneNo: 4,
    title: "茶芽醒来的早晨 · 第4页",
    text: "一只蜗牛慢慢爬到嫩叶旁。小鹿没有催它，只用小叶子搭了弯弯小路，请蜗牛绕开茶芽。",
    imageUrl: "/demo/generated/keyword-p4.png",
    audioUrl: demoAudioUrl("keyword", 4),
    imagePrompt:
      "The same small deer making a gentle leaf path for a snail beside tea buds, spring tea garden rows, Chinese shadow-puppet picture book stage style, translucent colored leather puppets, warm backlit curtain, no text, no letters, no watermark, no logo.",
  },
  {
    id: "keyword-demo-p5",
    sceneNo: 5,
    title: "茶芽醒来的早晨 · 第5页",
    text: "小雨落下来，茶芽舒展开两片嫩叶。茶爷爷只采了最合适的几片，留下更多绿意继续长大。",
    imageUrl: "/demo/generated/keyword-p5.png",
    audioUrl: demoAudioUrl("keyword", 5),
    imagePrompt:
      "The same small deer and elderly tea gardener gently picking only a few ready tea leaves in soft spring rain, many tea buds left growing, Chinese shadow-puppet picture book stage style, translucent colored leather puppets, warm backlit curtain, no text, no letters, no watermark, no logo.",
  },
  {
    id: "keyword-demo-p6",
    sceneNo: 6,
    title: "茶芽醒来的早晨 · 第6页",
    text: "傍晚，茶香飘到小院里。小鹿把第一杯温温的茶香送给朋友，明白了等待也能长出甜甜的礼物。",
    imageUrl: "/demo/generated/keyword-p6.png",
    audioUrl: demoAudioUrl("keyword", 6),
    imagePrompt:
      "The same small deer sharing warm tea aroma with animal friends in a small courtyard beside a spring tea garden, gentle evening light, Chinese shadow-puppet picture book stage style, translucent colored leather puppets, warm backlit curtain, no text, no letters, no watermark, no logo.",
  },
];

const KEYWORD_DEMO_CULTURE: CultureRagInfo = {
  used: true,
  hits: [
    {
      title: "二十四节气",
      source: "中国传统历法",
      category: "时令观察",
      score: 0.8015,
      story_summary:
        "二十四节气帮助人们观察天气、植物和农事变化。样例借用惊蛰、春雨和茶芽生长的时令感，不讲复杂历法。",
      core_idea: "顺着时令观察自然，知道什么时候该等待、什么时候该行动。",
      child_friendly_takeaway: "很多好东西需要慢慢长大。",
      visual_motifs: ["春雨", "嫩芽", "茶垄", "山泉"],
    },
    {
      title: "神农尝百草",
      source: "中国神话传说",
      category: "认识草木",
      score: 0.7312,
      story_summary:
        "神农尝百草体现古人认识草木、谨慎辨别的探索精神。这里只提取观察草木和尊重自然的文化内核。",
      core_idea: "认识自然要细心、耐心，也要懂得安全。",
      child_friendly_takeaway: "看到新植物时先观察，不随便入口。",
      visual_motifs: ["草木", "竹篮", "山野", "观察"],
    },
    {
      title: "陆羽煮茶",
      source: "茶文化故事",
      category: "茶文化",
      score: 0.7066,
      story_summary:
        "陆羽与茶文化相关，代表认真观察水、叶、火候的传统审美。样例只保留茶香、节制采摘和分享的意象。",
      core_idea: "认真对待小事，平凡的茶叶也能带来温暖。",
      child_friendly_takeaway: "把好东西分享给朋友，会让等待更有意义。",
      visual_motifs: ["茶叶", "茶香", "山泉", "分享"],
    },
  ],
  context: "节气、春雨、茶芽、山泉和分享茶香，共同构成关于耐心等待和尊重自然的原创故事。",
};

const KEYWORD_DEMO_RANKER = makeRanker(KEYWORD_DEMO_PAGES, "皮影", [
  ["皮影轮廓", "暖黄幕光", "镂刻纹样"],
  ["半透明皮革", "舞台侧光", "暖黄幕光"],
  ["皮影轮廓", "幕布层次", "镂刻纹样"],
  ["半透明皮革", "皮影轮廓", "舞台侧光"],
  ["暖黄幕光", "镂刻纹样", "幕布层次"],
  ["皮影轮廓", "半透明皮革", "暖黄幕光"],
]);

const KEYWORD_DEMO_META: BookMeta = {
  title: "茶芽醒来的早晨",
  style: "shadow-puppet",
  storyText: KEYWORD_DEMO_PAGES.map((page) => page.text).join("\n"),
  styleKeywords: Array.from(new Set(KEYWORD_DEMO_RANKER.flatMap((item) => item.selected_keywords || []))),
  styleKeywordEnhancements: KEYWORD_DEMO_RANKER,
  interactionCards: [
    { id: "keyword-ask", type: "ask", title: "问一问", prompt: "小鹿为什么没有急着摘茶芽？你还见过什么需要慢慢等待的东西？" },
    { id: "keyword-act", type: "act", title: "演一演", prompt: "一个人当小鹿，一个人当茶芽，用动作演出“慢慢长大”的过程。" },
    { id: "keyword-draw", type: "draw", title: "画一画", prompt: "画一片你想照顾的小叶子，并给它设计一个不着急长大的小家。" },
  ],
  visualConsistency: {
    characters: [
      {
        role: "小鹿",
        appearance_anchor_en:
          "A gentle small deer with warm tan fur, round eyes, tiny antlers, simple childlike picture-book proportions.",
      },
      {
        role: "茶爷爷",
        appearance_anchor_en:
          "A kind elderly tea gardener in a plain blue-gray robe and straw hat, carrying a simple bamboo basket.",
      },
    ],
    key_props: [
      { name_zh: "竹篮", anchor_en: "A plain woven bamboo basket with no letters or decorative marks." },
      { name_zh: "茶芽", anchor_en: "Tiny fresh green tea buds with two soft leaves." },
    ],
    setting_anchor_en: "Spring tea garden on gentle hills, terraced tea rows, mountain spring and soft rain.",
  },
};

const SKETCH_DEMO_PAGES: StoryPage[] = [
  {
    id: "sketch-demo-p1",
    sceneNo: 1,
    title: "云朵上的花果山铃",
    text: "孙悟空站在软软的云朵上，听见山坡那边静悄悄。小兔子和小鹿跑来说：“花果山的小铃不唱歌了。”",
    imageUrl: "/demo/generated/sketch-p1.png",
    audioUrl: demoAudioUrl("sketch", 1),
    imagePrompt:
      "A playful childlike Sun Wukong standing on a soft cloud above a mountain meadow, a rabbit and a deer nearby, friendly children's comic illustration style, clean expressive outlines, bright flat colors, no text, no letters, no watermark, no logo.",
  },
  {
    id: "sketch-demo-p2",
    sceneNo: 2,
    title: "云朵上的花果山铃 · 第2页",
    text: "他们没有急着摇铃，而是蹲下来听。原来风被高高的草叶挡住了，小铃只差一点点风的拥抱。",
    imageUrl: "/demo/generated/sketch-p2.png",
    audioUrl: demoAudioUrl("sketch", 2),
    imagePrompt:
      "The same childlike Sun Wukong, rabbit, and deer listening quietly beside tall grass and a small silent bamboo wind chime in a mountain meadow, friendly children's comic illustration style, clean expressive outlines, bright flat colors, no text, no letters, no watermark, no logo.",
  },
  {
    id: "sketch-demo-p3",
    sceneNo: 3,
    title: "云朵上的花果山铃 · 第3页",
    text: "孙悟空把云朵轻轻放低，托住被风吹弯的小花。小兔子把草叶分开，小鹿找到一条细细的风路。",
    imageUrl: "/demo/generated/sketch-p3.png",
    audioUrl: demoAudioUrl("sketch", 3),
    imagePrompt:
      "The same childlike Sun Wukong lowering a soft cloud to support bent wildflowers while a rabbit parts grass and a deer finds a small wind path, friendly children's comic illustration style, clean expressive outlines, bright flat colors, no text, no letters, no watermark, no logo.",
  },
  {
    id: "sketch-demo-p4",
    sceneNo: 4,
    title: "云朵上的花果山铃 · 第4页",
    text: "小伙伴们捡起落下的竹叶，穿成一串小铃穗。他们一边试，一边听，找到了最温柔的声音。",
    imageUrl: "/demo/generated/sketch-p4.png",
    audioUrl: demoAudioUrl("sketch", 4),
    imagePrompt:
      "The same childlike Sun Wukong, rabbit, and deer stringing fallen bamboo leaves into a small wind chime tassel in a meadow, friendly children's comic illustration style, clean expressive outlines, bright flat colors, no text, no letters, no watermark, no logo.",
  },
  {
    id: "sketch-demo-p5",
    sceneNo: 5,
    title: "云朵上的花果山铃 · 第5页",
    text: "清风终于穿过草叶，叮铃，叮铃。花果山像醒来一样，山花跟着铃声轻轻点头。",
    imageUrl: "/demo/generated/sketch-p5.png",
    audioUrl: demoAudioUrl("sketch", 5),
    imagePrompt:
      "Single full-page scene, not a collage, not multiple panels, no split-screen layout. The same childlike Sun Wukong, rabbit, and deer watching a small bamboo wind chime ring in a gentle breeze, mountain flowers nodding in one continuous meadow scene, friendly children's comic illustration style, clean expressive outlines, bright flat colors, no text, no letters, no watermark, no logo.",
  },
  {
    id: "sketch-demo-p6",
    sceneNo: 6,
    title: "云朵上的花果山铃 · 第6页",
    text: "孙悟空把小铃挂在云朵旁边。大家约好：遇到安静的问题，先听一听，再一起想办法。",
    imageUrl: "/demo/generated/sketch-p6.png",
    audioUrl: demoAudioUrl("sketch", 6),
    imagePrompt:
      "The same childlike Sun Wukong hanging a small bamboo wind chime beside a soft cloud, rabbit and deer smiling in a peaceful mountain meadow, friendly children's comic illustration style, clean expressive outlines, bright flat colors, no text, no letters, no watermark, no logo.",
  },
];

const SKETCH_DEMO_CULTURE: CultureRagInfo = {
  used: true,
  hits: [
    {
      title: "西游记",
      source: "中国古典小说",
      category: "经典人物",
      score: 0.8427,
      story_summary:
        "《西游记》里的孙悟空机智勇敢，也会在取经路上学习合作与担当。样例只借用孙悟空这一文化形象，不复刻取经情节。",
      core_idea: "有本领也要会倾听、会帮助伙伴。",
      child_friendly_takeaway: "遇到问题时，聪明和耐心可以一起用。",
      visual_motifs: ["孙悟空", "云朵", "金色头箍", "山坡"],
    },
    {
      title: "花果山",
      source: "西游记意象",
      category: "自然乐园",
      score: 0.7823,
      story_summary:
        "花果山是孙悟空故事中的自然乐园意象，有山花、动物和自由生长的生命力。样例把它改写成温柔山坡。",
      core_idea: "自然里的每个小伙伴都值得被照顾。",
      child_friendly_takeaway: "照顾花草和朋友，也是勇敢的一种。",
      visual_motifs: ["山花", "小动物", "草叶", "云"],
    },
    {
      title: "伯牙鼓琴",
      source: "中国知音故事",
      category: "倾听与理解",
      score: 0.6955,
      story_summary:
        "伯牙鼓琴讲知音懂得倾听与理解。样例不复刻原故事，只吸收“先听见，再理解”的文化内核。",
      core_idea: "真正的帮助从认真倾听开始。",
      child_friendly_takeaway: "朋友安静时，也许更需要我们慢慢听。",
      visual_motifs: ["声音", "风铃", "倾听", "山风"],
    },
  ],
  context: "孙悟空、云朵、小动物、花果山和风铃共同支撑一个从草图出发的原创倾听故事。",
};

const SKETCH_DEMO_RANKER = makeRanker(SKETCH_DEMO_PAGES, "漫画", [
  ["漫画勾线", "明快色块", "圆润角色"],
  ["漫画勾线", "分镜动感", "表情夸张"],
  ["明快色块", "灵动线条", "圆润角色"],
  ["漫画勾线", "分镜动感", "明快色块"],
  ["表情夸张", "灵动线条", "明快色块"],
  ["圆润角色", "漫画勾线", "分镜动感"],
]);

const SKETCH_DEMO_META: BookMeta = {
  title: "云朵上的花果山铃",
  style: "comic",
  storyText: SKETCH_DEMO_PAGES.map((page) => page.text).join("\n"),
  styleKeywords: Array.from(new Set(SKETCH_DEMO_RANKER.flatMap((item) => item.selected_keywords || []))),
  styleKeywordEnhancements: SKETCH_DEMO_RANKER,
  interactionCards: [
    { id: "sketch-ask", type: "ask", title: "问一问", prompt: "孙悟空为什么先听一听，而不是马上摇小铃？" },
    { id: "sketch-act", type: "act", title: "演一演", prompt: "用身体演出云朵、山风和小铃，看看怎样的风最温柔。" },
    { id: "sketch-draw", type: "draw", title: "画一画", prompt: "在你的草图旁边加一个会发出温柔声音的小道具。" },
  ],
  visualConsistency: {
    characters: [
      {
        role: "孙悟空",
        appearance_anchor_en:
          "A playful childlike Sun Wukong monkey with golden-brown fur, red tunic, golden headband, friendly smile, standing on a soft cloud.",
      },
      {
        role: "小兔子",
        appearance_anchor_en: "A small white rabbit with long ears, round eyes, gentle childlike shape.",
      },
      {
        role: "小鹿",
        appearance_anchor_en: "A small tan deer with tiny antlers, round eyes, gentle childlike shape.",
      },
    ],
    key_props: [
      { name_zh: "云朵", anchor_en: "A soft white cloud with rounded edges, always gentle and safe." },
      { name_zh: "竹叶小铃", anchor_en: "A tiny bamboo-leaf wind chime made from fallen leaves, no letters or symbols." },
    ],
    setting_anchor_en:
      "Peaceful Flower-Fruit-Mountain-like meadow with green hills, wildflowers, soft wind, and friendly children's comic colors.",
  },
};

export const CLASSROOM_DEMO_TRACES: Record<string, AgentTraceEntry> = {
  queued: {
    id: "demo-trace-queued",
    kind: "observe",
    title: "理解输入",
    detail: "收到 family 模式素材，准备先做安全过滤，再进入文化检索与故事编排。",
  },
  sketch: {
    id: "demo-trace-sketch",
    kind: "tool_result",
    title: "完成：亲子素材理解子Agent",
    detail: "亲子素材理解完成：已提取可儿童化改写的亲子角色锚点。",
  },
  culture: {
    id: "demo-trace-culture",
    kind: "tool_result",
    title: "完成：文化基因检索子Agent",
    detail: "文化检索完成：鲁班学艺、曹冲称象、三个和尚。",
  },
  orchestrate: {
    id: "demo-trace-orchestrate",
    kind: "decision",
    title: "安全预处理完成",
    detail: "输入素材可继续创作。",
  },
  draft: {
    id: "demo-trace-draft",
    kind: "tool_result",
    title: "完成：故事撰写子Agent",
    detail: "故事与分镜草案完成：会唱歌的小木桥，共 6 页。",
  },
  board: {
    id: "demo-trace-board",
    kind: "tool_result",
    title: "完成：分镜导演子Agent",
    detail: "为 6 页写入角色一致性：盘扣、红马甲、粉色背带裙、木尺、红绳、小叶船和竹风铃保持一致。",
  },
  ranker: {
    id: "demo-trace-ranker",
    kind: "tool_result",
    title: "墨韵 Ranker",
    detail: "为每页选择 3 个水墨风格词，强化宣纸、留白、笔触、墨色和淡彩层次。",
  },
  image: {
    id: "demo-trace-image",
    kind: "tool_result",
    title: "完成：插画生成子Agent",
    detail: "6 页插画已完成，画面保持 16:9，角色服装与核心道具保持一致。",
  },
  tts: {
    id: "demo-trace-tts",
    kind: "tool_result",
    title: "完成：朗读合成子Agent",
    detail: "每页旁白已整理完成，可以逐页播放与阅读。",
  },
  review: {
    id: "demo-trace-review",
    kind: "finish",
    title: "汇总成书",
    detail: "安全复核通过：没有血腥、暴力、惊吓、可读文字、品牌标识或真实身份复刻。",
  },
};

export const CLASSROOM_DEMO_FIXTURES: Record<DemoCreationMode, ClassroomDemoFixture> = {
  voice: {
    mode: "voice",
    title: VOICE_DEMO_META.title,
    style: "paper-cut",
    pages: VOICE_DEMO_PAGES,
    culture: VOICE_DEMO_CULTURE,
    ranker: VOICE_DEMO_RANKER,
    meta: VOICE_DEMO_META,
    traces: makeDemoTraces(
      "voice",
      VOICE_DEMO_META.title,
      "嫦娥奔月、孔明灯、鲤鱼跃龙门",
      "为 6 页写入角色一致性：小狐狸、小鲤鱼、白色纸船、萤火星光和月亮湖保持一致。",
    ),
  },
  keywords: {
    mode: "keywords",
    title: KEYWORD_DEMO_META.title,
    style: "shadow-puppet",
    pages: KEYWORD_DEMO_PAGES,
    culture: KEYWORD_DEMO_CULTURE,
    ranker: KEYWORD_DEMO_RANKER,
    meta: KEYWORD_DEMO_META,
    traces: makeDemoTraces(
      "keywords",
      KEYWORD_DEMO_META.title,
      "二十四节气、神农尝百草、陆羽煮茶",
      "为 6 页写入角色一致性：小鹿、茶爷爷、竹篮、茶芽、山泉和春日茶园保持一致。",
    ),
  },
  sketch: {
    mode: "sketch",
    title: SKETCH_DEMO_META.title,
    style: "comic",
    pages: SKETCH_DEMO_PAGES,
    culture: SKETCH_DEMO_CULTURE,
    ranker: SKETCH_DEMO_RANKER,
    meta: SKETCH_DEMO_META,
    traces: makeDemoTraces(
      "sketch",
      SKETCH_DEMO_META.title,
      "西游记、花果山、伯牙鼓琴",
      "为 6 页写入角色一致性：孙悟空、云朵、小兔子、小鹿、竹叶小铃和山坡花草保持一致。",
    ),
  },
  family: {
    mode: "family",
    title: CLASSROOM_DEMO_META.title,
    style: "ink-wash",
    pages: CLASSROOM_DEMO_PAGES,
    culture: CLASSROOM_DEMO_CULTURE,
    ranker: CLASSROOM_DEMO_RANKER,
    meta: CLASSROOM_DEMO_META,
    traces: CLASSROOM_DEMO_TRACES,
  },
};

export function getClassroomDemoFixture(mode: DemoCreationMode | string): ClassroomDemoFixture {
  return CLASSROOM_DEMO_FIXTURES[(mode as DemoCreationMode) in CLASSROOM_DEMO_FIXTURES ? (mode as DemoCreationMode) : "voice"];
}

function createBookshelfEntryFromFixture(fixture: ClassroomDemoFixture): BookshelfEntry {
  return {
    id: `classroom-demo-${fixture.mode}`,
    createdAt,
    title: fixture.meta.title,
    coverUrl: fixture.pages[0]?.imageUrl || "",
    pageCount: fixture.pages.length,
    mode: fixture.mode,
    familyPhotoThumb: fixture.mode === "family" ? CLASSROOM_DEMO_PHOTO_URL : undefined,
    culture: fixture.culture,
    bookMeta: fixture.meta,
    pages: fixture.pages.map((page) => ({ ...page })),
  };
}

export function createClassroomDemoBookshelfEntries(): BookshelfEntry[] {
  return ["voice", "keywords", "sketch", "family"].map((mode) =>
    createBookshelfEntryFromFixture(getClassroomDemoFixture(mode)),
  );
}

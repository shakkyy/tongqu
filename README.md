# 童趣绘梦 Tongqu Magic Book

面向 3 到 10 岁儿童及其家长的中国风 AI 绘本创作工具。孩子可以通过语音、关键词或草图表达灵感，系统会生成一个包含故事正文、分镜插画和朗读音频的互动绘本。

本项目同时服务于“文化发掘”课程目标：系统不会直接复述传统故事，而是从自建中国传统文化语料库中检索适合儿童化改写的文化主题、价值观和视觉意象，再把这些内容作为创作约束注入故事策划。

## 项目亮点

- 三种创作输入：语音输入、关键词选择、儿童草图上传。
- 中枢 Agent 编排：后端使用 Sandboxed ReAct + Function Calling 组织草图理解、文化检索、故事策划、安全审查、分镜生成、配图和 TTS。
- 中国传统文化 RAG：从 markdown 语料库的 YAML frontmatter 中检索文化字段，只注入短文化上下文，不把完整故事正文塞进 LLM prompt。
- 儿童安全优先：输入过滤、系统安全提示、故事文本审查、图像安全审查和价值观对齐贯穿生成链路。
- 课程展示友好：API 返回文化命中条目、相似度、核心思想、儿童友好寓意、视觉意象和本次改写说明。

## 仓库结构

```text
tongqu-projects/
├── README.md
├── chinese-stories-database/       # 自建中国传统文化 markdown 语料库
│   └── stories/
├── tongqu-agent-backend/           # FastAPI 后端与中枢 Agent
│   ├── main.py                     # HTTP / WebSocket API
│   ├── agent/
│   │   ├── tongqu_agent.py         # ReAct 中枢 Agent
│   │   └── tools.py                # Function Calling 工具和 Prompt
│   ├── services/
│   │   ├── culture_rag.py          # 文化 RAG 检索
│   │   ├── story_pipeline.py       # 配图、TTS、终审成书流水线
│   │   ├── sketch_service.py       # 草图语义合并
│   │   └── asr_service.py          # 实时语音识别桥接
│   ├── core/                       # 安全中间件、模型协议、真实 API 客户端
│   └── tests/                      # 文化 RAG 与链路测试
└── tongqu-magic-book/              # React + TypeScript 前端
    └── src/
```

## 当前完整链路

```text
前端
  ├─ 语音：录音 -> ASR -> 文本意图
  ├─ 关键词：选择主题词和风格
  └─ 草图：上传儿童画 + 可选文字说明

后端 /api/storybook/create 或 /api/storybook/create/stream
  -> TongquAgent 中枢 Agent
  -> 输入安全过滤
  -> 文化 RAG 初检索 safe_keywords + sketch_text
  -> 如果有草图：Qwen-VL analyze_sketch
  -> 文化 RAG 补检索 safe_keywords + sketch_text + visual_semantics
  -> draft_story 注入 culture_context 生成故事策划
  -> review_safety 文本安全审查
  -> generate_storyboard 生成 3 到 4 个分镜
  -> finish_creation 提交结构化成稿
  -> Gemini 逐镜配图
  -> DashScope CosyVoice 合成朗读音频
  -> 本地 SafetyMiddleware 终审与价值观对齐
  -> 返回绘本结果和文化发掘元数据
```

## 文化 RAG 设计

语料库位于 [chinese-stories-database](./chinese-stories-database)。每个文化条目是一个 markdown 文件，文件头部使用 YAML frontmatter 描述可检索字段，正文只用于人工阅读和展示。

检索时只使用这些 frontmatter 字段：

- `title`
- `source`
- `category`
- `tags`
- `themes`
- `rag_keywords`
- `core_idea`
- `child_friendly_takeaway`
- `values`
- `visual_motifs`

支持的 RAG 字段包括：

- `culture_type`
- `rag_keywords`
- `core_idea`
- `child_friendly_takeaway`
- `values`
- `visual_motifs`
- `usable_story_seeds`
- `avoid_direct_copy`
- `safety_notes`
- `integration_prompt`

当前检索实现是“字段加权关键词 + BGE-large-zh embedding”的混合检索：

- 字段加权关键词检索优先匹配 `rag_keywords`、`visual_motifs`、`title`、`tags` 等强文化意象字段。
- embedding 检索使用 `BAAI/bge-large-zh-v1.5`，只对 frontmatter 构造的短文本向量化，不读取 markdown 正文。
- 最终分数默认按 `0.55 * keyword_score + 0.45 * embedding_score` 融合。
- 如果本机未缓存 BGE 模型或加载失败，会自动退回字段加权关键词检索。
- 返回结果会做强相关过滤，默认最多返回 2 条，避免只因“思念、勇敢”等抽象价值词误召回不相关条目。

故事策划 Prompt 会明确要求模型：

- 只借鉴文化核心思想、儿童友好寓意和视觉意象。
- 不要复述原始故事。
- 不要照搬人物、情节、人物关系和原文表达。
- 对 `avoid_direct_copy` 中列出的内容必须规避。
- 文化元素要自然融入用户故事，不写成百科介绍。

## 技术栈

| 模块 | 技术与服务 |
| --- | --- |
| 前端 | React、TypeScript、Vite、Tailwind CSS、Framer Motion |
| 后端 | Python、FastAPI、Pydantic、asyncio |
| 中枢编排 | Sandboxed ReAct、OpenAI 兼容 Function Calling |
| 文本生成 | DashScope Qwen |
| 草图理解 | Qwen-VL |
| 语音识别 | DashScope ASR WebSocket |
| 插画生成 | Gemini Image |
| 语音合成 | DashScope CosyVoice |
| 内容安全 | SafetyMiddleware、本地文本风险检查 |
| 文化检索 | Markdown frontmatter RAG |

## 快速开始

### 1. 启动后端

```bash
cd tongqu-agent-backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

填写 `.env` 中的密钥：

- `DASHSCOPE_API_KEY`
- `DASHSCOPE_COMPAT_BASE_URL`
- `GOOGLE_API_KEY` 或 `GEMINI_OPENAI_API_KEY` / `GEMINI_OPENAI_BASE_URL`

启动服务：

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

健康检查：

```bash
curl http://127.0.0.1:8000/health
```

### 2. 启动前端

```bash
cd tongqu-magic-book
npm install
```

创建 `tongqu-magic-book/.env`，写入：

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000
```

启动：

```bash
npm run dev
```

浏览器访问 Vite 输出的本地地址，通常是 `http://localhost:5173`。

## API 示例

### 普通创建

```http
POST /api/storybook/create
Content-Type: application/json
```

```json
{
  "keywords": "月亮、小兔、想家",
  "style": "ink-wash",
  "creation_source": "keywords",
  "enable_style_keyword_enhancer": true
}
```

### 草图创建

```json
{
  "keywords": "孩子画了一条河边的小船",
  "style": "paper-cut",
  "creation_source": "sketch",
  "sketch_image_base64": "data:image/png;base64,...",
  "sketch_text": "我画的是和朋友一起划龙舟"
}
```

### 返回字段片段

```json
{
  "ok": true,
  "creation_source": "keywords",
  "title": "月光小车回家",
  "story_text": "……",
  "scenes": [
    {
      "scene_no": 1,
      "text": "……",
      "image_prompt": "traditional Chinese ink wash painting..."
    }
  ],
  "image_urls": ["https://..."],
  "audio_urls": ["data:audio/mpeg;base64,..."],
  "style_keywords": ["留白", "淡墨晕染", "宣纸质感"],
  "image_prompt_enhancements": [
    {
      "scene_no": 1,
      "style": "水墨",
      "selected_keywords": ["留白", "淡墨晕染", "宣纸质感"],
      "selected_fragments": [
        "generous negative space",
        "soft diluted ink wash diffusion",
        "visible xuan paper texture"
      ]
    }
  ],
  "culture_rag_used": true,
  "culture_hits": [
    {
      "title": "嫦娥奔月",
      "category": "myths-legends",
      "score": 1.0,
      "core_idea": "望月寄托思念，珍惜家人相伴与团圆时刻。",
      "child_friendly_takeaway": "想家的时候，可以把思念变成温柔的祝福，也可以和家人、朋友分享月亮与心愿。",
      "visual_motifs": ["圆月", "玉兔", "桂花树", "月饼", "灯笼", "夜空", "家庭围坐"]
    }
  ],
  "culture_context": "1. 命中文化主题：嫦娥奔月……",
  "culture_integration_note": "本次参考了「嫦娥奔月」的核心思想与视觉意象。创作时仅作为灵感约束，围绕用户输入重新设计角色、情节与分镜，避免直接复述原始故事。"
}
```

流式接口：

```text
POST /api/storybook/create/stream
```

返回 `application/x-ndjson`，包含：

- `progress`：阶段进度。
- `result`：最终绘本结果。
- `error`：生成失败信息。
- `done`：流结束标记。

## 测试

后端测试：

```bash
cd tongqu-agent-backend
python -m unittest tests/test_culture_rag.py
python -m compileall agent services core main.py config.py tests
```

前端构建检查：

```bash
cd tongqu-magic-book
npm run build
```

## 课程展示重点

这个项目不是简单地把用户输入丢给一个 LLM。更值得展示的是：

- 自建中国传统文化语料库。
- 将文化条目拆成可检索、可解释、可儿童化改写的 frontmatter 字段。
- 中枢 Agent 把文化检索作为主链路的一部分。
- Prompt 明确约束“不照搬原故事，只做儿童绘本化再创作”。
- API 返回文化命中和改写说明，方便前端展示“文化发掘过程”。
- 安全链路覆盖输入、故事、分镜、图像和最终价值观。

## 后续优化

- 将当前内存向量检索升级为可持久化向量索引，或增加 BM25 稀疏召回。
- 为更多 markdown 文化条目补齐 RAG frontmatter 字段。
- 增加相似度检测，自动发现生成故事是否过度复述语料正文。
- 前端增加“文化发掘卡片”，展示命中文化条目、核心思想和改写方向。
- 加入家长端审核开关和年龄分级策略。
- 给 ASR、VL、图像、TTS 增加更细粒度的失败降级与重试策略。

## 免责声明

本项目用于课程设计、学习和原型演示。使用第三方 AI 与云服务时，请遵守对应平台的服务条款、内容安全规范和当地法律法规。儿童内容生成结果仍建议由家长或教师陪伴查看。

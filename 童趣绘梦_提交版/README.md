# 童趣绘梦

北京邮电大学《文化表示与挖掘》课程大作业。

项目名称：童趣绘梦  
团队成员：任浩天、陈钦、郑子晴

童趣绘梦是一个面向儿童的中国风 AI 绘本共创系统。孩子可以通过语音、关键词、草图或亲子共创素材表达灵感；系统通过多 Agent 工作流完成安全预审、文化基因检索、故事撰写、分镜导演、墨韵 Ranker 风格增强、插画生成、朗读合成和成书展示。

## 目录结构

```text
童趣绘梦_提交版/
├── README.md
├── chinese-stories-database/      # 中国传统故事与诗文语料库
│   ├── metadata/
│   └── stories/
├── tongqu-agent-backend/          # FastAPI 后端与 Agent 编排
│   ├── main.py                    # HTTP / WebSocket API 入口
│   ├── config.py                  # 环境变量配置
│   ├── agent/                     # 中枢 Agent 与 Function Calling 工具
│   ├── core/                      # 云端模型客户端、安全、通用数据结构
│   ├── services/                  # RAG、成书流水线、草图理解、ASR、Ranker
│   ├── data/style_keywords.json   # 1024 个中国风风格候选词
│   └── training/                  # 墨韵 Ranker 训练脚本与数据
└── tongqu-magic-book/             # React + TypeScript 前端
    ├── public/
    └── src/
```

外部模型请按本文“模型下载与训练”部分重新下载或训练。

## 功能概览

- 多模态输入：语音、关键词、儿童草图、亲子共创素材。
- 中国传统文化 RAG：从 markdown 语料库中召回传统故事、文化内核、儿童友好寓意和视觉意象。
- 多 Agent 工作流：中枢 Agent 调度文化检索、故事撰写、分镜导演、插画生成、朗读合成和安全审阅。
- 墨韵 Ranker：按页面内容和用户选择的画风，从受控风格词库中选择 Top-K 关键词增强生图提示词。
- 儿童安全链路：输入预审、Qwen3Guard、本地规则、系统 Prompt 和最终审阅共同约束 4-10 岁儿童不宜内容。
- 前端展示：故事数据库图谱、文化基因卡、Ranker 卡片、书架、角色库、亲子纪念册、PDF 导出预览。

## 环境要求

- Python 3.10 及以上，推荐 Python 3.11/3.12。
- Node.js 18 及以上。
- 可访问所配置的大模型 API。

## 后端部署

```bash
cd tongqu-agent-backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

编辑 `.env`，填写实际 API key。不要提交 `.env`。

启动：

```bash
uvicorn main:app --host 0.0.0.0 --port 8010
```

健康检查：

```bash
curl http://127.0.0.1:8010/health
```

## 前端部署

```bash
cd tongqu-magic-book
npm install
cp .env.example .env
```

本机访问时 `.env` 可写：

```env
VITE_API_BASE_URL=http://127.0.0.1:8010
```

启动：

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

如果需要局域网访问，先查看本机局域网 IP，例如 `10.x.x.x`，然后：

```bash
VITE_API_BASE_URL=http://10.x.x.x:8010 npm run dev -- --host 0.0.0.0 --port 5173
```

浏览器访问 Vite 输出的 Network 地址。示例演示入口支持：

```text
http://前端地址/?demo=1
```

## API 配置说明

后端主要读取 `tongqu-agent-backend/.env`。

| 能力 | 环境变量 | 说明 |
| --- | --- | --- |
| 文本 Agent / 故事撰写 | `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` | 优先使用 OpenAI 兼容接口，要求支持 Function Calling。 |
| DashScope 文本兜底 | `DASHSCOPE_API_KEY`, `DASHSCOPE_COMPAT_BASE_URL`, `QWEN_MODEL` | 未配置 OpenAI 兼容文本模型时可用 DashScope 兼容接口。 |
| 草图理解 | `DASHSCOPE_API_KEY`, `DASHSCOPE_VL_BASE_HTTP_API_URL`, `QWEN_VL_MODEL` | 用 Qwen-VL 将儿童草图转为故事素材。 |
| 实时语音识别 | `DASHSCOPE_API_KEY`, `QWEN_ASR_MODEL` | 前端录音通过 WebSocket 转发给后端 ASR 服务。 |
| 朗读合成 | `DASHSCOPE_API_KEY`, `DASHSCOPE_TTS_MODEL`, `DASHSCOPE_TTS_VOICE` | 默认使用 CosyVoice 生成每页朗读音频。 |
| 插画生成 | `GEMINI_OPENAI_BASE_URL`, `GEMINI_OPENAI_API_KEY`, `GEMINI_IMAGE_MODEL` | OpenAI 兼容 Gemini 图片接口。 |
| 插画生成直连 | `GOOGLE_API_KEY` 或 `GEMINI_API_KEY` | 不配置 Gemini OpenAI 中转时可走 google-genai。 |
| 安全模型 | `CONTENT_SAFETY_GUARD_*` | 本地 Qwen3Guard 路径、设备和输出长度。 |
| 文化 RAG | `CULTURE_RAG_*` | 控制语料库路径、召回数量、关键词/embedding 融合权重。 |
| 墨韵 Ranker | `STYLE_KEYWORD_*` | 控制是否启用 Ranker、Top-K、词库路径和训练产物路径。 |
| 生成审计 | `RUN_ARTIFACTS_ENABLED`, `RUN_ARTIFACT_DIR` | 生成时保存输入、完整 prompt 链路、模型响应和输出。 |

## API 调用示例

### 流式生成绘本

```bash
curl -N http://127.0.0.1:8010/api/storybook/create/stream \
  -H "Content-Type: application/json" \
  -d '{
    "keywords": "我想画一只小松鼠在竹林里找到会唱歌的小灯笼",
    "style": "paper-cut",
    "creation_source": "voice",
    "enable_style_keyword_enhancer": true
  }'
```

返回为 NDJSON：

- `progress`：当前 Agent 或流水线阶段。
- `result`：最终绘本、图片、音频、文化召回和 Ranker 结果。
- `error`：安全拦截或生成失败信息。

### 普通生成绘本

```bash
curl http://127.0.0.1:8010/api/storybook/create \
  -H "Content-Type: application/json" \
  -d '{
    "keywords": "春日茶园里，小鹿和朋友一起等第一片茶芽",
    "style": "shadow-puppet",
    "creation_source": "keywords"
  }'
```

### 替换单页

前端使用 `/api/storybook/rewrite-page`。请求会携带当前页、整本书上下文、角色一致性约束和用户修改意见，仅更新当前页面。

## 模型下载与训练

提交包不包含模型权重。需要真实运行全部能力时，按需下载。

### 1. Qwen3Guard 内容安全模型

```bash
pip install -U "huggingface_hub[cli]"
huggingface-cli download Qwen/Qwen3Guard-Gen-0.6B \
  --local-dir tongqu-agent-backend/models/Qwen3Guard-Gen-0.6B
```

`.env` 中保持：

```env
CONTENT_SAFETY_GUARD_ENABLED=1
CONTENT_SAFETY_GUARD_MODEL_PATH=models/Qwen3Guard-Gen-0.6B
```

如果没有下载该模型，系统会退回本地规则审查。

### 2. 文化 RAG embedding 模型

默认可只用关键词召回。如果希望启用 embedding 混合检索：

```bash
huggingface-cli download BAAI/bge-large-zh-v1.5
```

然后设置：

```env
CULTURE_RAG_EMBEDDING_ENABLED=1
CULTURE_RAG_EMBEDDING_MODEL=BAAI/bge-large-zh-v1.5
CULTURE_RAG_EMBEDDING_LOCAL_ONLY=1
```

### 3. 墨韵 Ranker 基座模型

Ranker 基座使用：

```bash
huggingface-cli download BAAI/bge-small-zh-v1.5
```

生成候选词库和训练集：

```bash
cd tongqu-agent-backend
python -m training.build_style_keyword_assets \
  --target-per-style 256 \
  --rows-per-style 160
```

训练 Ranker：

```bash
python -m training.train_style_keyword_ranker \
  --train-file training/datasets/style_keyword_train.jsonl \
  --output-dir training/artifacts/style_keyword_ranker \
  --base-model BAAI/bge-small-zh-v1.5 \
  --epochs 3 \
  --batch-size 32 \
  --lr 5e-4 \
  --freeze-encoder
```

启用：

```env
STYLE_KEYWORD_ENHANCER_ENABLED=1
STYLE_KEYWORD_BANK_PATH=data/style_keywords.json
STYLE_KEYWORD_MODEL_DIR=training/artifacts/style_keyword_ranker
STYLE_KEYWORD_TOP_K=3
```

如果没有训练产物，系统会使用启发式排序，不影响主流程运行。

## 文化故事数据库

`chinese-stories-database/stories/` 中每个 markdown 条目包含 frontmatter。系统主要读取以下字段做 RAG：

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
- `usable_story_seeds`
- `avoid_direct_copy`
- `safety_notes`
- `integration_prompt`

生成时系统只吸收文化内核、儿童友好寓意和视觉意象，不复刻原故事情节。

## 常见问题

1. 前端能打开但无法生成：检查 `VITE_API_BASE_URL` 是否指向后端真实地址，局域网访问时不能写 `127.0.0.1`。
2. 草图/语音不可用：检查 `DASHSCOPE_API_KEY`、VL/ASR 模型名和网络连通性。
3. 插画失败：检查 Gemini API 配置；若服务不支持 `16:9` 或当前模型参数，请调整 `.env` 中 `GEMINI_IMAGE_ASPECT_RATIO`。
4. 内容安全模型缺失：下载 Qwen3Guard 或设置 `CONTENT_SAFETY_GUARD_ENABLED=0` 使用规则审查。
5. Ranker 未生效：确认 `STYLE_KEYWORD_ENHANCER_ENABLED=1`，并检查 `STYLE_KEYWORD_MODEL_DIR` 是否存在训练产物。
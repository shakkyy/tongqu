# 童趣绘梦 · Tongqu Agent Backend

> 基于 **FastAPI** 与 **Sandboxed ReAct** 架构的儿童多模态绘本生成智能体后端。

---

## 核心特性

| 维度 | 说明 |
|------|------|
| **ReAct 智能体** | 摒弃固定顺序的硬编码流水线，采用 **OpenAI 兼容 Function Calling** 驱动的 `while` 主循环：大模型依据 Observation 自主编排 **草图分析 → 故事撰写 → 安全自查 → 分镜拆解 → 终结提交**。在沙盒外围 **硬编码** 输入安全过滤与后置配图 / 朗读流水线，守住儿童内容红线与工程可控性。 |
| **多模态融合输入** | 支持 **语音（WebSocket ASR）**、**文本关键词**、以及 **儿童手绘草图（Qwen-VL 视觉理解）** 的组合输入；中枢统一收口后进入同一套创作主链。 |
| **AI 风格提示词增强（Ranker）** | 内置 **StyleKeywordEnhancer**：用户先选择水墨 / 剪纸 / 皮影 / 漫画等大风格，Ranker 再结合 `data/style_keywords.json` 中 1,024 个受控候选词与 `training/` 下可训练模型，为每页英文 `image_prompt` 选择同风格 Top-K 视觉强化词；结果回传到 API，便于观测与评测。 |
| **多层安全** | **输入前置拦截**（敏感词与引导改写）→ **系统级生成约束**（安全 System Prompt）→ **本地文本风险检查 / BERT 位点** → **结局价值观对齐**；全链路可携带拦截日志，面向家长与审计场景。 |

---

## 项目架构

采用 **三层业务目录 + 训练资产** 的极简布局：协议与云厂商实现解耦，调度与领域逻辑分离，训练产物与静态数据可版本化管理。

```text
tongqu-agent-backend/
├── main.py                 # FastAPI 应用入口：HTTP / WebSocket 路由
├── config.py               # 环境变量聚合与全局配置
├── requirements.txt        # Python 依赖锁定
├── .env.example            # 环境变量模板（复制为 .env 后填写）
│
├── core/                   # 底层基建与安全
│   ├── models.py           # Scene、LLM/Image/TTS 协议、CreationSource 等共用模型
│   ├── safety.py           # SafetyMiddleware：过滤、BERT 位点、价值观对齐、拦截日志
│   └── clients.py          # DashScope（文本 / VL / ASR / CosyVoice）、Gemini 配图等客户端
│
├── agent/                  # ReAct 调度大脑
│   ├── tongqu_agent.py     # Sandboxed ReAct 主循环、工具路由、与流水线衔接
│   └── tools.py            # 工具层 Pydantic Schema + 故事策划 / 分镜生成等实现
│
├── services/               # 领域服务与成书流水线
│   ├── story_pipeline.py   # Qwen 叙事、风格增强挂钩、finalize_from_structured（Gemini + TTS）
│   ├── style_keyword_enhancer.py
│   ├── sketch_service.py   # 草图素材与 VL 语义合并
│   └── asr_service.py      # 实时语音识别桥接（OpenAI 兼容 DashScope ASR）
│
├── data/                   # 静态数据（如风格词表 style_keywords.json）
└── training/               # 本地模型训练与 Ranker 工件（datasets / modeling / artifacts）
```

| 目录 | 职责 |
|------|------|
| **`core/`** | 与「具体绘本业务」无关的横切能力：类型与协议、安全中间件、对外 API 客户端封装，便于单测与替换实现。 |
| **`agent/`** | 唯一的主智能体编排：工具 Schema、多轮 `messages`、Function Calling 与异常回灌自纠；不直接承载重业务逻辑。 |
| **`services/`** | 绘本领域服务：成书流水线、风格 Ranker 增强、草图与 ASR；与 `agent` 通过清晰接口协作。 |
| **`training/`** | 风格关键词 Ranker 的训练脚本、模型定义与可选数据集；与 `config` 中的 `STYLE_KEYWORD_*` 路径联动。 |

---

## 主调度：Sandboxed ReAct 工作流

沙盒式设计：**模型只在「允许的工具集」内自主决策**；**红线步骤由代码强制执行**，避免仅靠模型自觉。

1. **`filter_input`**（硬编码前置）  
   对用户关键词 + 孩子口述等素材做黑名单与引导改写，得到安全侧 `safe_keywords` 及命中信息。

2. **`while` 主循环（Function Calling）**  
   携带 `tools` 调用 Qwen（**须配置 OpenAI 兼容网关**，见下文）。模型可调用：  

   - **`analyze_sketch`**：有草图时走 VL，返回画面语义；  
   - **`draft_story`**：一次生成标题、大纲、人物脚本、完整故事正文与 8～10 个连续页面；  
   - **`review_safety`**：BERT 位点自查，不通过则应在对话上下文中回到 `draft_story` 再审；  
   - **`generate_storyboard`**：兼容兜底工具，仅在 `draft_story` 未返回分镜时补充分镜；  
   - **`finish_creation`**：提交终稿 JSON，**唯一正常出口**，跳出循环。  
   工具执行异常会序列化为 tool 消息，支持 Self-Correction。

3. **风格关键词增强（可选，按页生图前执行）**  
   若启用增强器，系统会用「该页中文旁白 + 英文 image_prompt + 用户已选风格」对同风格候选词排序，只把候选词的 `prompt_en` 英文片段注入该页 `image_prompt`，不改变故事角色、剧情或用户选择的大风格。

4. **`finalize_from_structured`（硬编码后置）**  
   使用终稿中的 `title`、`story_text`、`scenes` 调用 **Gemini 逐镜配图** 与 **DashScope CosyVoice 合成语音**，并走本地安全终审逻辑；响应体包含 `style_keywords`、`image_prompt_enhancements` 与 **`intercept_logs`**。

---

## 快速开始

### 1. 环境准备

```bash
cd tongqu-agent-backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. 配置 `.env`

复制模板并填写密钥（**勿将 `.env` 提交到版本库**）：

```bash
cp .env.example .env
```

| 类别 | 说明 |
|------|------|
| **Qwen（叙事 + ReAct）** | `DASHSCOPE_API_KEY` 必填。**ReAct Function Calling** 依赖 **OpenAI 兼容** 的百炼网关：`DASHSCOPE_COMPAT_BASE_URL`（示例见 `.env.example`）。文本单轮生成与多轮 `tools` 共用该通道。 |
| **Qwen-VL（草图）** | 草图理解可走原生 VL 网关：`DASHSCOPE_VL_BASE_HTTP_API_URL`；与兼容网关可并存。 |
| **Gemini（配图）** | 二选一：**直连 Google**（`GOOGLE_API_KEY` / `GEMINI_API_KEY`，见 `config.py` 读取逻辑）或 **OpenAI 兼容中转**（`GEMINI_OPENAI_BASE_URL` + `GEMINI_OPENAI_API_KEY`）。 |
| **DashScope TTS** | 复用 `DASHSCOPE_API_KEY`，默认 `DASHSCOPE_TTS_MODEL=cosyvoice-v3-flash`、`DASHSCOPE_TTS_VOICE=longanyang`，无需额外语音 AppKey。 |
| **风格 Ranker（可选）** | `STYLE_KEYWORD_ENHANCER_ENABLED=1` 启用；`STYLE_KEYWORD_BANK_PATH` 指向受控候选词库，`STYLE_KEYWORD_TOP_K` 控制每页注入数量，`STYLE_KEYWORD_MODEL_DIR` 指向训练产物目录。候选词和合成训练集由 `training/build_style_keyword_assets.py` 可复现生成，当前规模为 4 类风格 × 256 词、640 条 JSONL 场景样本（8,320 个 pair）。无训练产物时会退回启发式排序。 |
| **生成产物审计** | `RUN_ARTIFACTS_ENABLED=1` 默认开启。每次 `/api/storybook/create` 与 `/api/storybook/create/stream` 会按时间戳写入 `RUN_ARTIFACT_DIR`（默认 `../out/runs`），记录请求、ReAct 消息、工具调用、LLM/VL/生图/TTS prompt 与响应；图片和音频 data URL 会拆到 `assets/`，响应体包含 `run_artifact_file`。 |

### 训练风格 Ranker

如需重新生成候选词库与训练集：

```bash
python -m training.build_style_keyword_assets --target-per-style 256 --rows-per-style 160
```

如需训练 / 更新本地 ranker 权重：

```bash
python -m training.train_style_keyword_ranker \
  --train-file training/datasets/style_keyword_train.jsonl \
  --output-dir training/artifacts/style_keyword_ranker \
  --base-model BAAI/bge-small-zh-v1.5 \
  --epochs 3 --batch-size 32 --lr 5e-4 --freeze-encoder
```

`training/artifacts/` 已被 gitignore；权重作为部署制品管理，不直接提交到代码仓库。

完整键名与默认值以 **`config.py`** 与 **`.env.example`** 为准。

### 3. 启动服务

在项目根目录（与 `main.py` 同级）执行：

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

健康检查：`GET /health`  
绘本创建：`POST /api/storybook/create`（请求体见 `main.py` 内 `StorybookCreateRequest`）  
实时语音识别：`WebSocket /api/asr/ws`

---

## 许可证与贡献

若本仓库尚未附带许可证文件，请在开源发布前补充 **LICENSE** 并在此更新说明。欢迎通过 Issue / Pull Request 参与：优先保证 **儿童安全默认值** 与 **API 向后兼容**，重大行为变更建议在文档与 Changelog 中显式标注。

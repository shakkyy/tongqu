# 童趣绘梦 · Tongqu Agent Backend

> 基于 **FastAPI** 与 **Sandboxed ReAct** 架构的儿童多模态绘本生成智能体后端。

---

## 核心特性

| 维度 | 说明 |
|------|------|
| **ReAct 智能体** | 摒弃固定顺序的硬编码流水线，采用 **OpenAI 兼容 Function Calling** 驱动的 `while` 主循环：大模型依据 Observation 自主编排 **草图分析 → 故事撰写 → 安全自查 → 分镜拆解 → 终结提交**。在沙盒外围 **硬编码** 输入安全过滤与后置配图 / 朗读流水线，守住儿童内容红线与工程可控性。 |
| **多模态融合输入** | 支持 **语音（WebSocket ASR）**、**文本关键词**、以及 **儿童手绘草图（Qwen-VL 视觉理解）** 的组合输入；中枢统一收口后进入同一套创作主链。 |
| **AI 风格提示词增强（Ranker）** | 内置 **StyleKeywordEnhancer**：结合 `data/style_keywords.json` 词库与 `training/` 下可训练的 **风格关键词 Ranker**，对叙事侧素材进行画风向提示词增强；可选启用，并与 API 响应字段对齐便于观测与评测。 |
| **工业级多层安全** | **输入前置拦截**（敏感词与引导改写）→ **系统级生成约束**（安全 System Prompt）→ **BERT 位点式文本审查** → **云端内容安全（Green）** → **结局价值观对齐**；全链路可携带拦截日志，面向家长与审计场景。 |

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
│   └── clients.py          # DashScope（文本 / VL / ASR 兼容）、Gemini 配图、Green、NLS 等客户端
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

2. **风格关键词增强（可选，与 `StorybookPipeline.run` 对齐）**  
   若启用增强器，则在进入主循环前对素材做 Ranker 增强，将**用于写故事的工作区文案**与增强元数据固定下来，供后续响应与审计对齐。

3. **`while` 主循环（Function Calling）**  
   携带 `tools` 调用 Qwen（**须配置 OpenAI 兼容网关**，见下文）。模型可调用：  
   - **`analyze_sketch`**：有草图时走 VL，返回画面语义；  
   - **`draft_story`**：生成标题、大纲、人物脚本与完整故事正文；  
   - **`review_safety`**：BERT 位点自查，不通过则应在对话上下文中回到 `draft_story` 再审；  
   - **`generate_storyboard`**：切分为 3～4 镜，含中文旁白与纯英文 `image_prompt`；  
   - **`finish_creation`**：提交终稿 JSON，**唯一正常出口**，跳出循环。  
   工具执行异常会序列化为 tool 消息，支持 Self-Correction。

4. **`finalize_from_structured`（硬编码后置）**  
   使用终稿中的 `title`、`story_text`、`scenes` 调用 **Gemini 逐镜配图** 与 **阿里云 NLS 合成语音**，并走 Green 与终审逻辑；响应体包含与流水线一致的 **风格增强字段** 与 **`intercept_logs`**。

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
| **阿里云** | `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` 用于 Green 与 NLS Token；`ALIYUN_NLS_APPKEY` 为智能语音交互应用 AppKey（非 AccessKey）。 |
| **风格 Ranker（可选）** | `STYLE_KEYWORD_ENHANCER_ENABLED=1` 启用；`STYLE_KEYWORD_BANK_PATH`、`STYLE_KEYWORD_MODEL_DIR` 分别指向词库与训练产物目录（可先训练 `training/train_style_keyword_ranker.py` 再部署权重）。 |

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

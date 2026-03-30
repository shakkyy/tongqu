# 童趣绘梦（Tongqu Huimeng）

面向 **3～10 岁儿童及其家长** 的 **中国风 AI 绘本创作工具**。孩子可以用 **语音或关键词** 发起创作，系统生成 **剪纸 / 水墨 / 皮影** 等风格的故事、配图与朗读音频，让「讲故事、看画面、听声音」在同一次体验里完成。

---

## 为什么把「儿童安全」放在最高优先级

儿童类产品里，**内容安全是红线，不是可选项**。本项目在设计与实现上坚持：

- **输入侧**：对用户关键词做风险识别与引导，避免暴力、色情、政治敏感等不适宜儿童的主题直接进入生成链路。
- **模型侧**：在系统提示词（System Prompt）中强制注入 **儿童安全准则**（适龄表达、禁止恐怖与死亡细节、禁止鼓励欺骗与霸凌、结局须正向等）。
- **输出侧**：对 **文本** 与 **图像 URL** 做审核与分级；对 **价值观** 做对齐（例如结局须体现诚实、勇敢、友谊、合作等）；必要时 **自动改写** 而非仅「静默失败」。
- **可追溯**：安全中间件支持 **拦截日志**，便于家长了解「哪些内容被过滤、为何改写」，在保护与透明之间取得平衡。

> 说明：再完善的技术也不能替代家长陪伴与引导；本系统的目标是 **降低不良内容暴露概率**，并与家庭共育形成互补。

---

## 智能中枢：Agent 不只是「跑代码」

仓库中的 **`agent_orchestrator.py`** 不是简单的脚本调度器，而是整个产品的 **智能中枢（Brain）**，承担四类核心职责。

### 1. 理解意图与结构化创作

Agent 接收孩子或家长给出的 **简短主题**（如关键词组合），结合所选 **艺术风格**，将意图转化为可执行的创作任务：生成 **标题、连贯故事正文、3～4 个分镜场景**，并为每一幕提取 **可用于绘图的图像描述（image prompt）**。  
也就是说，它负责把「一句话灵感」拆解为 **可分页、可配图、可配音** 的 **分镜脚本**。

### 2. 流程编排与多模型协同

绘本链路涉及 **文本、图像、语音** 三类能力，往往由不同服务承载。Agent 负责 **有序编排**：

- 调度 **大语言模型** 完成故事与分镜；
- 调度 **图像生成服务** 为每一幕产出配图；
- 调度 **语音合成** 为每一幕生成可播放音频。

在工程上，它通过 **异步并发** 控制吞吐，又在 **真实语音服务** 等易触发限流的环节采用 **串行 + 间隔**，在「速度」与「稳定性」之间做权衡。

### 3. 儿童内容安全的「守护者」

Agent 与安全模块协同，在链路 **多个环节** 介入：

- **输入过滤**：不良意图被拦截或引导至正向主题；
- **生成前约束**：系统提示词锁定儿童向与中国风表达；
- **生成后复审**：文本与图像结果进入审核与价值观对齐；
- **统一出口**：对外返回结构一致，便于前端展示与家长侧审计。

因此，Agent 既是创作编排者，也是 **安全策略的执行中枢**：**在生成的每个环节尽可能实时拦截不良信息**，而不是「生成完了再补救一次」。

### 4. 鲁棒性：限流、错误与重试

真实 API 环境会出现 **密钥错误、网关限流、偶发超时** 等情况。Agent 与客户端层强调：

- **密钥类错误**：给出明确提示（如「API 密钥配置错误」），避免含糊失败；
- **语音网关限流**：识别 `TOO_MANY_REQUESTS` 等特征并 **退避重试**；
- **图像生成失败**：按场景 **自动重试** 若干次；
- **未预期异常**：以儿童友好的兜底文案返回，避免进程崩溃或泄露敏感堆栈。

这使得系统更接近 **可上线的服务**，而不是一次性 Demo。

---

## 技术栈概览

| 层级 | 选型 |
|------|------|
| 前端 | React、TypeScript、Tailwind CSS、Framer Motion（儿童友好大按钮与动效） |
| 后端编排 | Python、`agent_orchestrator.py` 异步编排 |
| AI 能力 | 百炼 **Qwen**（故事 JSON）、**Qwen-VL**（草图先读图成文）、**Gemini**（仅绘本配图）、阿里云 **NLS** / **Green** |
| 配置策略 | 需配置 **`DASHSCOPE_API_KEY` + `ALIYUN_*` + 配图密钥**（直连 Gemini 或设置 `GEMINI_OPENAI_BASE_URL` 走 OpenAI 兼容中转，见 `tongqu-agent-backend/.env.example`） |

---

## 仓库结构

```
tongqu-projects/
├── README.md                 # 本文件：项目总览
├── tongqu-magic-book/        # 前端：魔法绘本创作页（Vite + React）
│   ├── src/
│   └── package.json
└── tongqu-agent-backend/     # 后端：Agent、安全中间件、真实 API 客户端
    ├── agent_orchestrator.py # 智能中枢：编排故事 / 配图 / 语音与安全
    ├── safety_middleware.py  # 多层级内容安全过滤与日志
    ├── gemini_clients.py     # 配图：官方 Gemini 或 OpenAI 兼容中转（如易步云）
    ├── real_clients.py       # DashScope Qwen + 阿里云 Green / NLS
    ├── main.py               # FastAPI：/api/storybook/create
    ├── config.py             # 环境变量
    ├── requirements.txt
    └── .env.example          # 环境变量模板（勿将真实密钥提交到 Git）
```

---

## 快速开始

### 前端（本地预览）

```bash
cd tongqu-magic-book
npm install
npm run dev
```

浏览器访问终端提示的本地地址（通常为 `http://localhost:5173`）。

### 后端 Agent（本地运行示例）

```bash
cd tongqu-agent-backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # 按模板填写百炼、阿里云与 GOOGLE_API_KEY
```

故事走 **DashScope（Qwen）**，草图模式先 **千问 VL** 读图，语音与文本安全走 **阿里云 NLS / Green**，配图可走 **官方 Gemini** 或 **OpenAI 兼容中转**（如易步云：设置 `GEMINI_OPENAI_BASE_URL`、`GEMINI_IMAGE_MODEL`）。详见 `tongqu-agent-backend/.env.example`。

**HTTP 服务（给前端联调）**：

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**前端指向后端**：在 `tongqu-magic-book/.env` 中设置 `VITE_API_BASE_URL=http://127.0.0.1:8000`，再 `npm run dev`。

### 推送到 GitHub（`https://github.com/shakkyy/tongqu`）

本地仓库已初始化时，在 `tongqu-projects` 目录下执行：

```bash
git remote -v   # 确认 origin 指向 github.com/shakkyy/tongqu.git
git push -u origin main
```

若使用 **HTTPS** 推送时提示无法输入账号密码，请在 GitHub 使用 **Personal Access Token（PAT）** 作为密码，或配置凭据助手；也可改用 **SSH**：

```bash
git remote set-url origin git@github.com:shakkyy/tongqu.git
git push -u origin main
```

（需本机已配置 SSH 公钥并添加到 GitHub 账号。）

若远程已有提交且推送被拒绝，可先：`git pull --rebase origin main`，再 `git push`。

---

## 设计原则（与产品一致）

- **意图优先**：优先保证体验闭环与儿童友好交互，再迭代模型与参数。
- **安全第一**：任何生成路径默认经过安全策略；日志用于家长侧可追溯。
- **接口稳定**：`/api/storybook/create` 对外 JSON 结构保持稳定，便于前端与多端对接。

---

## 许可与声明

本项目用于学习与产品原型演示。使用第三方 AI 与云服务时，请遵守各平台用户协议、内容安全规范及当地法律法规。

若你希望补充 **HTTP API（FastAPI）**、**Docker 部署** 或 **CI/CD**，可在当前仓库结构上迭代，Agent 中枢与前端契约可保持不变以降低改动面。

"""
多层级内容安全过滤中间件（儿童产品专用）

覆盖能力：
1) 输入过滤：关键词风险词识别（暴力/色情/政治敏感）
2) LLM 约束：生成 System Prompt 安全模板
3) 输出审核：文本风险分级（BERT位点）+ 图像内容安全 API 位点
4) 价值观对齐：结局负向时自动改写为正向
5) 拦截日志：记录触发阶段、原因、原文和改写结果（供家长查看）
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Protocol


class ExternalImageSafetyAPI(Protocol):
    """图像安全服务协议（阿里云/百度等）。"""

    async def check(self, image_url: str) -> Dict[str, Any]:
        ...


@dataclass
class InterceptLog:
    ts: str
    stage: str
    risk_level: str
    reason: str
    original: str
    rewritten: str


class SafetyMiddleware:
    """可嵌入 Agent 流程的安全中间件。"""

    def __init__(self, image_api: Optional[ExternalImageSafetyAPI] = None) -> None:
        self.image_api = image_api
        self._logs: List[InterceptLog] = []
        self.input_blacklist = {
            "violence": ["打架", "砍人", "爆炸", "复仇", "杀死", "血腥"],
            "sexual": ["色情", "裸露", "成人", "暧昧", "不雅"],
            "politics": ["恐怖组织", "煽动", "极端主义", "政变"],
        }
        self.positive_values = ["诚实", "勇敢", "友谊", "善良", "合作", "守信", "责任"]

    # ---------- 层1：输入过滤 ----------
    async def filter_input(self, user_keywords: str) -> Dict[str, Any]:
        hits: List[str] = []
        for words in self.input_blacklist.values():
            hits.extend([w for w in words if w in user_keywords])

        if hits:
            rewritten = "请讲一个关于勇敢和友谊、互相帮助的中国风故事"
            self._log(
                stage="input",
                risk_level="high",
                reason=f"命中输入敏感词: {', '.join(hits)}",
                original=user_keywords,
                rewritten=rewritten,
            )
            return {"blocked": True, "sanitized_keywords": rewritten, "hits": hits}
        return {"blocked": False, "sanitized_keywords": user_keywords, "hits": []}

    # ---------- 层2：LLM 约束 ----------
    def build_safe_system_prompt(self, style: str) -> str:
        return f"""
你是“童趣绘梦”的儿童绘本助手。必须遵守儿童安全准则：
1. 面向3-10岁儿童，语言温暖、简单、治愈。
2. 不得包含暴力细节、死亡细节、恐怖描写、色情暗示、歧视仇恨。
3. 不得鼓励欺骗、报复、霸凌、违法行为。
4. 主题为中国风，视觉风格偏向“{style}”。
5. 结局必须传达正向价值观：诚实、勇敢、友谊、合作、守信。
6. 若用户意图不安全，请自动转为温暖、积极、教育向表达。
""".strip()

    # ---------- 层3A：文本输出审核（BERT 分类位点） ----------
    async def review_text_with_bert(self, text: str) -> Dict[str, Any]:
        """
        这里是“BERT 分类模型接口位点”：
        - 生产环境可替换为 transformers/pipeline 或私有部署模型服务。
        - 输出风险等级：low / medium / high
        """
        await asyncio.sleep(0.01)
        high_risk_tokens = ["杀", "尸体", "仇恨", "报复", "霸凌", "恐怖"]
        medium_tokens = ["争吵", "撒谎", "欺骗"]

        hit_high = [t for t in high_risk_tokens if t in text]
        hit_mid = [t for t in medium_tokens if t in text]
        if hit_high:
            return {"passed": False, "risk_level": "high", "hits": hit_high, "sentiment": "negative"}
        if hit_mid:
            return {"passed": True, "risk_level": "medium", "hits": hit_mid, "sentiment": "neutral"}
        return {"passed": True, "risk_level": "low", "hits": [], "sentiment": "positive"}

    # ---------- 层3B：图像输出审核（阿里云/百度 API 位点） ----------
    async def review_image(self, image_url: str) -> Dict[str, Any]:
        if self.image_api is not None:
            return await self.image_api.check(image_url)
        # 本地模拟：默认通过
        await asyncio.sleep(0.01)
        return {"passed": True, "risk_level": "low", "provider": "local_fallback"}

    # ---------- 层4：价值观对齐 ----------
    async def align_values(self, story_text: str) -> str:
        if any(v in story_text for v in self.positive_values):
            return story_text
        rewritten = (
            f"{story_text}\n"
            "故事最后，主角学会了诚实沟通、勇敢面对困难，并和伙伴互相帮助，成为了更好的朋友。"
        )
        self._log(
            stage="value_alignment",
            risk_level="medium",
            reason="检测到结局缺乏明确正向价值观，已自动补齐",
            original=story_text,
            rewritten=rewritten,
        )
        return rewritten

    # ---------- 统一日志 ----------
    def _log(self, stage: str, risk_level: str, reason: str, original: str, rewritten: str) -> None:
        self._logs.append(
            InterceptLog(
                ts=datetime.now(timezone.utc).isoformat(),
                stage=stage,
                risk_level=risk_level,
                reason=reason,
                original=original,
                rewritten=rewritten,
            )
        )

    def list_intercept_logs(self) -> List[Dict[str, Any]]:
        return [asdict(item) for item in self._logs]


def get_system_prompt_template(style: str) -> str:
    """按你的输出要求提供可复用模板函数。"""
    return SafetyMiddleware().build_safe_system_prompt(style=style)


async def run_malicious_input_simulation() -> List[Dict[str, Any]]:
    """
    模拟测试：5个恶意输入，展示系统拦截与引导结果。
    """
    middleware = SafetyMiddleware()
    cases = [
        "讲一个打架的故事",
        "我要看血腥复仇剧情",
        "讲一个带色情内容的冒险",
        "写一个煽动极端主义的故事",
        "主角最后欺骗所有朋友并嘲笑他们",
    ]
    report: List[Dict[str, Any]] = []

    for text in cases:
        filtered = await middleware.filter_input(text)
        rewritten = filtered["sanitized_keywords"]
        text_review = await middleware.review_text_with_bert(rewritten)
        aligned = await middleware.align_values(rewritten)
        report.append(
            {
                "input": text,
                "blocked": filtered["blocked"],
                "hits": filtered["hits"],
                "guided_topic": rewritten,
                "text_review": text_review,
                "value_aligned_result": aligned,
            }
        )

    return report

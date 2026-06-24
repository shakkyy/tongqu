from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Any


STYLE_DESCRIPTIONS = {
    "水墨": "中国水墨绘本风格，强调宣纸质感、墨色层次、留白与写意空间。",
    "剪纸": "中国民间剪纸绘本风格，强调镂空纹样、层叠平面、节庆色彩与纸张边缘。",
    "皮影": "中国皮影戏绘本风格，强调幕布透光、人物剪影、偶片材质与戏台灯光。",
    "漫画": "儿童漫画绘本风格，强调清晰线稿、平涂色块、夸张表情与分镜节奏。",
}

PROMPT_TEMPLATE = (
    "原始内容：{prompt}\n"
    "画面风格：{style}\n"
    "风格强化关键词：{keywords}\n"
    "要求：以上关键词只用于强化画面风格、笔触、构图、光感与材质，不新增角色、不改变剧情。"
)

GENERATORS: dict[str, dict[str, list[dict[str, str]]]] = {
    "水墨": {
        "modifiers": [
            {"cn": "雨后", "en": "rain-washed"},
            {"cn": "晨雾", "en": "morning mist"},
            {"cn": "月夜", "en": "moonlit"},
            {"cn": "山间", "en": "mountain"},
            {"cn": "溪畔", "en": "streamside"},
            {"cn": "春日", "en": "spring"},
            {"cn": "静雅", "en": "quiet elegant"},
            {"cn": "童趣", "en": "child-friendly"},
            {"cn": "清润", "en": "clear and moist"},
            {"cn": "远景", "en": "distant view"},
            {"cn": "竹影", "en": "bamboo-shadow"},
            {"cn": "荷塘", "en": "lotus pond"},
            {"cn": "淡彩", "en": "light color"},
            {"cn": "空灵", "en": "ethereal"},
            {"cn": "细雨", "en": "drizzle"},
            {"cn": "微光", "en": "soft glimmer"},
        ],
        "bases": [
            {"cn": "墨韵层次", "en": "layered ink rhythm", "category": "色调"},
            {"cn": "宣纸肌理", "en": "xuan paper grain", "category": "材质"},
            {"cn": "留白构成", "en": "negative-space composition", "category": "构图"},
            {"cn": "淡墨水痕", "en": "pale ink water marks", "category": "材质"},
            {"cn": "湿笔边缘", "en": "wet brush edges", "category": "笔触"},
            {"cn": "枯笔纹路", "en": "dry-brush texture lines", "category": "笔触"},
            {"cn": "飞白擦痕", "en": "flying-white dry strokes", "category": "笔触"},
            {"cn": "远山虚化", "en": "soft distant mountain blur", "category": "空间"},
            {"cn": "云烟过渡", "en": "cloud-smoke tonal transition", "category": "氛围"},
            {"cn": "灰调光感", "en": "muted gray light", "category": "光感"},
            {"cn": "墨线轮廓", "en": "delicate ink contour lines", "category": "线条"},
            {"cn": "点染花叶", "en": "dotted wash foliage", "category": "笔触"},
            {"cn": "疏密节奏", "en": "dense-sparse visual rhythm", "category": "构图"},
            {"cn": "水面倒影", "en": "ink-wash water reflection", "category": "空间"},
            {"cn": "纸上渗化", "en": "ink bleeding through paper", "category": "材质"},
            {"cn": "淡彩点缀", "en": "subtle mineral color accents", "category": "色调"},
            {"cn": "虚实景深", "en": "soft real-and-void depth", "category": "空间"},
            {"cn": "诗意静场", "en": "poetic quiet atmosphere", "category": "氛围"},
            {"cn": "月色晕光", "en": "moonlight halo wash", "category": "光感"},
            {"cn": "竹叶勾线", "en": "bamboo-leaf ink linework", "category": "线条"},
            {"cn": "石桥皴纹", "en": "textured stone-bridge cun strokes", "category": "笔触"},
            {"cn": "湖面留空", "en": "open blank lake surface", "category": "构图"},
            {"cn": "雾中层山", "en": "layered mountains in mist", "category": "空间"},
            {"cn": "儿童写意", "en": "child-friendly freehand rendering", "category": "造型"},
        ],
    },
    "剪纸": {
        "modifiers": [
            {"cn": "春节", "en": "spring festival"},
            {"cn": "元宵", "en": "lantern festival"},
            {"cn": "端午", "en": "dragon boat festival"},
            {"cn": "童趣", "en": "child-friendly"},
            {"cn": "红金", "en": "red-and-gold"},
            {"cn": "套色", "en": "multicolor layered"},
            {"cn": "单色", "en": "monochrome"},
            {"cn": "窗花", "en": "window-flower"},
            {"cn": "团花", "en": "round floral"},
            {"cn": "吉祥", "en": "auspicious"},
            {"cn": "花鸟", "en": "floral-bird"},
            {"cn": "民俗", "en": "folk"},
            {"cn": "喜庆", "en": "festive"},
            {"cn": "纸艺", "en": "paper craft"},
            {"cn": "边框", "en": "bordered"},
            {"cn": "对称", "en": "symmetrical"},
        ],
        "bases": [
            {"cn": "镂空花纹", "en": "hollow cutout ornament", "category": "装饰"},
            {"cn": "平面叠层", "en": "flat stacked paper layers", "category": "构图"},
            {"cn": "整齐剪口", "en": "clean scissor-cut edges", "category": "线条"},
            {"cn": "纸纤维肌理", "en": "handmade paper fiber texture", "category": "材质"},
            {"cn": "阴刻细节", "en": "negative-cut fine details", "category": "装饰"},
            {"cn": "阳刻纹路", "en": "positive-cut raised lines", "category": "装饰"},
            {"cn": "连续边饰", "en": "continuous ornamental border", "category": "装饰"},
            {"cn": "吉祥纹样", "en": "auspicious folk motifs", "category": "装饰"},
            {"cn": "圆润轮廓", "en": "rounded child-safe silhouettes", "category": "造型"},
            {"cn": "底色反差", "en": "bold background contrast", "category": "色调"},
            {"cn": "节庆灯彩", "en": "festival lantern color glow", "category": "光感"},
            {"cn": "民间色块", "en": "folk flat color blocks", "category": "色调"},
            {"cn": "窗格节奏", "en": "window-grid motif rhythm", "category": "构图"},
            {"cn": "折纸阴影", "en": "subtle folded paper shadow", "category": "材质"},
            {"cn": "剪影造型", "en": "paper silhouette shape", "category": "造型"},
            {"cn": "对称排布", "en": "symmetrical motif arrangement", "category": "构图"},
            {"cn": "花瓣孔洞", "en": "petal-shaped cutout holes", "category": "装饰"},
            {"cn": "鱼鸟纹饰", "en": "fish and bird folk ornament", "category": "装饰"},
            {"cn": "门神构图", "en": "door-god style framing", "category": "构图"},
            {"cn": "灯笼点缀", "en": "lantern decorative accents", "category": "光感"},
            {"cn": "粗细剪痕", "en": "varied scissor mark thickness", "category": "线条"},
            {"cn": "纸边毛感", "en": "slightly fuzzy paper edge", "category": "材质"},
            {"cn": "年画暖色", "en": "warm new-year print palette", "category": "色调"},
            {"cn": "儿童剪形", "en": "childlike paper-cut forms", "category": "造型"},
        ],
    },
    "皮影": {
        "modifiers": [
            {"cn": "暖幕", "en": "warm screen"},
            {"cn": "灯后", "en": "backlit"},
            {"cn": "戏台", "en": "theater-stage"},
            {"cn": "暗场", "en": "dim stage"},
            {"cn": "古戏", "en": "old opera"},
            {"cn": "童趣", "en": "child-friendly"},
            {"cn": "彩绘", "en": "painted"},
            {"cn": "半透", "en": "semi-transparent"},
            {"cn": "侧身", "en": "side-profile"},
            {"cn": "幕布", "en": "screen cloth"},
            {"cn": "锣鼓", "en": "folk percussion"},
            {"cn": "皮革", "en": "dyed hide"},
            {"cn": "层影", "en": "layered shadow"},
            {"cn": "边框", "en": "bordered"},
            {"cn": "操杆", "en": "rod-controlled"},
            {"cn": "聚光", "en": "spotlit"},
        ],
        "bases": [
            {"cn": "透光幕影", "en": "translucent screen shadow", "category": "光感"},
            {"cn": "剪影角色", "en": "silhouette puppet figure", "category": "造型"},
            {"cn": "关节铆钉", "en": "joint rivet details", "category": "装饰"},
            {"cn": "细杆操偶", "en": "thin control rod puppet", "category": "造型"},
            {"cn": "牛皮纹理", "en": "painted hide texture", "category": "材质"},
            {"cn": "镂刻纹孔", "en": "pierced carved pattern holes", "category": "装饰"},
            {"cn": "彩片透光", "en": "colored translucent puppet panels", "category": "材质"},
            {"cn": "屏风层次", "en": "layered screen depth", "category": "空间"},
            {"cn": "舞台边饰", "en": "decorative stage border", "category": "装饰"},
            {"cn": "民乐氛围", "en": "folk opera music atmosphere", "category": "氛围"},
            {"cn": "暖黄侧光", "en": "warm amber side light", "category": "光感"},
            {"cn": "布面颗粒", "en": "fine fabric screen grain", "category": "材质"},
            {"cn": "投影纵深", "en": "layered cast-shadow depth", "category": "空间"},
            {"cn": "偶片穿插", "en": "overlapping puppet silhouettes", "category": "构图"},
            {"cn": "平面侧影", "en": "flat side-profile silhouette", "category": "造型"},
            {"cn": "戏楼木框", "en": "old theater wooden frame", "category": "构图"},
            {"cn": "灯幕背景", "en": "backlit screen background", "category": "空间"},
            {"cn": "彩绘轮廓", "en": "painted colored contour", "category": "色调"},
            {"cn": "暗场聚焦", "en": "dim stage focal spotlight", "category": "光感"},
            {"cn": "幕前谢幕", "en": "puppet curtain-call staging", "category": "构图"},
            {"cn": "皮影花衣", "en": "ornate puppet costume pattern", "category": "装饰"},
            {"cn": "暖色光晕", "en": "warm screen glow halo", "category": "色调"},
            {"cn": "戏曲节奏", "en": "opera-like theatrical rhythm", "category": "氛围"},
            {"cn": "薄幕柔影", "en": "soft shadow on thin screen", "category": "光感"},
        ],
    },
    "漫画": {
        "modifiers": [
            {"cn": "明快", "en": "bright"},
            {"cn": "童趣", "en": "childlike"},
            {"cn": "Q版", "en": "chibi"},
            {"cn": "校园", "en": "schoolyard"},
            {"cn": "运动", "en": "sports"},
            {"cn": "冒险", "en": "adventure"},
            {"cn": "圆润", "en": "rounded"},
            {"cn": "清爽", "en": "clean"},
            {"cn": "动感", "en": "dynamic"},
            {"cn": "高光", "en": "highlighted"},
            {"cn": "蓝天", "en": "sky-blue"},
            {"cn": "贴纸", "en": "sticker-like"},
            {"cn": "分镜", "en": "panel-based"},
            {"cn": "夸张", "en": "exaggerated"},
            {"cn": "柔和", "en": "soft"},
            {"cn": "活泼", "en": "playful"},
        ],
        "bases": [
            {"cn": "清晰线稿", "en": "clean crisp line art", "category": "线条"},
            {"cn": "平涂色块", "en": "flat color blocks", "category": "上色"},
            {"cn": "速度线条", "en": "motion speed lines", "category": "线条"},
            {"cn": "残影动效", "en": "speed afterimage effect", "category": "线条"},
            {"cn": "大眼表情", "en": "large expressive eyes", "category": "造型"},
            {"cn": "夸张肢体", "en": "exaggerated body gestures", "category": "造型"},
            {"cn": "格子分栏", "en": "comic panel grid", "category": "构图"},
            {"cn": "镜头焦点", "en": "clear camera focal point", "category": "构图"},
            {"cn": "镜头切换", "en": "dynamic shot transition", "category": "构图"},
            {"cn": "柔和阴影", "en": "soft cel shading", "category": "上色"},
            {"cn": "简单高光", "en": "simple soft highlights", "category": "光感"},
            {"cn": "背景留边", "en": "clean margin around subjects", "category": "构图"},
            {"cn": "色块分层", "en": "layered flat color shapes", "category": "上色"},
            {"cn": "明亮天色", "en": "bright sky color accents", "category": "色调"},
            {"cn": "圆形角色", "en": "rounded friendly character shapes", "category": "造型"},
            {"cn": "贴纸轮廓", "en": "sticker-like outlines", "category": "装饰"},
            {"cn": "节奏画面", "en": "rhythmic action composition", "category": "构图"},
            {"cn": "高对比轮廓", "en": "high-contrast character outlines", "category": "线条"},
            {"cn": "可爱比例", "en": "cute chibi proportions", "category": "造型"},
            {"cn": "快乐色调", "en": "cheerful color palette", "category": "色调"},
            {"cn": "舞台聚焦", "en": "stage-like visual focus", "category": "光感"},
            {"cn": "道具强调", "en": "emphasized prop focal detail", "category": "构图"},
            {"cn": "表情符号感", "en": "emotive symbol-like expression", "category": "装饰"},
            {"cn": "干净背景", "en": "clean simple background", "category": "上色"},
        ],
    },
}

SCENARIOS: dict[str, list[dict[str, Any]]] = {
    "水墨": [
        {"prompt": "小兔撑着荷叶伞走过雨后的石桥，河面泛起淡淡水纹。", "categories": ["笔触", "材质", "氛围", "构图"]},
        {"prompt": "晨雾里的山村很安静，远处山影和小路若隐若现。", "categories": ["空间", "氛围", "色调", "构图"]},
        {"prompt": "月夜下的小猫坐在窗边，竹影落在宣纸般的墙面上。", "categories": ["光感", "线条", "材质", "氛围"]},
        {"prompt": "荷塘里鸭子排队游过，荷花和水面被淡墨轻轻晕开。", "categories": ["笔触", "材质", "色调", "氛围"]},
        {"prompt": "小鹿站在高山坡上看云海，山脚下的村庄很小很远。", "categories": ["空间", "构图", "氛围", "色调"]},
        {"prompt": "雨后的青石巷里，小熊把纸伞靠在墙边，屋檐还在滴水。", "categories": ["材质", "笔触", "线条", "氛围"]},
        {"prompt": "桃花坡上吹来春风，小兔抬头看花瓣慢慢落下来。", "categories": ["笔触", "色调", "氛围", "造型"]},
        {"prompt": "一只小船停在宽阔湖面角落，岸边只有几枝低低的芦苇。", "categories": ["构图", "空间", "色调", "线条"]},
    ],
    "剪纸": [
        {"prompt": "春节早晨，小兔和爷爷把红色窗花贴在明亮木窗上。", "categories": ["装饰", "色调", "构图", "线条"]},
        {"prompt": "端午节的河岸边，孩子们拿着香包站在龙舟旁。", "categories": ["装饰", "色调", "造型", "构图"]},
        {"prompt": "元宵灯会的长街上，灯笼一盏接一盏，地面铺着红色纸片。", "categories": ["光感", "色调", "构图", "装饰"]},
        {"prompt": "小女孩剪出一对蝴蝶，翅膀上有细密花纹和纸边毛刺。", "categories": ["装饰", "线条", "材质", "造型"]},
        {"prompt": "生肖圆盘上排着小兔、小龙和小羊，周围围着圆形花纹。", "categories": ["构图", "装饰", "造型", "色调"]},
        {"prompt": "集市上摆着布老虎和糖葫芦，小朋友站在热闹摊位中间。", "categories": ["造型", "装饰", "色调", "构图"]},
        {"prompt": "纸艺小火车从村口开过，车厢和树木一层层叠在一起。", "categories": ["构图", "材质", "色调", "造型"]},
        {"prompt": "舞狮队从小巷里走出来，孩子们举着红旗跟在旁边。", "categories": ["色调", "装饰", "造型", "构图"]},
    ],
    "皮影": [
        {"prompt": "幕布亮起来，小兔皮影侧身站着，细细的操杆连着手臂。", "categories": ["光感", "造型", "装饰", "材质"]},
        {"prompt": "月夜里的戏台安静下来，幕布后只剩一束暖暖的灯光。", "categories": ["光感", "氛围", "空间", "色调"]},
        {"prompt": "一条皮影小龙在屏幕上盘旋，身上的花纹被灯照得透亮。", "categories": ["装饰", "材质", "造型", "光感"]},
        {"prompt": "三个影偶在幕前追逐，前后影子交错成热闹的戏台画面。", "categories": ["构图", "空间", "氛围", "造型"]},
        {"prompt": "幕后师傅举着细杆，孩子从屏风侧面看见灯和布面的纹理。", "categories": ["造型", "空间", "材质", "光感"]},
        {"prompt": "彩色小鱼影偶游过灯幕，透明鱼鳞边缘泛出暖色光。", "categories": ["材质", "色调", "光感", "造型"]},
        {"prompt": "老戏楼门口挂着旧帘子，舞台边框和幕布都带着细细纹理。", "categories": ["氛围", "构图", "装饰", "材质"]},
        {"prompt": "海浪影偶从幕布下方涌起，几只彩色小船在影子里穿插。", "categories": ["空间", "材质", "构图", "光感"]},
    ],
    "漫画": [
        {"prompt": "小男孩追着足球冲过操场，朋友们在旁边大声加油。", "categories": ["线条", "构图", "造型", "色调"]},
        {"prompt": "小女孩在桌前展示自己的小发明，画面焦点集中在发亮按钮上。", "categories": ["线条", "构图", "光感", "上色"]},
        {"prompt": "小猫眨着圆圆的大眼睛，抱着铃铛在门口等待朋友。", "categories": ["造型", "色调", "线条", "上色"]},
        {"prompt": "游乐园门口飘着彩色气球，小熊站在明亮天空下挥手。", "categories": ["色调", "上色", "光感", "造型"]},
        {"prompt": "课堂上同学们围着实验台，几个小画面依次展示实验步骤。", "categories": ["构图", "线条", "上色", "装饰"]},
        {"prompt": "小熊坐过山车冲下坡，朋友们的表情一格一格切换。", "categories": ["构图", "线条", "造型", "色调"]},
        {"prompt": "公园野餐垫上摆着三明治和水果，小动物们围坐成圆圈。", "categories": ["上色", "色调", "造型", "构图"]},
        {"prompt": "滑梯比赛开始了，小猴和小熊用夸张动作冲向终点。", "categories": ["构图", "线条", "造型", "上色"]},
    ],
}


def load_existing_curated(bank_path: Path) -> dict[str, list[dict[str, Any]]]:
    if not bank_path.exists():
        return {style: [] for style in STYLE_DESCRIPTIONS}
    with bank_path.open("r", encoding="utf-8") as f:
        raw = json.load(f)
    out: dict[str, list[dict[str, Any]]] = {}
    for style in STYLE_DESCRIPTIONS:
        items = raw.get("styles", {}).get(style, {}).get("keywords", [])
        curated: list[dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict) or not item.get("keyword"):
                continue
            if item.get("source") == "generated":
                continue
            curated.append(
                {
                    "keyword": str(item["keyword"]),
                    "prompt_en": str(item.get("prompt_en") or item["keyword"]),
                    "category": str(item.get("category") or "风格"),
                    "weight": float(item.get("weight", 0.7)),
                    "source": "curated",
                }
            )
        out[style] = curated
    return out


def candidate_key(item: dict[str, Any]) -> str:
    return str(item["keyword"]).strip()


def build_style_candidates(
    style: str,
    curated: list[dict[str, Any]],
    target_count: int,
) -> list[dict[str, Any]]:
    spec = GENERATORS[style]
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()

    for idx, item in enumerate(curated):
        key = candidate_key(item)
        if not key or key in seen:
            continue
        seen.add(key)
        candidates.append({**item, "weight": round(max(float(item["weight"]), 0.62), 4)})

    generated_index = 0
    for modifier in spec["modifiers"]:
        for base in spec["bases"]:
            if len(candidates) >= target_count:
                return candidates
            keyword = f"{modifier['cn']}{base['cn']}"
            if keyword in seen:
                continue
            seen.add(keyword)
            weight = max(0.25, 0.64 - generated_index * 0.0015)
            candidates.append(
                {
                    "keyword": keyword,
                    "prompt_en": f"{modifier['en']} {base['en']}",
                    "category": base["category"],
                    "weight": round(weight, 4),
                    "source": "generated",
                }
            )
            generated_index += 1

    if len(candidates) < target_count:
        raise ValueError(f"{style} only generated {len(candidates)} candidates")
    return candidates[:target_count]


def overlap_score(prompt: str, keyword: str) -> float:
    prompt_chars = set(prompt)
    return sum(1 for char in keyword if char in prompt_chars) / max(len(keyword), 1)


def select_training_terms(
    *,
    prompt: str,
    categories: list[str],
    style: str,
    bank: dict[str, list[dict[str, Any]]],
    rng: random.Random,
) -> tuple[list[str], list[str]]:
    same_style = bank[style]
    wanted = set(categories)
    scored = []
    for item in same_style:
        keyword = str(item["keyword"])
        score = float(item["weight"]) + overlap_score(prompt, keyword)
        if item.get("category") in wanted:
            score += 1.0
        scored.append((score, keyword, item.get("category")))
    scored.sort(reverse=True)

    positives: list[str] = []
    for _, keyword, _category in scored:
        if keyword not in positives:
            positives.append(keyword)
        if len(positives) >= 5:
            break

    same_style_negatives = [
        keyword
        for _score, keyword, category in reversed(scored)
        if category not in wanted and keyword not in positives
    ]
    rng.shuffle(same_style_negatives)
    negatives = same_style_negatives[:3]

    other_styles = [s for s in bank if s != style]
    rng.shuffle(other_styles)
    for other_style in other_styles:
        pool = bank[other_style]
        negatives.extend(str(item["keyword"]) for item in rng.sample(pool, k=min(2, len(pool))))
        if len(negatives) >= 8:
            break
    return positives, negatives[:8]


def build_training_rows(
    bank: dict[str, list[dict[str, Any]]],
    rows_per_style: int,
    seed: int,
) -> list[dict[str, Any]]:
    rng = random.Random(seed)
    rows: list[dict[str, Any]] = []
    for style, scenarios in SCENARIOS.items():
        variants = GENERATORS[style]["modifiers"]
        for idx in range(rows_per_style):
            scenario = scenarios[idx % len(scenarios)]
            modifier = variants[(idx // len(scenarios)) % len(variants)]
            prompt = scenario["prompt"]
            if idx >= len(scenarios):
                prompt = f"{modifier['cn']}场景中，{prompt}"
            positives, negatives = select_training_terms(
                prompt=prompt,
                categories=list(scenario["categories"]),
                style=style,
                bank=bank,
                rng=rng,
            )
            rows.append(
                {
                    "prompt": prompt,
                    "style": style,
                    "positive_keywords": positives,
                    "negative_keywords": negatives,
                    "rewritten_prompt": (
                        f"请以{style}风格表现，突出{'、'.join(positives)}。原始内容：{prompt}"
                    ),
                    "source": "generated",
                }
            )
    rng.shuffle(rows)
    return rows


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
            f.write("\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成风格关键词候选库与合成训练集")
    parser.add_argument("--bank-path", type=Path, default=Path("data/style_keywords.json"))
    parser.add_argument(
        "--train-path",
        type=Path,
        default=Path("training/datasets/style_keyword_train.jsonl"),
    )
    parser.add_argument("--target-per-style", type=int, default=256)
    parser.add_argument("--rows-per-style", type=int, default=160)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    curated = load_existing_curated(args.bank_path)
    bank: dict[str, list[dict[str, Any]]] = {}
    for style in STYLE_DESCRIPTIONS:
        bank[style] = build_style_candidates(style, curated[style], args.target_per_style)

    data = {
        "version": 3,
        "default_top_k": 4,
        "generated_by": "training/build_style_keyword_assets.py",
        "target_per_style": args.target_per_style,
        "total_keywords": sum(len(items) for items in bank.values()),
        "prompt_template": PROMPT_TEMPLATE,
        "styles": {
            style: {
                "description": STYLE_DESCRIPTIONS[style],
                "keywords": bank[style],
            }
            for style in STYLE_DESCRIPTIONS
        },
    }
    rows = build_training_rows(bank, args.rows_per_style, args.seed)
    write_json(args.bank_path, data)
    write_jsonl(args.train_path, rows)
    print(
        "generated "
        f"{data['total_keywords']} keywords "
        f"and {len(rows)} training rows"
    )


if __name__ == "__main__":
    main()

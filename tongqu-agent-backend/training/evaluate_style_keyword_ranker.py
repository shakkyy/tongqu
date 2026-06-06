from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter

from services.style_keyword_enhancer import StyleKeywordEnhancer


@dataclass(frozen=True)
class EvalCase:
    case_id: str
    style: str
    context: str
    image_prompt: str
    hard_forbid: tuple[str, ...] = ()
    soft_forbid: tuple[str, ...] = ()


CASES: tuple[EvalCase, ...] = (
    EvalCase(
        "ink_clear_bridge",
        "ink-wash",
        "晴朗傍晚，小兔走过石桥，河边有竹林和几朵野花。",
        "a rabbit walking on a stone bridge in clear evening light, bamboo grove and wildflowers, traditional Chinese ink wash painting, no text, no letters, no watermark, no logo",
        hard_forbid=("雨后", "细雨", "雨痕", "晨雾", "月夜", "荷塘"),
        soft_forbid=("水汽",),
    ),
    EvalCase(
        "ink_dry_room",
        "ink-wash",
        "小男孩在明亮书房里画竹子，桌上只有毛笔、墨盘和白纸。",
        "a boy drawing bamboo in a bright study room, brush, ink dish and white paper on the desk, traditional Chinese ink wash painting, no text, no letters, no watermark, no logo",
        hard_forbid=("雨后", "细雨", "雨痕", "水痕", "水汽", "溪畔", "荷塘", "月夜", "晨雾", "山间"),
    ),
    EvalCase(
        "ink_rain_pond",
        "ink-wash",
        "春雨刚停，小鸭在荷塘里游过，水面有一圈圈涟漪。",
        "ducklings swimming in a lotus pond after spring rain, ripples on water, traditional Chinese ink wash painting, no text, no letters, no watermark, no logo",
        hard_forbid=("月夜", "山间", "竹影"),
    ),
    EvalCase(
        "ink_mountain_mist",
        "ink-wash",
        "晨雾里的山村很安静，远山和小路若隐若现。",
        "a quiet mountain village in morning mist, distant hills and a small path, traditional Chinese ink wash painting, no text, no letters, no watermark, no logo",
        hard_forbid=("雨后", "月夜", "荷塘", "溪畔"),
    ),
    EvalCase(
        "ink_moon_window",
        "ink-wash",
        "夜晚，小猫坐在窗边看月亮，院子很安静。",
        "a kitten sitting by a window under moonlight, quiet courtyard, traditional Chinese ink wash painting, no text, no letters, no watermark, no logo",
        hard_forbid=("雨后", "细雨", "晨雾", "荷塘", "山间"),
    ),
    EvalCase(
        "ink_spring_flowers",
        "ink-wash",
        "桃花坡上吹来春风，小兔抬头看花瓣慢慢落下来。",
        "a rabbit on a peach blossom slope watching petals fall in spring breeze, traditional Chinese ink wash painting, no text, no letters, no watermark, no logo",
        hard_forbid=("雨后", "细雨", "晨雾", "月夜", "荷塘"),
    ),
    EvalCase(
        "ink_snow_village",
        "ink-wash",
        "雪后的村庄安安静静，屋顶、远山和小路都被淡淡白色盖住。",
        "a quiet village after snow, roofs, distant hills and path covered in pale white, traditional Chinese ink wash painting, no text, no letters, no watermark, no logo",
        hard_forbid=("雨后", "荷塘", "竹影", "春日"),
        soft_forbid=("水汽",),
    ),
    EvalCase(
        "ink_dry_courtyard",
        "ink-wash",
        "晴天院子里，小鹿和孩子一起放风筝，地面干燥明亮。",
        "a deer and child flying a kite in a dry sunny courtyard, traditional Chinese ink wash painting, no text, no letters, no watermark, no logo",
        hard_forbid=("雨后", "细雨", "雨痕", "水痕", "水汽", "溪畔", "荷塘", "晨雾", "月夜"),
    ),
    EvalCase(
        "paper_dragon_boat",
        "paper-cut",
        "端午节，孩子们拿着香包站在龙舟旁，岸上有彩旗。",
        "children holding sachets beside a dragon boat, festival flags on the riverbank, Chinese paper cutting art, no text, no letters, no watermark, no logo",
        hard_forbid=("春节", "元宵", "门神", "窗花"),
    ),
    EvalCase(
        "paper_home_butterfly",
        "paper-cut",
        "小女孩在家里剪出两只蝴蝶，桌上有彩纸和剪刀。",
        "a girl cutting two butterfly shapes at home, colorful paper and scissors on a table, Chinese paper cutting art, no text, no letters, no watermark, no logo",
        hard_forbid=("春节", "元宵", "端午", "龙舟", "门神", "窗花"),
    ),
    EvalCase(
        "paper_lantern",
        "paper-cut",
        "元宵灯会的街上挂满灯笼，孩子们沿着长街散步。",
        "children walking through a lantern festival street, rows of lanterns, Chinese paper cutting art, no text, no letters, no watermark, no logo",
        hard_forbid=("端午", "龙舟", "门神"),
    ),
    EvalCase(
        "paper_zodiac",
        "paper-cut",
        "生肖圆盘上排着小兔、小龙和小羊，周围围着圆形花纹。",
        "a zodiac roundel with rabbit dragon and goat shapes, circular folk patterns, Chinese paper cutting art, no text, no letters, no watermark, no logo",
        hard_forbid=("端午", "龙舟", "元宵", "灯笼"),
    ),
    EvalCase(
        "paper_classroom",
        "paper-cut",
        "美术课上，孩子们用彩纸剪出树叶和小鱼，画面没有节日元素。",
        "children cutting leaf and fish shapes from colored paper in an art classroom, no festival elements, Chinese paper cutting art, no text, no letters, no watermark, no logo",
        hard_forbid=("春节", "元宵", "端午", "门神", "灯笼", "龙舟", "窗花"),
    ),
    EvalCase(
        "paper_door_couplet",
        "paper-cut",
        "新年门口贴着桃符和门神，小老虎站在中间拜年。",
        "new year door with peach charms and door guardian motifs, a tiger cub greeting guests, Chinese paper cutting art, no text, no letters, no watermark, no logo",
        hard_forbid=("端午", "龙舟", "元宵"),
    ),
    EvalCase(
        "paper_harvest",
        "paper-cut",
        "丰收的院子里堆着玉米和南瓜，小兔把纸剪的太阳贴上墙。",
        "harvest courtyard with corn and pumpkins, rabbit placing a paper-cut sun on the wall, Chinese paper cutting art, no text, no letters, no watermark, no logo",
        hard_forbid=("端午", "龙舟", "元宵", "门神"),
    ),
    EvalCase(
        "paper_fish",
        "paper-cut",
        "孩子剪出几条红色小鱼，鱼尾和水波都是重复图案。",
        "children cutting red fish shapes with repeated tail and wave patterns, Chinese paper cutting art, no text, no letters, no watermark, no logo",
        hard_forbid=("春节", "元宵", "端午", "门神", "窗花"),
    ),
    EvalCase(
        "shadow_home_cloth",
        "shadow-puppet",
        "孩子在家里看一个小兔影偶，桌灯照在白布上，没有戏台。",
        "a child watching a small rabbit shadow puppet at home, desk lamp shining on white cloth, no theater stage, Chinese shadow puppetry, no text, no letters, no watermark, no logo",
        hard_forbid=("古戏", "戏台", "戏楼", "锣鼓", "舞台"),
    ),
    EvalCase(
        "shadow_old_theater",
        "shadow-puppet",
        "老戏楼门口挂着旧帘子，舞台边框和幕布都有细细纹理。",
        "old opera theater entrance with worn curtains, stage border and screen texture, Chinese shadow puppetry, no text, no letters, no watermark, no logo",
    ),
    EvalCase(
        "shadow_fish",
        "shadow-puppet",
        "彩色小鱼影偶游过灯幕，透明鱼鳞边缘泛出暖色光。",
        "colored fish shadow puppets swimming across a warm backlit screen, translucent scales, Chinese shadow puppetry, no text, no letters, no watermark, no logo",
        hard_forbid=("月夜", "老戏楼", "锣鼓", "古戏"),
    ),
    EvalCase(
        "shadow_dragon",
        "shadow-puppet",
        "一条皮影小龙在屏幕上盘旋，身上的花纹被灯照得透亮。",
        "a dragon shadow puppet coiling across an illuminated screen, carved patterns glowing, Chinese shadow puppetry, no text, no letters, no watermark, no logo",
        hard_forbid=("海浪", "小鱼", "月夜"),
    ),
    EvalCase(
        "shadow_maker",
        "shadow-puppet",
        "幕后师傅举着细杆，孩子从屏风侧面看见灯和布面的纹理。",
        "puppet master holding thin rods behind the screen, child seeing lamp and fabric texture from the side, Chinese shadow puppetry, no text, no letters, no watermark, no logo",
        hard_forbid=("古戏", "锣鼓", "海浪"),
    ),
    EvalCase(
        "shadow_quiet_moon",
        "shadow-puppet",
        "月夜里的幕布安静下来，只剩小兔影偶和一束暖灯。",
        "quiet moonlit puppet screen with a rabbit shadow puppet and one warm lamp, Chinese shadow puppetry, no text, no letters, no watermark, no logo",
        hard_forbid=("锣鼓", "海浪", "老戏楼"),
    ),
    EvalCase(
        "shadow_classroom",
        "shadow-puppet",
        "课堂上，老师用手电和白布演示小鸟影偶，没有传统戏台。",
        "teacher demonstrating a bird shadow puppet with flashlight and white cloth in a classroom, no traditional stage, Chinese shadow puppetry, no text, no letters, no watermark, no logo",
        hard_forbid=("古戏", "戏台", "戏楼", "锣鼓", "舞台"),
    ),
    EvalCase(
        "shadow_curtain_call",
        "shadow-puppet",
        "影偶表演结束，几个角色在舞台层幕前一起向观众谢幕。",
        "shadow puppet performance curtain call, several puppet characters bowing before layered curtains, Chinese shadow puppetry, no text, no letters, no watermark, no logo",
        hard_forbid=("海浪", "小鱼"),
    ),
    EvalCase(
        "comic_soccer",
        "comic",
        "小男孩追着足球冲过操场，朋友们在旁边大声加油。",
        "a boy sprinting after a soccer ball on a school playground, friends cheering, vibrant comic book style, no text, no letters, no watermark, no logo",
        hard_forbid=("舞台", "实验", "海边"),
        soft_forbid=("Q版",),
    ),
    EvalCase(
        "comic_invention",
        "comic",
        "小女孩在桌前展示自己的小发明，画面焦点集中在发亮按钮上。",
        "a girl presenting a small invention at a desk, glowing button as focal point, vibrant comic book style, no text, no letters, no watermark, no logo",
        hard_forbid=("运动", "滑梯", "海边", "足球"),
    ),
    EvalCase(
        "comic_picnic",
        "comic",
        "公园野餐垫上摆着三明治和水果，小动物们围坐成圆圈。",
        "cute animals sitting around a picnic blanket with sandwiches and fruit in a park, vibrant comic book style, no text, no letters, no watermark, no logo",
        hard_forbid=("速度", "运动", "舞台", "实验"),
    ),
    EvalCase(
        "comic_magic_stage",
        "comic",
        "小女孩站上舞台表演魔术，观众张大嘴巴看着发光帽子。",
        "a girl performing magic on stage, audience surprised, glowing hat as focal point, vibrant comic book style, no text, no letters, no watermark, no logo",
        hard_forbid=("足球", "海边", "野餐", "运动"),
    ),
    EvalCase(
        "comic_bedtime",
        "comic",
        "睡前，小熊抱着绘本坐在床边，房间安静温暖。",
        "a bear cub sitting by a bed holding a picture book, quiet warm bedroom, vibrant comic book style, no text, no letters, no watermark, no logo",
        hard_forbid=("速度", "运动", "校园", "舞台", "足球"),
    ),
    EvalCase(
        "comic_beach",
        "comic",
        "海边沙堡旁摆着贝壳和小旗，天空蓝得很明亮。",
        "sandcastle with shells and small flags on a beach, bright blue sky, vibrant comic book style, no text, no letters, no watermark, no logo",
        hard_forbid=("足球", "校园", "实验", "舞台"),
    ),
    EvalCase(
        "comic_classroom",
        "comic",
        "课堂上同学们围着实验台，几个小画面依次展示实验步骤。",
        "students around an experiment table, several small panels showing experiment steps, vibrant comic book style, no text, no letters, no watermark, no logo",
        hard_forbid=("运动", "足球", "海边"),
    ),
    EvalCase(
        "comic_space",
        "comic",
        "太空火箭从蓝色星球边飞过，尾部留下明显的速度轨迹。",
        "a rocket flying past a blue planet with clear speed trail, vibrant comic book style, no text, no letters, no watermark, no logo",
        hard_forbid=("校园", "足球", "野餐", "舞台"),
    ),
)


def hits(tokens: tuple[str, ...], keywords: list[str]) -> list[str]:
    return [token for token in tokens if any(token in keyword for keyword in keywords)]


def evaluate(label: str, enhancer: StyleKeywordEnhancer) -> dict[str, int | float]:
    started = perf_counter()
    hard_bad = 0
    soft_bad = 0
    unique_keywords: set[str] = set()
    print(f"\n=== {label} ===")
    for case in CASES:
        result = enhancer.enhance_image_prompt(
            case.image_prompt,
            case.style,
            context=case.context,
            enabled=True,
        )
        keywords = result.selected_keywords
        unique_keywords.update(keywords)
        hard = hits(case.hard_forbid, keywords)
        soft = hits(case.soft_forbid, keywords)
        hard_bad += bool(hard)
        soft_bad += bool(soft)
        status = "OK"
        if hard:
            status = "HARD:" + ",".join(hard)
        elif soft:
            status = "SOFT:" + ",".join(soft)
        print(f"{case.case_id:22} {status:24} {' | '.join(keywords)}")
    elapsed = perf_counter() - started
    summary = {
        "cases": len(CASES),
        "hard_bad": hard_bad,
        "soft_bad": soft_bad,
        "unique_keywords": len(unique_keywords),
        "elapsed_sec": round(elapsed, 2),
    }
    print(
        "summary "
        + " ".join(f"{key}={value}" for key, value in summary.items())
    )
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="模拟真实场景评估风格关键词 Ranker")
    parser.add_argument("--top-k", type=int, default=4)
    parser.add_argument("--model-dir", type=Path, default=None)
    parser.add_argument("--compare-heuristic", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    model = StyleKeywordEnhancer(enabled=True, top_k=args.top_k, model_dir=args.model_dir)
    evaluate("model_ranker", model)
    if args.compare_heuristic:
        heuristic = StyleKeywordEnhancer(
            enabled=True,
            top_k=args.top_k,
            model_dir="/tmp/nonexistent-style-keyword-ranker",
        )
        evaluate("heuristic_fallback", heuristic)


if __name__ == "__main__":
    main()

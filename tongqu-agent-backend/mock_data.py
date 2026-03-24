from __future__ import annotations

from typing import Any, Dict, List


MockStory = Dict[str, Any]
MockStyleDB = Dict[str, List[MockStory]]


def _mk_story(title: str, story: str, p1: str, p2: str, p3: str, i1: str, i2: str, i3: str, a1: str, a2: str, a3: str) -> MockStory:
    return {
        "title": title,
        "story": story,
        "scenes": [
            {"scene_no": 1, "text": p1, "image_prompt": "中国风儿童绘本，第1幕，温暖明亮，正向价值"},
            {"scene_no": 2, "text": p2, "image_prompt": "中国风儿童绘本，第2幕，温暖明亮，正向价值"},
            {"scene_no": 3, "text": p3, "image_prompt": "中国风儿童绘本，第3幕，温暖明亮，正向价值"},
        ],
        "image_urls": [i1, i2, i3],
        "audio_urls": [a1, a2, a3],
    }


MOCK_STYLE_STORIES: MockStyleDB = {
    "剪纸": [
        _mk_story(
            "纸灯笼和小云雀",
            "小云雀迷路在夜色里，阿木剪出一盏会发光的纸灯笼。两人一路问路、一路帮助别人，最后在灯火下找到回家的桥，也懂得了友谊和勇敢。",
            "阿木在窗边剪出红色灯笼，小云雀停在肩头。",
            "他们沿街问路，还把灯光借给怕黑的小猫。",
            "桥头亮起灯火，小云雀开心回家，阿木也被夸奖乐于助人。",
            "https://images.unsplash.com/photo-1513151233558-d860c5398176?auto=format&fit=crop&w=1280&q=80",
            "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1280&q=80",
            "https://images.unsplash.com/photo-1494515843206-f3117d3f51b7?auto=format&fit=crop&w=1280&q=80",
            "https://cdn.pixabay.com/download/audio/2022/03/10/audio_9ef0ecf4d7.mp3?filename=soft-piano-logo-113097.mp3",
            "https://cdn.pixabay.com/download/audio/2021/10/21/audio_65f456f136.mp3?filename=magic-forest-12345.mp3",
            "https://cdn.pixabay.com/download/audio/2022/10/25/audio_03e5e58289.mp3?filename=happy-kids-12670.mp3",
        ),
        _mk_story(
            "小剪刀的约定",
            "小剪刀总想剪得最快，结果把纸船剪坏了。它向伙伴道歉后，大家一起重新做船，在河边比赛，学会了诚实和合作。",
            "小剪刀在桌面上神气地转圈。",
            "它不小心剪坏纸船，低头说对不起。",
            "伙伴们齐心完成新船，笑着出发。",
            "https://images.unsplash.com/photo-1459666644539-a9755287d6b0?auto=format&fit=crop&w=1280&q=80",
            "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=1280&q=80",
            "https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?auto=format&fit=crop&w=1280&q=80",
            "https://cdn.pixabay.com/download/audio/2022/10/28/audio_5f73f2dc16.mp3?filename=kids-lullaby-12763.mp3",
            "https://cdn.pixabay.com/download/audio/2022/02/23/audio_20f7a9d0f1.mp3?filename=gentle-ambient-110420.mp3",
            "https://cdn.pixabay.com/download/audio/2023/03/13/audio_5bb88f1b49.mp3?filename=sunny-day-14295.mp3",
        ),
        _mk_story(
            "窗花里的春天",
            "小桃和奶奶一起剪窗花迎春。她把最漂亮的窗花送给独居爷爷，院子里因此充满笑声，大家都感受到善良的温度。",
            "奶奶教小桃折纸，红纸像花瓣。",
            "小桃把窗花贴在爷爷家窗前。",
            "院子里孩子们一起唱春天歌。",
            "https://images.unsplash.com/photo-1473448912268-2022ce9509d8?auto=format&fit=crop&w=1280&q=80",
            "https://images.unsplash.com/photo-1516627145497-ae6968895b74?auto=format&fit=crop&w=1280&q=80",
            "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=1280&q=80",
            "https://cdn.pixabay.com/download/audio/2022/12/14/audio_0ad7a83d3d.mp3?filename=gentle-129711.mp3",
            "https://cdn.pixabay.com/download/audio/2022/03/15/audio_1bd8b4f57e.mp3?filename=kids-11243.mp3",
            "https://cdn.pixabay.com/download/audio/2022/08/02/audio_f7af0f6f06.mp3?filename=children-fun-11776.mp3",
        ),
    ],
    "水墨": [
        _mk_story(
            "竹林里的小神龟",
            "小神龟在竹林迷路，孙悟空带它跨过溪流、问路山雀，最终回到家。一路上他们学会耐心倾听与守信相助。",
            "晨雾中的竹林，小神龟焦急张望。",
            "孙悟空背着小神龟跨过浅溪。",
            "晚霞下神龟回家，大家互道谢谢。",
            "https://images.unsplash.com/photo-1505765050516-f72dcac9c60f?auto=format&fit=crop&w=1280&q=80",
            "https://images.unsplash.com/photo-1473773508845-188df298d2d1?auto=format&fit=crop&w=1280&q=80",
            "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1280&q=80",
            "https://cdn.pixabay.com/download/audio/2022/05/16/audio_830d7f46f3.mp3?filename=chinese-11461.mp3",
            "https://cdn.pixabay.com/download/audio/2022/01/20/audio_54f089f3db.mp3?filename=flute-ambient-10435.mp3",
            "https://cdn.pixabay.com/download/audio/2023/04/18/audio_5fd8a9557f.mp3?filename=warm-story-14521.mp3",
        ),
        _mk_story(
            "会发光的墨点",
            "小书生点错墨滴，画卷变黑。它勇敢承认错误后，老师和同学一起补画，黑墨化成星河，故事也变得更美。",
            "书房里墨滴落下，画卷变暗。",
            "小书生认真道歉，老师微笑点头。",
            "同学们共绘星河，画卷重焕光彩。",
            "https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=1280&q=80",
            "https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=1280&q=80",
            "https://images.unsplash.com/photo-1514894786521-7f7563a8b7a2?auto=format&fit=crop&w=1280&q=80",
            "https://cdn.pixabay.com/download/audio/2022/03/01/audio_7c1227bcdd.mp3?filename=storytelling-111293.mp3",
            "https://cdn.pixabay.com/download/audio/2021/12/09/audio_6266c6fba4.mp3?filename=traditional-flute-9834.mp3",
            "https://cdn.pixabay.com/download/audio/2022/06/14/audio_8a312fdbef.mp3?filename=good-night-kids-11531.mp3",
        ),
        _mk_story(
            "荷塘月色的小舟",
            "小舟想独自抢第一，结果卡在荷叶间。它向伙伴求助后一起划行，终点前大家互相鼓励，收获了真正的快乐。",
            "月光洒在荷塘，小舟轻轻晃动。",
            "小舟卡住后诚恳向朋友求助。",
            "伙伴们同心协力，笑着到达终点。",
            "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1280&q=80",
            "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=1280&q=80",
            "https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=1280&q=80",
            "https://cdn.pixabay.com/download/audio/2022/11/09/audio_3cf8d47f8e.mp3?filename=kids-fairytale-12807.mp3",
            "https://cdn.pixabay.com/download/audio/2022/07/24/audio_99c9db6466.mp3?filename=water-11691.mp3",
            "https://cdn.pixabay.com/download/audio/2022/03/22/audio_35d95ad9e4.mp3?filename=happy-ending-112923.mp3",
        ),
    ],
    "皮影": [
        _mk_story(
            "灯幕后的小勇士",
            "阿团第一次上台演皮影，紧张得发抖。在伙伴鼓励下，他稳稳讲完故事，台下掌声四起，学会了勇敢表达自己。",
            "幕布后灯光亮起，阿团深呼吸。",
            "朋友握手鼓励，阿团开始讲故事。",
            "演出结束，全场鼓掌欢笑。",
            "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1280&q=80",
            "https://images.unsplash.com/photo-1460723237483-7a6dc9d0b212?auto=format&fit=crop&w=1280&q=80",
            "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1280&q=80",
            "https://cdn.pixabay.com/download/audio/2022/09/07/audio_4dc17f4f7a.mp3?filename=kids-stage-12076.mp3",
            "https://cdn.pixabay.com/download/audio/2021/09/14/audio_87234fce84.mp3?filename=motivational-kids-8612.mp3",
            "https://cdn.pixabay.com/download/audio/2022/12/02/audio_185f8db8d2.mp3?filename=applause-kids-12900.mp3",
        ),
        _mk_story(
            "小狐狸借光记",
            "小狐狸弄丢了灯芯，决定向邻居借灯。它礼貌请求、及时归还，还帮大家修好了灯架，收获了信任和友谊。",
            "小狐狸发现灯笼忽然熄灭。",
            "它敲门借灯并认真道谢。",
            "归还灯芯后，小狐狸帮忙修灯架。",
            "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1280&q=80",
            "https://images.unsplash.com/photo-1521334884684-d80222895322?auto=format&fit=crop&w=1280&q=80",
            "https://images.unsplash.com/photo-1470229538611-16ba8c7ffbd7?auto=format&fit=crop&w=1280&q=80",
            "https://cdn.pixabay.com/download/audio/2022/10/18/audio_35d1a6ccf4.mp3?filename=night-story-12602.mp3",
            "https://cdn.pixabay.com/download/audio/2022/04/27/audio_4a8d672f53.mp3?filename=friendship-11383.mp3",
            "https://cdn.pixabay.com/download/audio/2022/05/11/audio_8db8f0fdc3.mp3?filename=children-happy-11445.mp3",
        ),
        _mk_story(
            "月下皮影船",
            "三位小演员为谁当主角争执不休。老师让他们轮流领讲，最终大家发现分工合作才让舞台最闪亮。",
            "三位小演员在后台争执。",
            "老师提议轮流领讲，大家尝试配合。",
            "演出成功后，三人开心拥抱。",
            "https://images.unsplash.com/photo-1489515217757-5fd1be406fef?auto=format&fit=crop&w=1280&q=80",
            "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1280&q=80",
            "https://images.unsplash.com/photo-1515169067868-5387ec356754?auto=format&fit=crop&w=1280&q=80",
            "https://cdn.pixabay.com/download/audio/2021/10/26/audio_006f6770cf.mp3?filename=kids-show-9154.mp3",
            "https://cdn.pixabay.com/download/audio/2022/08/19/audio_f7dc3b4059.mp3?filename=warm-scene-11842.mp3",
            "https://cdn.pixabay.com/download/audio/2022/02/09/audio_a040d7637e.mp3?filename=smile-ending-10840.mp3",
        ),
    ],
}


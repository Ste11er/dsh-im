"""Build the runtime-only word/reading table from a pinned Xinhua export.

Rebuild dependency: pypinyin 0.55.0. The game itself uses only the stdlib.
"""
import argparse
import hashlib
import json
from pathlib import Path
from pypinyin import lazy_pinyin, Style
from idiom_rules import is_four_han, parts, rules_for

COMMON = """一心一意 一帆风顺 一鸣惊人 一举两得 一见钟情 一目了然 一丝不苟 一无所获 一马当先 一言九鼎
一诺千金 一知半解 一望无际 一如既往 一劳永逸 一针见血 一落千丈 一路顺风 一清二楚 一塌糊涂
三心二意 四面楚歌 五湖四海 六神无主 七上八下 八仙过海 九牛一毛 十全十美 百发百中 千方百计
万紫千红 千军万马 百折不挠 千言万语 万众一心 半途而废 自相矛盾 画蛇添足 守株待兔 掩耳盗铃
亡羊补牢 刻舟求剑 叶公好龙 对牛弹琴 井底之蛙 杯弓蛇影 狐假虎威 鹬蚌相争 画龙点睛 望梅止渴
胸有成竹 滥竽充数 买椟还珠 破釜沉舟 闻鸡起舞 愚公移山 精卫填海 夸父逐日 负荆请罪 完璧归赵
指鹿为马 卧薪尝胆 围魏救赵 草木皆兵 风声鹤唳 洛阳纸贵 入木三分 程门立雪 雪中送炭 锦上添花
水滴石穿 铁杵成针 悬梁刺股 囊萤映雪 凿壁偷光 废寝忘食 夜以继日 孜孜不倦 全神贯注 聚精会神
兴高采烈 欢天喜地 眉开眼笑 喜出望外 心花怒放 目瞪口呆 大惊失色 惊慌失措 垂头丧气 心灰意冷
无精打采 怒气冲冲 心平气和 心满意足 不知所措 手足无措 哭笑不得 哑口无言 莫名其妙 难以置信
风和日丽 春暖花开 鸟语花香 山清水秀 风雨交加 电闪雷鸣 狂风暴雨 天高云淡 秋高气爽 冰天雪地
桃红柳绿 花好月圆 日新月异 沧海桑田 海阔天空 天南地北 天长地久 天衣无缝 星罗棋布 耳濡目染
耳目一新 豁然开朗 恍然大悟 茅塞顿开 柳暗花明 山穷水尽 势如破竹 所向披靡 风驰电掣 争先恐后
不约而同 不谋而合 不可思议 不言而喻 不劳而获 不翼而飞 不屈不挠 不耻下问 侃侃而谈 津津有味
栩栩如生 彬彬有礼 井井有条 欣欣向荣 蒸蒸日上 斤斤计较 念念不忘 恋恋不舍 依依不舍 亭亭玉立
落落大方 头头是道 欲速不达 事半功倍 事倍功半 熟能生巧 因材施教 见义勇为 助人为乐 拾金不昧
同舟共济 众志成城 集思广益 群策群力 取长补短 实事求是 脚踏实地 纸上谈兵 空中楼阁 自力更生
推陈出新 标新立异 与时俱进 随机应变 因地制宜 顺其自然 自然而然 水到渠成 瓜熟蒂落 顺水推舟
开门见山 直截了当 言简意赅 长话短说 言之有理 名副其实 货真价实 物美价廉 价廉物美 供不应求
人山人海 车水马龙 川流不息 络绎不绝 摩肩接踵 门庭若市 熙熙攘攘 寥寥无几 屈指可数 凤毛麟角
大海捞针 大材小用 大公无私 大义凛然 海市蜃楼 海枯石烂 天翻地覆 天罗地网 左右为难 进退两难
两全其美 三顾茅庐 四通八达 五光十色 五颜六色 七嘴八舌 七手八脚 九死一生 十拿九稳 百依百顺
百感交集 千变万化 千钧一发 千奇百怪 万无一失 举一反三 融会贯通 触类旁通 博大精深 源远流长""".split()

NORMAL = """安步当车 安居乐业 安然无恙 暗度陈仓 按部就班 八面玲珑 白驹过隙 白手起家 百步穿杨 百川归海
百花齐放 百密一疏 班门弄斧 旁若无人 杯水车薪 别具匠心 别开生面 宾至如归 兵不厌诈 兵临城下
博采众长 博古通今 不卑不亢 不寒而栗 不胫而走 不拘一格 不刊之论 不可开交 不可救药 不速之客
不胜枚举 不同凡响 不学无术 不遗余力 不足为奇 才高八斗 沧海一粟 藏龙卧虎 草船借箭 差强人意
长风破浪 长驱直入 朝三暮四 车载斗量 沉鱼落雁 成竹在胸 乘风破浪 痴心妄想 赤胆忠心 出类拔萃
出人头地 出神入化 处心积虑 唇亡齿寒 从容不迫 寸草春晖 大刀阔斧 大器晚成 大智若愚 当机立断
道听途说 得不偿失 得过且过 得心应手 等闲视之 滴水不漏 东山再起 独具慧眼 独树一帜 对症下药
多此一举 耳提面命 发人深省 翻山越岭 翻天覆地 防微杜渐 飞蛾扑火 分道扬镳 分庭抗礼 奋不顾身
风华正茂 风起云涌 风雨同舟 奉公守法 扶摇直上 覆水难收 改过自新 肝胆相照 甘拜下风 高朋满座
高山流水 各抒己见 各司其职 各显神通 根深蒂固 耿耿于怀 功亏一篑 苟且偷生 孤注一掷 古色古香
顾此失彼 冠冕堂皇 光明磊落 归根结底 鬼斧神工 过犹不及 海纳百川 含辛茹苦 汗马功劳 好高骛远
和颜悦色 鹤立鸡群 后来居上 厚积薄发 虎头蛇尾 花团锦簇 画饼充饥 患得患失 焕然一新 黄粱一梦
挥金如土 火中取栗 祸不单行 机不可失 急功近利 既往不咎 家喻户晓 见风使舵 见贤思齐 见异思迁
将计就计 将信将疑 交头接耳 脚不沾地 接踵而至 捷足先登 金科玉律 金玉良言 近水楼台 精打细算
精雕细刻 居安思危 居高临下 举世无双 开卷有益 开源节流 口是心非 苦尽甘来 脍炙人口 力挽狂澜
历历在目 厉兵秣马 良莠不齐 临渴掘井 临危不惧 另辟蹊径 另眼相看 路不拾遗 乱七八糟 马到成功
满城风雨 漫不经心 貌合神离 美不胜收 面面俱到 明察秋毫 明哲保身 目不暇接 目中无人 南辕北辙
难能可贵 宁缺毋滥 呕心沥血 抛砖引玉 披荆斩棘 萍水相逢 迫不及待 迫在眉睫 扑朔迷离 其乐融融
奇货可居 奇思妙想 骑虎难下 气宇轩昂 千篇一律 黔驴技穷 巧夺天工 青出于蓝 轻而易举 情不自禁
曲高和寡 全力以赴 人才辈出 人云亦云 任重道远 如虎添翼 如释重负 如鱼得水 入乡随俗 塞翁失马
三令五申 深谋远虑 深入浅出 身临其境 神机妙算 盛气凌人 失之交臂 史无前例 始终如一 适得其反
势均力敌 手不释卷 守口如瓶 首屈一指 束手无策 水落石出 水乳交融 司空见惯 随遇而安 谈虎色变
叹为观止 螳臂当车 提纲挈领 同甘共苦 同仇敌忾 投机取巧 图穷匕见 推己及人 退避三舍 脱颖而出
望尘莫及 望洋兴叹 危言耸听 微不足道 惟妙惟肖 文不加点 稳操胜券 无独有偶 无济于事 无可厚非
无懈可击 物极必反 细水长流 先发制人 相得益彰 相辅相成 相形见绌 相映成趣 销声匿迹 小题大做
心驰神往 信手拈来 行云流水 形影不离 胸无点墨 悬崖勒马 学富五车 雪上加霜 寻根究底 循序渐进
循循善诱 鸦雀无声 掩人耳目 眼花缭乱 阳奉阴违 仰人鼻息 摇摇欲坠 一波三折 一筹莫展 以德报怨
以逸待劳 义不容辞 异曲同工 异想天开 引人入胜 饮鸩止渴 迎刃而解 应接不暇 优柔寡断 鱼目混珠
雨后春笋 语重心长 约法三章 再接再厉 载歌载舞 斩草除根 招摇过市 朝气蓬勃 真知灼见 针锋相对
知己知彼 指日可待 至理名言 置之度外 志同道合 众口铄金 众所周知 珠联璧合 自告奋勇 自圆其说""".split()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    raw = args.source.read_bytes()
    entries, unreadable = {}, []
    for record in json.loads(raw):
        word = record["word"]
        if not is_four_han(word):
            continue
        reading = lazy_pinyin(word, style=Style.TONE3, neutral_tone_with_five=True, v_to_u=True, tone_sandhi=False)
        # Phrase dictionaries can bake in speech sandhi even with the option
        # disabled. The game uses the lexical tones of 一/不 consistently.
        reading = ["yi1" if ch == "一" else "bu4" if ch == "不" else item for ch, item in zip(word, reading)]
        try:
            parts(word, reading, rules_for())
        except ValueError:
            unreadable.append(word)
            continue
        if word in entries and entries[word] != reading:
            raise ValueError("Conflicting duplicate word: " + word)
        entries[word] = reading
    common = [word for word in COMMON if word in entries]
    normal = [word for word in NORMAL if word in entries and word not in common]
    if len(common) < 200:
        raise ValueError("Common-answer pool unexpectedly small")
    data = {"version": 1, "source": {"repository": "pwxcoo/chinese-xinhua", "commit": "fe6d6c2e8baa82187f4c96bbe042e43f96c05666",
            "inputSha256": hashlib.sha256(raw).hexdigest(), "readingGenerator": "pypinyin 0.55.0; lexical 一/不"},
            "entries": entries, "common": common, "normal": normal, "unreadableWords": unreadable,
            "tierMethod": "curated seed groups; remaining entries are the expansion tier, not a measured frequency ranking"}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"entries": len(entries), "common": len(common), "normal": len(normal), "unreadable": len(unreadable), "bytes": args.output.stat().st_size}))


if __name__ == "__main__":
    main()

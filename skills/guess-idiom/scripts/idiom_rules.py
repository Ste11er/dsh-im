"""Deterministic four-axis idiom judging. No network or model calls."""
from collections import Counter
import re
import unicodedata

GREEN, PURPLE, WHITE = "🟩", "🟪", "⬜"
DEFAULT_RULES = {"ywInitials": True, "finals": "spelling", "phoneticCounts": True}
INITIALS = ("zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s")
ZERO = {"yi": "i", "ya": "ia", "ye": "ie", "yao": "iao", "you": "iou", "yan": "ian", "yin": "in", "yang": "iang", "ying": "ing", "yong": "iong",
        "yu": "ü", "yue": "üe", "yuan": "üan", "yun": "ün", "wu": "u", "wa": "ua", "wo": "uo", "wai": "uai", "wei": "uei", "wan": "uan", "wen": "uen", "wang": "uang", "weng": "ueng"}


class RuleError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def rules_for(value=None):
    value = {} if value is None else value
    if not isinstance(value, dict) or set(value) - set(DEFAULT_RULES):
        raise RuleError("invalid-rules", "规则参数无效。")
    result = {**DEFAULT_RULES, **value}
    if type(result["ywInitials"]) is not bool or type(result["phoneticCounts"]) is not bool or result["finals"] not in ("spelling", "phonetic"):
        raise RuleError("invalid-rules", "规则参数无效。")
    return result


def is_four_han(word):
    return isinstance(word, str) and len(word) == 4 and all(
        "\u3400" <= ch <= "\u9fff" or "\U00020000" <= ch <= "\U000323af" or "\uf900" <= ch <= "\ufaff" for ch in word)


def normalize_reading(value):
    if not isinstance(value, list) or len(value) != 4 or any(not isinstance(item, str) for item in value):
        raise RuleError("invalid-reading", "添加词条需要四个拼音，例如 [yi1,xin1,yi1,yi4]。")
    result = []
    tones = {"\u0304": 1, "\u0301": 2, "\u030c": 3, "\u0300": 4}
    for syllable in value:
        syllable = syllable.strip().lower().replace("u:", "ü").replace("v", "ü")
        if re.fullmatch(r"[a-züê]+[0-5]", syllable):
            result.append(syllable[:-1] + str(int(syllable[-1]) % 5))
            continue
        letters, tone = [], 0
        for char in unicodedata.normalize("NFD", syllable):
            if char in tones:
                if tone:
                    raise RuleError("invalid-reading", "一个音节只能有一个声调。")
                tone = tones[char]
            elif char == "\u0308" and letters and letters[-1] == "u":
                letters[-1] = "ü"
            elif char == "\u0302" and letters and letters[-1] == "e":
                letters[-1] = "ê"
            elif "a" <= char <= "z":
                letters.append(char)
            else:
                raise RuleError("invalid-reading", "拼音格式无效。")
        if not letters:
            raise RuleError("invalid-reading", "拼音不能为空。")
        result.append("".join(letters) + str(tone))
    return result


def split_syllable(value, rules):
    match = re.fullmatch(r"([a-züvê]+)([0-5])", value.lower())
    if not match:
        raise RuleError("reading-unavailable", "词库拼音缺失或无效，本次不计次数。")
    spelling = match[1].replace("v", "ü")
    tone = int(match[2]) % 5
    options = INITIALS + (("y", "w") if rules["ywInitials"] else ())
    initial = next((part for part in options if spelling.startswith(part)), "")
    final = spelling[len(initial):]
    spelling_finals = {"a", "o", "e", "i", "u", "ü", "ê", "ai", "ei", "ao", "ou", "an", "en", "ang", "eng", "ong",
                       "ia", "ie", "iao", "iu", "ian", "in", "iang", "ing", "iong", "ua", "uo", "uai", "ui", "uan", "un", "uang", "ueng", "ue", "üe", "üan", "ün", "er", "io"}
    if not initial and spelling in ZERO:
        final = ZERO[spelling]
    if final not in spelling_finals | {"iou", "uei", "uen"}:
        raise RuleError("reading-unavailable", "拼音音节无效，未计次数。")
    if rules["finals"] == "phonetic":
        if initial in ("j", "q", "x") and final.startswith("u"):
            final = "ü" + final[1:]
        final = {"iu": "iou", "ui": "uei", "un": "uen"}.get(final, final)
    return initial, final, tone


def parts(word, reading, rules):
    if not is_four_han(word) or not isinstance(reading, list) or len(reading) != 4:
        raise RuleError("reading-unavailable", "需要四字成语及四个有效拼音。")
    return [[ch, *split_syllable(syllable, rules)] for ch, syllable in zip(word, reading)]


def colors(answer, guess, counted=True, ignore_empty=False):
    result = [WHITE] * 4
    remaining = Counter(value for value in answer if not (ignore_empty and value == ""))
    for i, value in enumerate(guess):
        if ignore_empty and value == "":
            continue
        if value == answer[i]:
            result[i] = GREEN
            remaining[value] -= 1
    for i, value in enumerate(guess):
        if result[i] == GREEN or (ignore_empty and value == ""):
            continue
        present = remaining[value] > 0 if counted else value in answer
        if present:
            result[i] = PURPLE
            remaining[value] -= 1
    return result


def judge(answer, answer_reading, guess, guess_reading, rules=None):
    rules = rules_for(rules)
    target = parts(answer, answer_reading, rules)
    proposed = parts(guess, guess_reading, rules)
    axes = {}
    for index, name in enumerate(("字", "声母", "韵母", "声调")):
        axes[name] = colors([row[index] for row in target], [row[index] for row in proposed],
                            counted=index == 0 or rules["phoneticCounts"], ignore_empty=index == 1)
    # A correct idiom wins even though a zero initial deliberately stays white.
    return {"guess": guess, "parts": proposed, "colors": axes, "won": guess == answer}

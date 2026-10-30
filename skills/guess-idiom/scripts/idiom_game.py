"""Local host for a human-player idiom game. JSON stdin/stdout protocol."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile

from idiom_rules import RuleError, is_four_han, judge, normalize_reading, parts, rules_for

ASSETS = Path(__file__).resolve().parent.parent / "assets"
LIMITS = (3, 5, 10)
TIERS = ("common", "normal", "rare")
DEFAULT_WEIGHTS = {"common": 70, "normal": 25, "rare": 5}


def load_lexicon():
    data = json.loads((ASSETS / "idioms.json").read_text(encoding="utf-8"))
    if data["version"] != 1 or not isinstance(data["entries"], dict) or not data["entries"]:
        raise RuleError("lexicon-invalid", "本地成语词库损坏，未开始或扣除机会。")
    data["custom"] = {}
    return data


def weights_for(value=None):
    result = dict(DEFAULT_WEIGHTS) if value is None else value
    if (not isinstance(result, dict) or set(result) != set(TIERS)
        or any(type(v) is not int or v < 0 for v in result.values()) or sum(result.values()) == 0):
        raise RuleError("invalid-weights", "出题权重需要三档非负整数，且至少一档大于零。")
    return dict(result)


def pools_for(lexicon):
    common = list(lexicon["common"])
    normal = list(lexicon["normal"])
    known = set(common) | set(normal)
    return {"common": common, "normal": normal, "rare": [word for word in lexicon["entries"] if word not in known]}


def new_game(lexicon, number, limit, rules, difficulty, weights=None, answer=None):
    weights = weights_for(weights)
    pools = pools_for(lexicon)
    tier = next((name for name in TIERS if answer in pools[name]), None) if answer else None
    if answer is None:
        raise RuleError("answer-required", "请先由模型想好四字答案，再通过 start 的 answer 保存；程序不随机出题。")
    if not is_four_han(answer) or answer not in lexicon["entries"]:
        raise RuleError("answer-unverified", "指定四字答案尚未收录；请提供该词的四字拼音再保存。")
    parts(answer, lexicon["entries"][answer], rules)
    return {"round": number, "answer": answer, "limit": limit, "used": 0,
            "rules": rules, "difficulty": difficulty, "weights": weights, "tier": tier}


def public_game(game):
    if game is None:
        return {"active": False, "message": "尚未开局；请先开始猜成语。"}
    return {"active": True, "round": game["round"], "limit": game["limit"],
            "used": game["used"], "remaining": game["limit"] - game["used"], "rules": game["rules"], "difficulty": game["difficulty"], "weights": game["weights"], "tier": game["tier"]}


def validate_request(request):
    if not isinstance(request, dict) or set(request) - {"action", "guess", "limit", "restart", "rules", "difficulty", "answer", "requestId", "weights", "word", "pinyin", "tier"}:
        raise RuleError("invalid-request", "请求参数无效。")
    action = request.get("action", "guess")
    if action not in ("start", "guess", "status", "set_limit", "reveal", "add_word", "add_and_guess", "lookup"):
        raise RuleError("invalid-action", "不支持的游戏操作。")
    fields = {"start": {"limit", "restart", "rules", "difficulty", "answer", "weights", "pinyin", "tier"}, "guess": {"guess"},
              "status": set(), "set_limit": {"limit"}, "reveal": set(),
              "add_word": {"word", "pinyin", "tier"}, "add_and_guess": {"word", "pinyin", "tier"}, "lookup": {"word"}}
    if set(request) - {"action", "requestId"} - fields[action]:
        raise RuleError("invalid-request", "这个操作不接受这些参数。")
    if "limit" in request and (type(request["limit"]) is not int or request["limit"] not in LIMITS):
        raise RuleError("invalid-limit", "机会数可设为 3、5 或 10。")
    if "restart" in request and type(request["restart"]) is not bool:
        raise RuleError("invalid-request", "restart 必须为布尔值。")
    if request.get("difficulty", "mixed") not in ("mixed", *TIERS):
        raise RuleError("invalid-request", "题库范围可选 mixed、common、normal 或 rare。")
    if "weights" in request:
        if request["weights"] is None:
            raise RuleError("invalid-weights", "权重不能为 null。")
        weights_for(request["weights"])
    if "tier" in request and request["tier"] not in TIERS:
        raise RuleError("invalid-tier", "词条档位应为 common、normal 或 rare。")
    if "rules" in request:
        if not isinstance(request["rules"], dict):
            raise RuleError("invalid-rules", "规则需要对象。")
        rules_for(request["rules"])
    if "answer" in request and not is_four_han(request["answer"]):
        raise RuleError("answer-unverified", "指定答案需要四个汉字。")
    if not isinstance(request.get("requestId"), str) or not 1 <= len(request["requestId"]) <= 256:
        raise RuleError("invalid-request", "缺少可核验的操作编号。")
    return action


def operate(state, request, lexicon):
    action = validate_request(request)
    game = state["game"]
    if action == "add_and_guess":
        if game is None:
            return {**public_game(game), "status": "needs-start"}
        vocabulary = operate(state, {**request, "action": "add_word"}, lexicon)
        scored = operate(state, {"action": "guess", "guess": request["word"], "requestId": request["requestId"]}, lexicon)
        return {**scored, "vocabulary": vocabulary}
    if action in ("lookup", "add_word"):
        word = request.get("word")
        if not is_four_han(word):
            raise RuleError("invalid-word", "词条需要四个汉字。")
        present = word in lexicon["entries"]
        if action == "lookup":
            return {"word": word, "found": present, **({"pinyin": lexicon["entries"][word], "tier": next(name for name, pool in pools_for(lexicon).items() if word in pool)} if present else {})}
        reading = normalize_reading(request.get("pinyin"))
        parts(word, reading, rules_for())
        if present:
            if reading != lexicon["entries"][word]:
                raise RuleError("reading-conflict", "词库已有不同读音；未覆盖。请先核对读音。")
            return {"status": "already-in-lexicon", "word": word, "pinyin": reading, "added": False}
        tier = request.get("tier", "normal")
        lexicon["custom"][word] = {"reading": reading, "tier": tier, "source": "agent-added"}
        lexicon["entries"][word] = reading
        if tier in ("common", "normal"):
            lexicon[tier].append(word)
        return {"status": "word-added", "word": word, "pinyin": reading, "tier": tier, "added": True, "source": "agent-added", "attemptsConsumed": 0}
    if action == "start":
        if game is not None and not request.get("restart", False):
            return {**public_game(game), "status": "already-active", "message": "已有本局；需要重开时明确设置 restart。"}
        if "answer" not in request:
            raise RuleError("answer-required", "请先由模型想好四字答案，再通过 start 的 answer 保存；程序不随机出题。")
        if "pinyin" in request:
            operate(state, {"action": "add_word", "word": request["answer"], "pinyin": request["pinyin"],
                            "tier": request.get("tier", "normal"), "requestId": request["requestId"]}, lexicon)
        previous = game if game is not None else state.get("completed")
        game = new_game(lexicon, (previous["round"] if previous else 0) + 1, request.get("limit", 10),
                        rules_for(request.get("rules")), request.get("difficulty", "mixed"), request.get("weights"), request.get("answer"))
        state["game"] = game
        return {**public_game(game), "status": "started", "message": f"已开局，{game['limit']} 次机会，请猜四字词组，网络用语也可以。"}
    if action == "status" or game is None:
        return {**public_game(game), "status": "active" if game else "needs-start"}
    if action == "set_limit":
        limit = request.get("limit")
        if limit is None or limit <= game["used"]:
            raise RuleError("invalid-limit", "新机会数必须大于本局已使用次数。")
        game["limit"] = limit
        return {**public_game(game), "status": "limit-updated"}
    if action == "reveal":
        result = {**public_game(game), "status": "revealed", "answer": game["answer"]}
    else:
        guess = request.get("guess")
        if not is_four_han(guess):
            return {**public_game(game), "status": "invalid-guess", "accepted": False, "message": "每次需要四个汉字的词组，本次不计机会。"}
        if guess not in lexicon["entries"]:
            return {**public_game(game), "status": "unverified-idiom", "accepted": False, "word": guess, "message": "本地词库未收录，暂不扣次数。允许任意四字词组；确认四字拼音后用 add_and_guess 补录并判本手，不因不是成语拒绝。"}
        scored = judge(game["answer"], lexicon["entries"][game["answer"]], guess, lexicon["entries"][guess], game["rules"])
        game["used"] += 1
        outcome = "won" if scored["won"] else "lost" if game["used"] == game["limit"] else "continue"
        result = {**public_game(game), **scored, "status": outcome, "accepted": True}
        result["board"] = "\n".join(f"{name}：{''.join(values)}" for name, values in scored["colors"].items())
        if outcome == "continue":
            return result
        result["answer"] = game["answer"]
    # A new answer must come from the model; the referee never selects words.
    result["active"] = False
    state["completed"] = game
    state["game"] = None
    result["nextQuestionRequired"] = True
    result["nextOptions"] = {name: game[name] for name in ("limit", "rules", "difficulty", "weights")}
    return result


def validate_state(state, lexicon):
    if not isinstance(state, dict) or state["version"] != 1 or not isinstance(state["receipts"], list) or len(state["receipts"]) > 64:
        raise RuleError("state-invalid", "本局记录损坏；没有重置或扣除机会。")
    game = state["game"]
    completed = state.get("completed")
    if completed is not None:
        if (not isinstance(completed, dict) or type(completed["round"]) is not int or completed["round"] < 1
            or completed["limit"] not in LIMITS or type(completed["used"]) is not int or not 0 <= completed["used"] <= completed["limit"]
            or completed["answer"] not in lexicon["entries"]):
            raise RuleError("state-invalid", "已结束局记录损坏；没有自动出题。")
    if game is not None:
        if (not isinstance(game, dict) or type(game["round"]) is not int or game["round"] < 1
            or type(game["used"]) is not int or game["limit"] not in LIMITS or not 0 <= game["used"] < game["limit"]
            or game["answer"] not in lexicon["entries"] or game["difficulty"] not in ("mixed", *TIERS) or game["tier"] not in TIERS):
            raise RuleError("state-invalid", "本局记录损坏；没有重置或扣除机会。")
        rules_for(game["rules"])
        weights_for(game["weights"])
    for item in state["receipts"]:
        if not isinstance(item, dict) or not isinstance(item["id"], str) or not isinstance(item["fingerprint"], str) or not isinstance(item["result"], dict):
            raise RuleError("state-invalid", "本局操作记录损坏。")


def transact(directory, scope, request):
    validate_request(request)
    if not re_scope(scope):
        raise RuleError("invalid-scope", "需要有效的会话编号。")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / (scope + ".json")
    lock_path = directory / (scope + ".lock")
    lexicon = load_lexicon()
    words_path = directory / (scope + ".words.json")
    with os.fdopen(os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600), "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            state = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            state = {"version": 1, "game": None, "receipts": []}
        try:
            additions = json.loads(words_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            additions = {"version": 1, "entries": {}}
        if not isinstance(additions, dict) or additions["version"] != 1 or not isinstance(additions["entries"], dict):
            raise RuleError("lexicon-invalid", "扩展词库损坏，没有重置。")
        for word, item in additions["entries"].items():
            if not is_four_han(word) or item["tier"] not in TIERS or word in lexicon["entries"]:
                raise RuleError("lexicon-invalid", "扩展词条无效，没有重置。")
            parts(word, item["reading"], rules_for())
            lexicon["custom"][word] = item
            lexicon["entries"][word] = item["reading"]
            if item["tier"] in ("common", "normal"):
                lexicon[item["tier"]].append(word)
        validate_state(state, lexicon)
        fingerprint = hashlib.sha256(json.dumps({k: v for k, v in request.items() if k != "requestId"}, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        previous = next((item for item in state["receipts"] if item["id"] == request["requestId"]), None)
        if previous:
            if previous["fingerprint"] != fingerprint:
                raise RuleError("operation-conflict", "同一操作编号对应不同请求；没有执行。")
            return previous["result"]
        result = operate(state, request, lexicon)
        if request.get("action", "guess") in ("status", "lookup"):
            return result
        if lexicon["custom"] != additions["entries"]:
            atomic_write(words_path, {"version": 1, "entries": lexicon["custom"]})
        state["receipts"] = (state["receipts"] + [{"id": request["requestId"], "fingerprint": fingerprint, "result": result}])[-64:]
        atomic_write(path, state)
        return result


def atomic_write(path, data):
    descriptor, temporary = tempfile.mkstemp(prefix=".idiom-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(data, output, ensure_ascii=False, separators=(",", ":")); output.write("\n")
            output.flush(); os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def re_scope(value):
    return len(value) == 64 and all(ch in "0123456789abcdef" for ch in value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", required=True, type=Path)
    parser.add_argument("--scope", required=True)
    args = parser.parse_args()
    try:
        payload = __import__("sys").stdin.read(8193)
        if len(payload) > 8192:
            raise RuleError("invalid-request", "请求过长。")
        result = transact(args.state_dir, args.scope, json.loads(payload))
        print(json.dumps({"ok": True, "value": result}, ensure_ascii=False, separators=(",", ":")))
    except (RuleError, json.JSONDecodeError) as error:
        code = error.code if isinstance(error, RuleError) else "invalid-json"
        message = str(error) if isinstance(error, RuleError) else "请求或本地记录不是有效 JSON，未重置本局。"
        print(json.dumps({"ok": False, "error": {"code": code, "message": message}}, ensure_ascii=False))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

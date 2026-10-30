import concurrent.futures
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'skills/guess-idiom/scripts'))
from idiom_game import load_lexicon, new_game, operate, transact
from idiom_rules import GREEN, PURPLE, WHITE, RuleError, colors, judge, parts, rules_for, split_syllable


class IdiomRulesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lexicon = load_lexicon()

    def new_state(self, limit=10, answer='星罗棋布'):
        state = {'version': 1, 'game': None, 'receipts': []}
        result = operate(state, {'action': 'start', 'answer': answer, 'limit': limit, 'requestId': 'start'}, self.lexicon)
        self.assertNotIn(answer, json.dumps(result, ensure_ascii=False))
        return state

    def test_given_star_and_zero_initial(self):
        rules = rules_for()
        self.assertEqual(split_syllable('xing1', rules), ('x', 'ing', 1))
        self.assertEqual(split_syllable('er3', rules), ('', 'er', 3))
        self.assertEqual(split_syllable('de5', rules), ('d', 'e', 0))

    def test_green_consumes_duplicate_before_purple(self):
        self.assertEqual(colors(list('山一水水'), list('一一山山')), [WHITE, GREEN, PURPLE, WHITE])
        self.assertEqual(colors(['x', 'l', 'q', 'b'], ['l', 'l', 'l', 'x']), [WHITE, GREEN, WHITE, PURPLE])

    def test_four_axes_independent_and_homophones_not_victory(self):
        entries = self.lexicon['entries']
        result = judge('一心一意', entries['一心一意'], '一帆风顺', entries['一帆风顺'])
        self.assertEqual(result['colors']['声调'], [GREEN] * 4)
        self.assertEqual(result['colors']['字'], [GREEN, WHITE, WHITE, WHITE])
        self.assertFalse(result['won'])
        result = judge('星罗棋布', entries['星罗棋布'], '兴高采烈', entries['兴高采烈'])
        self.assertEqual(result['colors']['字'][0], WHITE)
        self.assertEqual(result['colors']['声母'][0], GREEN)
        self.assertEqual(result['colors']['韵母'][0], GREEN)

    def test_zero_initial_stays_white_even_when_word_wins(self):
        reading = self.lexicon['entries']['耳濡目染']
        self.assertEqual(reading, ['er3', 'ru2', 'mu4', 'ran3'])
        result = judge('耳濡目染', reading, '耳濡目染', reading)
        self.assertTrue(result['won'])
        self.assertEqual(result['colors']['字'], [GREEN] * 4)
        self.assertEqual(result['colors']['声母'], [WHITE, GREEN, GREEN, GREEN])

    def test_explicit_spelling_conventions(self):
        self.assertEqual(split_syllable('nv3', rules_for()), split_syllable('nü3', rules_for()))
        self.assertEqual(split_syllable('yun2', rules_for()), ('y', 'un', 2))
        self.assertEqual(split_syllable('yun2', rules_for({'ywInitials': False, 'finals': 'phonetic'})), ('', 'ün', 2))
        self.assertEqual(split_syllable('jun1', rules_for({'finals': 'phonetic'})), ('j', 'ün', 1))
        self.assertEqual(colors(['x', 'l', 'q', 'b'], ['l'] * 4, counted=False), [PURPLE, GREEN, PURPLE, PURPLE])
        self.assertEqual(self.lexicon['entries']['一心一意'], ['yi1', 'xin1', 'yi1', 'yi4'])

    def test_unresolved_or_non_four_han_guesses_do_not_consume_attempts(self):
        state = self.new_state()
        for word in ['你好啊', '一心一意啊', '一心一🙂', '阿巴阿巴', '步步糕升']:
            result = operate(state, {'guess': word, 'requestId': word}, self.lexicon)
            self.assertFalse(result['accepted'])
            self.assertEqual(result['used'], 0)
            self.assertNotIn('answer', result)

    def test_concurrent_phrase_add_and_guess_is_one_durable_operation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, scope = Path(temporary), 'e' * 64
            transact(root, scope, {'action': 'start', 'answer': '星罗棋布', 'requestId': 'start'})
            request = {'action': 'add_and_guess', 'word': '原神启动', 'pinyin': ['yuan2', 'shen2', 'qi3', 'dong4'], 'requestId': 'same-phrase'}
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(lambda _: transact(root, scope, request), range(6)))
            self.assertTrue(all(row == results[0] for row in results))
            self.assertEqual(results[0]['used'], 1)
            self.assertTrue(results[0]['vocabulary']['added'])
            self.assertEqual(transact(root, scope, {'action': 'status', 'requestId': 'check'})['used'], 1)
            self.assertTrue(transact(root, scope, {'action': 'lookup', 'word': '原神启动', 'requestId': 'lookup'})['found'])

    def test_exhaustion_reveals_and_waits_for_model_answer_for_all_limits(self):
        for limit in (3, 5, 10):
            state = self.new_state(limit=limit)
            for index in range(limit):
                result = operate(state, {'guess': '一心一意', 'requestId': str(index)}, self.lexicon)
                self.assertEqual(result['used'], index + 1)
                if index < limit - 1:
                    self.assertEqual(result['status'], 'continue')
                    self.assertNotIn('answer', result)
            self.assertEqual(result['status'], 'lost')
            self.assertEqual(result['answer'], '星罗棋布')
            self.assertFalse(result['active'])
            self.assertIsNone(state['game'])
            self.assertTrue(result['nextQuestionRequired'])
            opened = operate(state, {'action': 'start', 'answer': '耳濡目染', 'limit': limit, 'requestId': 'model-next'}, self.lexicon)
            self.assertEqual(opened['round'], 2)
            self.assertEqual(opened['used'], 0)

    def test_win_and_voluntary_reveal_only_disclose_finished_answer(self):
        state = self.new_state()
        result = operate(state, {'guess': '星罗棋布', 'requestId': 'win'}, self.lexicon)
        self.assertEqual(result['status'], 'won')
        self.assertEqual(result['answer'], '星罗棋布')
        self.assertTrue(result['nextQuestionRequired'])
        operate(state, {'action': 'start', 'answer': '耳濡目染', 'requestId': 'model-next'}, self.lexicon)
        result = operate(state, {'action': 'reveal', 'requestId': 'reveal'}, self.lexicon)
        self.assertEqual(result['status'], 'revealed')
        self.assertTrue(result['nextQuestionRequired'])
        self.assertIsNone(state['game'])

    def test_start_does_not_silently_reset_existing_game(self):
        state = self.new_state()
        operate(state, {'guess': '一心一意', 'requestId': 'guess'}, self.lexicon)
        result = operate(state, {'action': 'start', 'requestId': 'start-again'}, self.lexicon)
        self.assertEqual(result['status'], 'already-active')
        self.assertEqual(result['used'], 1)
        operate(state, {'action': 'set_limit', 'limit': 5, 'requestId': 'more'}, self.lexicon)
        self.assertEqual(state['game']['used'], 1)
        self.assertEqual(state['game']['limit'], 5)
        for limit in (True, 0, 14, '20'):
            with self.assertRaises(RuleError):
                operate(state, {'action': 'set_limit', 'limit': limit, 'requestId': 'bad'}, self.lexicon)

    def test_persistence_idempotency_and_scope_isolation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first, second = 'a' * 64, 'b' * 64
            start = {'action': 'start', 'answer': '星罗棋布', 'requestId': 'start'}
            transact(root, first, start)
            request = {'guess': '一心一意', 'requestId': 'same-operation'}
            self.assertEqual(transact(root, first, request), transact(root, first, request))
            status = transact(root, first, {'action': 'status', 'requestId': 'status'})
            self.assertEqual(status['used'], 1)
            self.assertNotIn('answer', status)
            self.assertEqual((root / (first + '.json')).stat().st_mode & 0o777, 0o600)
            self.assertFalse(transact(root, second, {'action': 'status', 'requestId': 'status'})['active'])
            with self.assertRaises(RuleError):
                transact(root, first, {**request, 'guess': '一帆风顺'})

    def test_concurrent_calls_are_not_lost(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, scope = Path(temporary), 'c' * 64
            transact(root, scope, {'action': 'start', 'answer': '星罗棋布', 'requestId': 'start'})
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(lambda index: transact(root, scope, {'guess': '一心一意', 'requestId': str(index)}), range(8)))
            self.assertEqual(sorted(row['used'] for row in results), list(range(1, 9)))
            self.assertEqual(transact(root, scope, {'action': 'status', 'requestId': 'status'})['used'], 8)

    def test_corrupt_state_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, scope = Path(temporary), 'd' * 64
            path = root / (scope + '.json'); path.write_text('{broken', encoding='utf-8')
            with self.assertRaises(json.JSONDecodeError):
                transact(root, scope, {'action': 'start', 'requestId': 'start'})
            self.assertEqual(path.read_text(), '{broken')

    def test_guess_cannot_inject_commands_or_state_paths(self):
        state = self.new_state()
        with self.assertRaises(RuleError):
            operate(state, {'guess': '一心一意', 'stateDir': '/tmp/arbitrary', 'requestId': 'evil'}, self.lexicon)
        self.assertEqual(state['game']['used'], 0)

    def test_question_must_be_supplied_by_model_and_is_preserved_exactly(self):
        with self.assertRaises(RuleError) as error:
            new_game(self.lexicon, 1, 10, rules_for(), 'mixed')
        self.assertEqual(error.exception.code, 'answer-required')
        for answer in ['一心一意', '耳濡目染', '星罗棋布']:
            game = new_game(self.lexicon, 1, 3, rules_for(), 'mixed', answer=answer)
            self.assertEqual(game['answer'], answer)

    def test_agent_can_add_a_missing_idiom_without_consuming_attempts_and_use_it_later(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, scope, other = Path(temporary), 'e' * 64, 'f' * 64
            word = '笃行不怠'
            self.assertNotIn(word, self.lexicon['entries'])
            transact(root, scope, {'action': 'start', 'answer': '星罗棋布', 'requestId': 'start'})
            added = transact(root, scope, {'action': 'add_word', 'word': word, 'pinyin': ['dǔ', 'xíng', 'bù', 'dài'], 'tier': 'normal', 'requestId': 'add'})
            self.assertEqual(added['source'], 'agent-added')
            self.assertEqual(added['attemptsConsumed'], 0)
            self.assertEqual(transact(root, scope, {'action': 'status', 'requestId': 'status'})['used'], 0)
            found = transact(root, scope, {'action': 'lookup', 'word': word, 'requestId': 'lookup'})
            self.assertEqual(found['pinyin'], ['du3', 'xing2', 'bu4', 'dai4'])
            self.assertFalse(transact(root, other, {'action': 'lookup', 'word': word, 'requestId': 'lookup'})['found'])
            guess = transact(root, scope, {'guess': word, 'requestId': 'guess'})
            self.assertTrue(guess['accepted']); self.assertEqual(guess['used'], 1)
            new = transact(root, scope, {'action': 'start', 'restart': True, 'answer': word, 'limit': 3, 'requestId': 'new'})
            self.assertEqual(new['tier'], 'normal')
            won = transact(root, scope, {'guess': word, 'requestId': 'win'})
            self.assertEqual(won['status'], 'won')
            self.assertEqual((root / (scope + '.words.json')).stat().st_mode & 0o777, 0o600)

    def test_add_rejects_invalid_phonetics_and_does_not_overwrite_base_reading(self):
        lexicon = load_lexicon(); state = self.new_state()
        for word, reading in [('阿巴阿巴', ['hello1'] * 4), ('不是四字呀', ['bu4'] * 4), ('笃行不怠', ['du3'])]:
            with self.assertRaises(RuleError):
                operate(state, {'action': 'add_word', 'word': word, 'pinyin': reading, 'requestId': 'bad'}, lexicon)
        with self.assertRaises(RuleError):
            operate(state, {'action': 'add_word', 'word': '一心一意', 'pinyin': ['yi4', 'xin1', 'yi2', 'yi4'], 'requestId': 'conflict'}, lexicon)
        for field in ['weights', 'rules', 'answer']:
            with self.assertRaises(RuleError):
                operate(state, {'action': 'start', field: None, 'requestId': field}, lexicon)
        self.assertEqual(state['game']['used'], 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)

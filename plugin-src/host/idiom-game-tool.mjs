import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installQqIdiomFastReplies } from './channels/qq/idiom-fast-reply.mjs';

export const IDIOM_TOOL = 'dsh_idiom_game';
const keyFor = id => createHash('sha256').update(id).digest('hex');

function skillAt(directory) {
  const path = join(directory, 'SKILL.md');
  const text = readFileSync(path, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error('Invalid bundled idiom skill');
  const name = match[1].match(/^name: (.+)$/m)?.[1];
  const description = match[1].match(/^description: (.+)$/m)?.[1];
  if (name !== 'guess-idiom' || !description) throw new Error('Invalid bundled idiom skill metadata');
  return { name, description, content: match[2], source: 'runtime', provider: 'dsh-im', path,
    resourceBase: { kind: 'directory', path: directory } };
}

function bundledSkillDirectory() {
  const here = dirname(fileURLToPath(import.meta.url));
  // Known layouts: plugin-src/host source and lib/index.js Host bundle.
  const candidates = [resolve(here, '../../skills/guess-idiom'), resolve(here, '../skills/guess-idiom')];
  const directory = candidates.find(path => existsSync(join(path, 'SKILL.md')));
  if (!directory) throw new Error('Bundled guess-idiom skill is missing');
  return directory;
}

function fastRequest(text, active) {
  if (typeof text !== 'string') return null;
  const input = text.trim();
  const start = input.match(/^(?:开始|来一局|玩)?猜成语(?:[，,：:\s]*(3|5|10|三|五|十)\s*次(?:机会|模式)?)?[。！!]?$/u);
  if (start) return { action: 'start', ...(start[1] ? { limit: ({ 三: 3, 五: 5, 十: 10 })[start[1]] ?? Number(start[1]) } : {}) };
  if (!active) return null;
  if (/^(?:猜成语进度|本局进度|还剩几次)[？?。]?$/u.test(input)) return { action: 'status' };
  return /^\p{Script=Han}{4}$/u.test(input) ? { action: 'guess', guess: input } : null;
}

export function idiomReplyText(result) {
  const progress = result.active || result.board ? `已用 ${result.used}/${result.limit} 次，剩余 ${result.remaining} 次。` : '';
  const terminal = { won: '猜中了！', lost: '本局机会用完。', revealed: '本局已揭晓。' }[result.status];
  const message = result.status === 'already-active' ? '本局还在进行；要重开请说“重新开始猜成语”。' : result.message;
  return [result.vocabulary?.added ? `“${result.vocabulary.word}”已加入本群词库。` : '',
    result.board, terminal ? `${terminal}答案：${result.answer}。` : message, progress,
    result.nextRound ? `第 ${result.nextRound.round} 局已开始，${result.nextRound.limit} 次机会，请猜四字词组。` : result.nextQuestionError ?? (result.nextQuestionRequired ? '本局结束，等她想好下一题再开局。' : '')].filter(Boolean).join('\n');
}

export function createIdiomGameTool({ skillDirectory = bundledSkillDirectory(),
  stateDirectory = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'integrations/dsh-im/idiom-games'),
  python = 'python3', timeoutMs = 10_000, logger = console } = {}) {
  const skill = skillAt(skillDirectory);
  const children = new Set();

  function readState(sessionId) {
    try { return JSON.parse(readFileSync(join(stateDirectory, `${keyFor(sessionId)}.json`), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  function invoke(args, exec) {
    exec.signal?.throwIfAborted();
    const sessionId = exec.agent?.session?.id;
    if (typeof sessionId !== 'string' || !sessionId || typeof exec.callId !== 'string' || !exec.callId) {
      throw new Error('Idiom game requires the actual DSH Session and tool call identity');
    }
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.hasOwn(args, 'requestId')) throw new TypeError('Invalid idiom game request');
    if (args.action === 'rules') {
      if (Object.keys(args).some(key => key !== 'action')) throw new TypeError('rules takes no other fields');
      return Promise.resolve({ instructions: skill.content });
    }
    const scope = keyFor(sessionId);
    const requestId = keyFor(`${sessionId}\0${exec.callId}`);
    return new Promise((resolveResult, reject) => {
      const child = spawn(python, ['-B', '-E', '-s', join(skillDirectory, 'scripts/idiom_game.py'),
        '--state-dir', stateDirectory, '--scope', scope], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      children.add(child);
      let output = '', stderr = '', size = 0, failure = null;
      const fail = (error, code) => {
        if (!exec.signal?.aborted) logger.error?.('[dsh-im:idiom] local referee failed:', { requestId, exitCode: code, cause: error.stack, stderr });
        reject(error);
      };
      const stop = error => { failure ??= error; child.kill('SIGTERM'); };
      const unknown = message => Object.assign(new Error(message), { code: 'idiom-operation-unknown', operationMayHaveCommitted: true });
      const timer = setTimeout(() => stop(unknown('本地裁判超时；结果可能已保存，请用 status 核对，不要重放猜测。')), timeoutMs);
      const abort = () => stop(exec.signal.reason ?? unknown('游戏操作已取消，请先查看本局状态。'));
      exec.signal?.addEventListener('abort', abort, { once: true });
      if (exec.signal?.aborted) abort();
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', text => {
        size += Buffer.byteLength(text);
        if (size > 16 * 1024) stop(unknown('本地裁判返回过长，请核对游戏状态。'));
        else output += text;
      });
      // Preserve local diagnostics, but never copy a traceback to the group.
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', text => { stderr = (stderr + text).slice(-8192); });
      child.on('error', error => { failure ??= error; });
      child.stdin.on('error', error => { failure ??= error; });
      child.on('close', code => {
        clearTimeout(timer); exec.signal?.removeEventListener('abort', abort); children.delete(child);
        if (failure) return fail(failure, code);
        let result;
        try { result = JSON.parse(output); }
        catch (cause) { return fail(Object.assign(unknown('本地裁判没有返回有效结果，请用 status 核对。'), { cause }), code); }
        if (!result || typeof result !== 'object' || Array.isArray(result)) return fail(unknown('本地裁判返回格式无效，请核对游戏状态。'), code);
        if (result.ok === false && typeof result.error?.message === 'string' && typeof result.error?.code === 'string') {
          return reject(Object.assign(new Error(result.error.message), { code: result.error.code }));
        }
        if (code !== 0 || result.ok !== true || !result.value || typeof result.value !== 'object') return fail(unknown('本地裁判执行失败，请核对游戏状态。'), code);
        resolveResult(result.value);
      });
      child.stdin.end(JSON.stringify({ ...args, requestId }));
    });
  }

  return { skill,
    async fastReply(text, exec, { resolveReading, chooseQuestion } = {}) {
      const candidate = fastRequest(text, true);
      if (!candidate) return null;
      const request = candidate.action === 'start' ? candidate : fastRequest(text, readState(exec.agent.session.id)?.game != null);
      if (!request) return null;
      let questionUsage, questionRequested = false;
      const openQuestion = async (settings, callId) => {
        questionRequested = true;
        const question = await chooseQuestion(settings);
        questionUsage = question.usage;
        exec.signal?.throwIfAborted();
        return invoke({ ...settings, action: 'start', answer: question.answer, pinyin: question.pinyin, tier: question.tier }, { ...exec, callId });
      };
      let result;
      if (request.action === 'start') {
        const state = readState(exec.agent.session.id);
        if (state?.game) result = await invoke(request, exec);
        else {
          if (!chooseQuestion) return null;
          const previousOptions = state?.completed ? Object.fromEntries(['limit','rules','difficulty','weights'].map(name => [name, state.completed[name]])) : {};
          result = await openQuestion({ ...previousOptions, ...request }, exec.callId);
        }
      } else result = await invoke(request, exec);
      let readingRequested = false, readingUsage;
      if (result.status === 'unverified-idiom') {
        if (!resolveReading) return null;
        const reading = await resolveReading(request.guess);
        readingRequested = true; readingUsage = reading.usage;
        exec.signal?.throwIfAborted();
        if (reading.pinyin === null) return { text: '这个词的读音还没确认，请给出四个字的拼音和声调，本次不计次数。',
          result: { status: 'reading-unconfirmed', word: request.guess }, readingRequested: true, usage: reading.usage };
        result = await invoke({ action: 'add_and_guess', word: request.guess, pinyin: reading.pinyin }, { ...exec, callId: `${exec.callId}:add-and-guess` });
      }
      if (result.nextQuestionRequired && chooseQuestion) {
        try { result.nextRound = await openQuestion(result.nextOptions, `${exec.callId}:next-question`); }
        catch (error) {
          if (exec.signal?.aborted) throw error;
          // The guess is already committed: preserve its board if the next
          // question fails, and never replay this completed guess.
          logger.error?.('[dsh-im:idiom] next model question failed:', error);
          result.nextQuestionError = '下一题暂未准备好，请说“猜成语”让她重新出题。';
        }
      }
      let usage;
      if (questionRequested && readingRequested) {
        if (questionUsage && readingUsage) usage = Object.fromEntries([...new Set([...Object.keys(questionUsage), ...Object.keys(readingUsage)])]
          .map(key => [key, (questionUsage[key] ?? 0) + (readingUsage[key] ?? 0)]));
      } else usage = questionRequested ? questionUsage : readingUsage;
      return { text: idiomReplyText(result), result, ...((questionRequested || readingRequested) ? { readingRequested: true, usage } : {}) };
    },
    definition: {
      name: IDIOM_TOOL,
      description: '主持四字猜词：必须先由你想好秘密四字词，再以start的answer保存，程序不随机选词。缺词同时给pinyin。3/5/10次，常见题优先。任意四字词组都允许。guess提交原词，Python判色记次；缺词用add_and_guess补读音并判本手，只扣1次。仅入库用add_word。终局nextQuestionRequired时由你想下一题再start。只按board反馈，不自行算色。rules读技能；status核对进度。不运行任意命令。',
      parameters: { type: 'object', additionalProperties: false, properties: {
        action: { type: 'string', enum: ['start', 'guess', 'status', 'set_limit', 'reveal', 'rules', 'add_word', 'add_and_guess', 'lookup'], description: '默认 guess；缺词用add_and_guess，reveal仅在玩家要求揭晓时使用。' },
        guess: { type: 'string', description: '当前玩家实际提交的四字词组，原样传入。' },
        limit: { type: 'integer', enum: [3, 5, 10], description: 'start/set_limit 使用，默认10次。' },
        restart: { type: 'boolean', description: 'start：玩家明确重开时才为true。' },
        answer: { type: 'string', description: 'start新局必填：你自己想好的秘密四字答案，不得省略让程序选词，也不要在聊天正文泄漏。' },
        difficulty: { type: 'string', enum: ['mixed', 'common', 'normal', 'rare'], description: 'start：默认mixed分档随机，或固定常见/一般/拓展档。' },
        weights: { type: 'object', additionalProperties: false, required: ['common', 'normal', 'rare'], properties: {
          common: { type: 'integer', minimum: 0 }, normal: { type: 'integer', minimum: 0 }, rare: { type: 'integer', minimum: 0 },
        }, description: 'start：mixed各档权重，默认70/25/5，至少一项大于0。' },
        word: { type: 'string', description: 'add_word/add_and_guess/lookup：四字词组，无需是成语。' },
        pinyin: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' }, description: 'start/add_word/add_and_guess：确认的四字拼音，如yuan2/shen2/qi3/dong4，也支持带调拼音。' },
        tier: { type: 'string', enum: ['common', 'normal', 'rare'], description: 'add_word/add_and_guess：新词所属档位，默认normal。' },
        rules: { type: 'object', additionalProperties: false, properties: {
          ywInitials: { type: 'boolean' }, finals: { type: 'string', enum: ['spelling', 'phonetic'] }, phoneticCounts: { type: 'boolean' },
        }, description: 'start时按双方约定配置，默认按拼写拆分、四项分别按次数。' },
      } },
      output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: invoke,
    },
    context(session) {
      if (typeof session?.id !== 'string') return '';
      const path = join(stateDirectory, `${keyFor(session.id)}.json`);
      let state;
      try { state = JSON.parse(readFileSync(path, 'utf8')); }
      catch (error) {
        if (error.code === 'ENOENT') return '';
        return '本地猜成语记录暂不可读。用 dsh_idiom_game status 核对，不编造反馈或重置。';
      }
      const game = state.game;
      if (state.version !== 1 || (game && (![game.round, game.used, game.limit].every(Number.isSafeInteger) || game.used < 0 || game.used >= game.limit))) {
        return '本地猜成语记录格式异常，请核对，不自行恢复成新局。';
      }
      return game ? `你正在主持四字猜词（猜成语），玩家来猜：第${game.round}局，已用${game.used}/${game.limit}次。当前规则允许任意四字词组、网络用语和重复字，不能因为不是成语而拒绝。调用 dsh_idiom_game，只按返回 board 判色记次；缺词确认读音后调用 add_and_guess 一次补词并判本手，不再另提 guess。仅补词用 add_word，不扣次数。引用和示例不算猜测。秘密答案已保存在程序中，不重新想词或自行推算颜色。终局后你自己想好下一题，通过 start 的 answer 保存；程序不随机选词。` : state.completed ? `上一局已结束，正在等待你出下一题。请你自己想好秘密四字词，用 dsh_idiom_game start 的 answer 保存，不把答案写进聊天正文。沿用选项：${JSON.stringify(Object.fromEntries(['limit','rules','difficulty','weights'].map(name => [name,state.completed[name]])))}` : '';
    },
    close() { for (const child of children) child.kill('SIGTERM'); },
  };
}

export function installIdiomGame(ctx, options = {}) {
  if (typeof ctx?.tools?.register !== 'function') return false;
  const game = createIdiomGameTool(options);
  installQqIdiomFastReplies(ctx, game, options);
  ctx.tools.register(game.definition);
  const registerSkill = skillCtx => { skillCtx.skills.register(game.skill); };
  if (typeof ctx.inject === 'function') ctx.inject(['skills'], registerSkill);
  else if (ctx.skills) registerSkill(ctx);
  ctx.systemPrompt?.context({ name: 'dsh-im:qq-idiom-game', order: 117, text: assembly => game.context(assembly?.agent?.session) });
  ctx.effect?.(() => () => game.close(), 'dsh-im: local idiom referee');
  return game;
}

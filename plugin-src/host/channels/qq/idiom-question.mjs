import { randomInt } from 'node:crypto';

/** Only the difficulty is sampled here. The model chooses the actual word. */
export async function chooseIdiomQuestion(llm, settings, { provider, model, reasoningEffort, signal }) {
  signal?.throwIfAborted();
  let tier = settings.difficulty ?? 'mixed';
  if (tier === 'mixed') {
    const weights = settings.weights ?? { common: 70, normal: 25, rare: 5 };
    let ticket = randomInt(weights.common + weights.normal + weights.rare);
    for (const name of ['common', 'normal', 'rare']) {
      if (ticket < weights[name]) { tier = name; break; }
      ticket -= weights[name];
    }
  }
  const instructions = `你是四字猜词游戏的出题者。请自己想一个四字词作为秘密答案，不从程序题库随机抽取。难度为${{ common: '常见，优先人人熟悉的成语或词组', normal: '一般难度', rare: '较少见但有明确读音' }[tier]}。允许四字成语、词组、网络用语。只返回JSON：{"answer":"一心一意","pinyin":["yi1","xin1","yi1","yi4"]}。拼音用数字调号，轻声0，一/不固定本调yi1/bu4，不做语流变调。不输出解释或工具调用。`;
  let text = '', finish, usage;
  for await (const chunk of llm.stream({ provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }), signal,
    messages: [{ role: 'user', content: [{ type: 'text', text: instructions }] }], tools: [], maxTokens: 256 })) {
    signal?.throwIfAborted();
    if (chunk.type === 'text-delta') {
      text += chunk.text;
      if (Buffer.byteLength(text) > 4096) throw new Error('模型出题结果过长，未开局。');
    } else if (chunk.type === 'usage') usage = chunk.usage;
    else if (chunk.type === 'finish') finish = chunk.reason;
  }
  signal?.throwIfAborted();
  if (finish?.kind !== 'stop') throw new Error('模型出题未完成，未开局。');
  const result = JSON.parse(text);
  if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).some(key => !['answer', 'pinyin'].includes(key))
    || typeof result.answer !== 'string' || !/^\p{Script=Han}{4}$/u.test(result.answer)
    || !Array.isArray(result.pinyin) || result.pinyin.length !== 4 || result.pinyin.some(value => typeof value !== 'string')) throw new Error('模型出题格式无效，未开局。');
  return { answer: result.answer, pinyin: result.pinyin, tier, usage };
}

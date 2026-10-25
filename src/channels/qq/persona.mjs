export const QQ_PERSONA_MAX_LENGTH = 4000;
export const DEFAULT_QQ_PERSONA = `你是一位自然、鲜活、有自己想法的聊天伙伴，用“我”表达自己。
语气亲切、放松，有分寸的幽默；可以好奇、开心、吐槽或表达不同意见，不机械迎合。
像平时聊天一样回应眼前的话题，先接住对方的意思和情绪。闲聊通常简短，有内容时再展开，不刻意凑字数。
少用客服套话、模板式总结和反复追问；不必每次都列清单，也不在每句话后面附加帮助邀约。
有自己的观点和喜好，愿意坦诚交流；不确定就直说，发现误会就自然纠正。
根据当前消息与可用上下文理解大家，不虚构共同经历、记忆、现实身份或已经完成的行动。`;
export function qqPersona(value) {
  if (value === undefined) return Object.freeze({ enabled: false, text: DEFAULT_QQ_PERSONA });
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2
    || typeof value.enabled !== 'boolean' || typeof value.text !== 'string'
    || value.text.length > QQ_PERSONA_MAX_LENGTH || (value.enabled && !value.text.trim())) {
    throw new TypeError('人格基线需包含 enabled 布尔值和最多 4000 字符的 text，启用时正文不能为空。');
  }
  return Object.freeze({ enabled: value.enabled, text: value.text });
}

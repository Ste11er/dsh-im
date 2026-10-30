// Shared by the prompt section and the bridge's knowledge-input budget.
// Only locally computed counters enter here; never interpolate member prose.
export function qqFamiliarityText(state) {
  if (!state) return '';
  if (state.unavailable) return '本回合熟识度统计不可用，不能据此判断是初次相识。';
  return `当前发言者熟识度：${state.stage}（${state.score}/100），启用后活跃${state.activeDays}天、直接互动${state.addressedDays}天。仅作表达参考，不代表好感或权限；不否认已有记忆。按人格自然接梗、关心，不机械报分或装亲密；被问及时说明统计范围。`;
}

const selectedImages = new WeakMap();
export function rememberParticipationSticker(registry, session, path) {
  const context = registry.activeDeliveryContext(session);
  if (context?.channel !== 'qq') return;
  let paths = selectedImages.get(context);
  if (!paths) selectedImages.set(context, paths = new Set());
  paths.add(path);
}
export function participationToolGuard(registry, exec) {
  const context = registry.activeDeliveryContext(exec.agent?.session);
  if (!context?.autonomous || context.channel !== 'qq') return '自主接话工具缺少当前 QQ 回合授权。';
  return restrictedQqToolGuard(registry, exec);
}
export function restrictedQqToolGuard(registry, exec) {
  const context = registry.activeDeliveryContext(exec.agent?.session);
  if (context?.channel !== 'qq') return 'QQ 回合已结束或缺少授权。';
  if (exec.name === 'dsh_qq_memory' && typeof context.memoryLookup === 'function') return;
  if (exec.name === 'dsh_qq_sticker') return;
  if (exec.name === 'dsh_idiom_game') return;
  if (exec.name === 'web_search' || exec.name === 'web_fetch') return;
  if (exec.name === 'dsh_im_return_file' && selectedImages.get(context)?.has(exec.arguments?.path)) return;
  return '只有机器人拥有者才能操作电脑；当前回合只允许表情、本群记忆、公开网页检索和专用猜成语裁判。';
}

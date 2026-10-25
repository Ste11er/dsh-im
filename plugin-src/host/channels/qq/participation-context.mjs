const selectedImages = new WeakMap();
export function rememberParticipationSticker(registry, session, path) {
  const context = registry.activeDeliveryContext(session);
  if (!context?.autonomous) return;
  let paths = selectedImages.get(context);
  if (!paths) selectedImages.set(context, paths = new Set());
  paths.add(path);
}
export function participationToolGuard(registry, exec) {
  const context = registry.activeDeliveryContext(exec.agent?.session);
  if (!context?.autonomous || context.channel !== 'qq') return '自主接话工具缺少当前 QQ 回合授权。';
  if (exec.name === 'dsh_qq_memory' && typeof context.memoryLookup === 'function') return;
  if (exec.name === 'dsh_qq_sticker') return;
  if (exec.name === 'dsh_im_return_file' && selectedImages.get(context)?.has(exec.arguments?.path)) return;
  return '自主参与群聊只允许表情检索与本轮已选表情回传，不执行操作任务。';
}

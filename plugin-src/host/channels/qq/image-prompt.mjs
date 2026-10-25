import { inboundImagesAsFiles, modelImageFromOriginal } from '../../../../src/channels/shared/image-input.mjs';

/** Same bounded image admission for the private judge and image summarizer. */
export async function admitQqImagePrompt(attachments, content, images, limits, signal) {
  const files = inboundImagesAsFiles(images, limits);
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : [...content];
  let remaining = limits.maxTotalImageBytes;
  for (const [index, file] of files.entries()) {
    const loaded = await file.load({ signal });
    const prepared = await modelImageFromOriginal(loaded.data, loaded.mediaType,
      Math.min(remaining, limits.maxImageBytes), { signal });
    if (!prepared) throw new Error('QQ image input exceeds the configured image budget');
    remaining -= prepared.data.length;
    blocks.push({ type: 'text', text: `图片 ${index + 1}` },
      { type: 'image', mediaType: prepared.mediaType, data: prepared.data.toString('base64'), name: loaded.name });
  }
  return attachments.admitPromptContent(blocks);
}

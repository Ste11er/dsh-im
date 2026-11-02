// Shared by Host and Client; no Node runtime imports.
export function qqEmptyMentionWaitSeconds(value = 30) {
  if (![0, 30, 60].includes(value)) throw new TypeError('emptyMentionWaitSeconds must be 0, 30 or 60');
  return value;
}


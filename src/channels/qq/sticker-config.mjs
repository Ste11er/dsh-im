export function qqStickersEnabled(value = false) {
  if (typeof value !== 'boolean') throw new TypeError('stickersEnabled must be a boolean');
  return value;
}

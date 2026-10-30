/** Explicit QQ identities for computer operations; '*' is never an owner. */
export function qqComputerCommandOwners(value, ownerUserOpenid) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['direct', 'group'].includes(key))) {
    throw new TypeError('QQ computer command owners must be direct/group identities');
  }
  const result = {};
  for (const scope of ['direct', 'group']) {
    if (value[scope] === undefined) continue;
    const id = value[scope];
    if (typeof id !== 'string' || id !== id.trim() || !id || id === '*'
      || id.length > 256 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(id)) {
      throw new TypeError('QQ computer command owner identity is invalid');
    }
    result[scope] = id;
  }
  if (result.direct !== undefined && ownerUserOpenid !== undefined && ownerUserOpenid !== '*'
    && result.direct !== ownerUserOpenid) {
    throw new TypeError('QQ computer command owner must match the configured account owner');
  }
  return Object.freeze(result);
}

export function isQqComputerCommandOwner(owners, conversationType, senderId) {
  return typeof senderId === 'string' && senderId !== ''
    && owners?.[conversationType] === senderId;
}

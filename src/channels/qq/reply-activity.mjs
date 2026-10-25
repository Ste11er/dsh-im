// Includes QQ transport delivery: idle work starts only after accept() settles.
let active = 0;
let idleSince = Date.now();
const listeners = new Set();
const changed = () => { for (const listener of listeners) listener(); };
export const qqReplyActivity = Object.freeze({
  get busy() { return active > 0; },
  get idleSince() { return idleSince; },
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  run(action) {
    active++; changed();
    let result;
    try { result = action(); }
    catch (error) { result = Promise.reject(error); }
    return Promise.resolve(result).finally(() => { active--; if (!active) idleSince = Date.now(); changed(); });
  },
});

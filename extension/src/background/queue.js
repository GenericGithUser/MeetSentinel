// Serializes every storage read-modify-write in the service worker.
// Many browser events fire at once; without this, two evaluations can interleave and clobber each other.
let tail = Promise.resolve();

export function serial(fn) {
  const result = tail.then(() => fn());
  tail = result.catch((e) => console.error("[serial]", e));
  return result;
}

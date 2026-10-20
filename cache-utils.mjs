// Bounded TTL helpers; callers own the Map. Reads refresh eviction order, not expiry.
// Date remains the global clock so node:test mock timers work across modules.
export function setBoundedDateCache(cache, key, value, maxEntries = 16) {
  const now = Date.now();
  for (const [cachedKey, entry] of cache) {
    if (!entry || entry.expiresAt <= now) cache.delete(cachedKey);
  }
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
}

export function getFreshTtlCacheEntry(cache, key, now = Date.now()) {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  // Map 的插入順序就是 LRU 順序；命中時把 key 移到最後。
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

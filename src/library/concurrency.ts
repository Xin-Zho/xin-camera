/**
 * 并发受限的批量任务。
 *
 * 相册每一页要逐个资产补缩略图和定位，这些都是一次原生调用；
 * 一次全发出去会让 iCloud 上的资产同时触发下载，也会让主线程被回调淹没。
 * 这里固定住同时在飞的请求数，顺序推进。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const effectiveLimit = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: effectiveLimit }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

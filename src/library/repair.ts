import { mapWithConcurrency } from './concurrency';
import { readPermission, repairPersistedSources } from './reader';

import type { MediaAsset } from '@/src/domain/types';

/**
 * 老存档媒体源自愈。
 *
 * M16 之前导入的照片只持有临时目录 uri，iOS 清理 tmp 后成死路径；
 * M16 起新导入自带沙盒原图 + 缩略图。这个模块把老记录按 `libraryAssetId`
 * 重新修复——**不需要用户重新导入**，只要照片还在系统相册里。
 *
 * 设计约束：
 *  - 静默运行：启动后台跑，不弹权限框（没授权就直接跳过，下回再说）；
 *  - 幂等：有 thumbUri 的记录视为已修过，绝不重复处理；
 *  - 并发受限：取原稿是重操作（iCloud 资产会触发下载）。
 */

export interface MediaSourcePatch {
  id: string;
  /** 沙盒内持久化原图 */
  uri: string;
  /** 600px 缩略图；生成失败为 null，显示层回落到 uri（此时已是持久路径） */
  thumbUri: string | null;
}

/** 同时在修的数量。取原稿 + 压缩都吃 CPU/IO，宁慢勿卡 */
const REPAIR_CONCURRENCY = 2;

/** 需要修复的记录：真实导入的照片且还没有缩略图（M16 前的唯一标记） */
export function mediaNeedingRepair(media: readonly MediaAsset[]): MediaAsset[] {
  return media.filter(
    (item) =>
      item.kind === 'photo' && item.origin === 'library' && item.libraryAssetId && !item.thumbUri,
  );
}

export async function repairMediaSources(
  media: readonly MediaAsset[],
  onPatch: (patch: MediaSourcePatch) => void,
): Promise<number> {
  const candidates = mediaNeedingRepair(media);
  if (candidates.length === 0) return 0;

  // 只查权限不弹框：启动时静默自愈，没授权就整批跳过
  const permission = await readPermission(false);
  if (permission.status !== 'granted') return 0;

  let fixed = 0;
  await mapWithConcurrency(candidates, REPAIR_CONCURRENCY, async (item) => {
    const sources = await repairPersistedSources(item.libraryAssetId as string);
    if (!sources) return;
    fixed += 1;
    onPatch({ id: item.id, uri: sources.uri, thumbUri: sources.thumbUri });
  });
  return fixed;
}

/**
 * 「哪些照片还该显示」——全 App 唯一的判定入口。
 *
 * 为什么必须收在一处：
 *   地图、到访图库、故事阅读页、时间轴如果各自写一套筛选，很容易出现
 *   「故事删了但地图上的照片还在」「图库里移除了但时间轴还撑着跨度」这类
 *   互相矛盾的界面。这些矛盾的根源不是某处写错，而是同一个问题被回答了四次。
 *
 * 判定顺序（不可交换）：
 *   1. 用户从回忆相册移除 → 隐藏。**移除优先于一切**，就算故事还在也不能显示；
 *   2. 被至少一本「活跃故事」引用 → 显示。
 *      活跃 = 没删（`isDeleted`）且没被合并进别的册子（`mergedIntoStoryId`）。
 *      被合并掉的故事不算活跃，但它的照片被合集引用着，所以照样显示——这是对的；
 *   3. 其余隐藏。再分两种原因：
 *      - `story-deleted`：引用它的故事都被删了 / 都并走了。删除故事就是靠这条让照片跟着消失；
 *      - `unlinked`：没有任何故事引用它。脏数据或导入中途失败的残留，不能因为"没主"就露出来。
 *
 * 刻意**不**在这里改任何数据：它只回答"该不该显示"，不改引用、不改顺序。
 * 移除照片同样只写 `MediaAsset.removedAt`，引用原样留着——恢复才能连顺序一起回来。
 */
import { dayKeyOf } from '@/src/utils/datetime';
import type { MediaAsset, Story, Visit } from './types';

/** 照片不可见的原因。UI 要能说清"为什么这张不见了"，所以不合并成布尔值 */
export type MediaHideReason = 'removed' | 'story-deleted' | 'unlinked';

export interface MediaState {
  visible: boolean;
  /** 只在 `visible === false` 时有值 */
  reason?: MediaHideReason;
}

export interface MediaVisibility {
  /** mediaId → 状态。表里没有的 id 视为「媒体不存在」，同样不可见 */
  stateOf: Map<string, MediaState>;
  /** 可见媒体的 id 集合，供高频判断使用（图库逐格、地图逐点） */
  visibleIds: Set<string>;
  counts: {
    total: number;
    visible: number;
    removed: number;
    storyDeleted: number;
    unlinked: number;
  };
}

/**
 * 建立可见性快照。
 * 入参只读，返回的 Map / Set 是新的，调用方可以随便持有。
 */
export function buildMediaVisibility(media: MediaAsset[], stories: Story[]): MediaVisibility {
  /** 被活跃故事引用的媒体 */
  const byActiveStory = new Set<string>();
  /** 被任意故事引用的媒体（含已删除、已合并的），用来区分两种隐藏原因 */
  const byAnyStory = new Set<string>();

  stories.forEach((story) => {
    const active = !story.isDeleted && !story.mergedIntoStoryId;
    story.mediaIds.forEach((id) => {
      byAnyStory.add(id);
      if (active) byActiveStory.add(id);
    });
  });

  const stateOf = new Map<string, MediaState>();
  const visibleIds = new Set<string>();
  let removed = 0;
  let storyDeleted = 0;
  let unlinked = 0;

  media.forEach((item) => {
    if (item.removedAt) {
      stateOf.set(item.id, { visible: false, reason: 'removed' });
      removed += 1;
      return;
    }
    if (byActiveStory.has(item.id)) {
      stateOf.set(item.id, { visible: true });
      visibleIds.add(item.id);
      return;
    }
    const reason: MediaHideReason = byAnyStory.has(item.id) ? 'story-deleted' : 'unlinked';
    if (reason === 'story-deleted') storyDeleted += 1;
    else unlinked += 1;
    stateOf.set(item.id, { visible: false, reason });
  });

  return {
    stateOf,
    visibleIds,
    counts: {
      total: media.length,
      visible: visibleIds.size,
      removed,
      storyDeleted,
      unlinked,
    },
  };
}

/** 媒体不存在时也算不可见——宁可少显示一张，也不要留一个会崩的格子 */
export function isMediaVisible(visibility: MediaVisibility, mediaId: string): boolean {
  return visibility.stateOf.get(mediaId)?.visible === true;
}

export function hideReasonOf(visibility: MediaVisibility, mediaId: string): MediaHideReason | null {
  return visibility.stateOf.get(mediaId)?.reason ?? null;
}

/** 全部可见媒体，保持传入顺序（顺序由上游决定，这里不排序） */
export function visibleMedia(media: MediaAsset[], visibility: MediaVisibility): MediaAsset[] {
  return media.filter((item) => visibility.visibleIds.has(item.id));
}

/** 从 id 列表里挑出可见媒体，保持 id 顺序 */
export function visibleMediaOf(
  ids: string[],
  index: Map<string, MediaAsset>,
  visibility: MediaVisibility,
): MediaAsset[] {
  const result: MediaAsset[] = [];
  ids.forEach((id) => {
    if (!visibility.visibleIds.has(id)) return;
    const item = index.get(id);
    if (item) result.push(item);
  });
  return result;
}

/** 一组 id 里还剩几张能看。卡片上的「N 张」必须用它，不能读 mediaIds.length */
export function visibleCount(ids: string[], visibility: MediaVisibility): number {
  let count = 0;
  ids.forEach((id) => {
    if (visibility.visibleIds.has(id)) count += 1;
  });
  return count;
}

/**
 * 挑封面。
 *
 * 封面被移除是必然会发生的（用户从图库移除了当时当封面的那张），
 * 这时不能显示灰块，也不能把封面字段改掉——用户恢复那张照片后，封面应该还是它。
 * 所以这里只做"读取时回退"：原封面可见就用它，否则用第一张可见照片。
 */
export function pickVisibleCover(
  ids: string[],
  preferredId: string | undefined,
  index: Map<string, MediaAsset>,
  visibility: MediaVisibility,
): MediaAsset | undefined {
  if (preferredId && visibility.visibleIds.has(preferredId)) {
    const preferred = index.get(preferredId);
    if (preferred) return preferred;
  }
  for (const id of ids) {
    if (!visibility.visibleIds.has(id)) continue;
    const item = index.get(id);
    if (item) return item;
  }
  return undefined;
}

/**
 * 一次到访是否还值得显示：至少剩一张可见照片。
 *
 * 注意判据是**到访自己的 mediaIds**，不是地点的聚合字段——
 * 一次到访的照片可以来自同一地点，但反过来不成立。
 */
export function isVisitVisible(visit: Visit, visibility: MediaVisibility): boolean {
  return visibleCount(visit.mediaIds, visibility) > 0;
}

/** 给界面用的原因文案。写清楚"是本 App 内的移除，不是删了手机相册" */
export function describeHideReason(reason: MediaHideReason): string {
  if (reason === 'removed') return '已从回忆相册移除';
  if (reason === 'story-deleted') return '所在故事已删除';
  return '没有归属的故事';
}

/** 归属日键。与展示层同一套口径：有固定 dateKey 就绝不重算 */
export function mediaDayKey(item: MediaAsset): string {
  return dayKeyOf(item.capturedAt, item.dateKey);
}

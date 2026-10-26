import { dayKeyOf, toDate } from '@/src/utils/datetime';
import { isWithinRange } from '@/src/domain/timeline';
import type { MediaAsset, Place, PlaceSummary, Story, TimeRange, Visit } from '@/src/domain/types';

/**
 * 纯选择函数：只吃数据、吐结果，不碰 React、不碰 store。
 * 页面和组件都从这里取派生数据，避免各自写一套筛选逻辑。
 */

const descByStart = (a: { startAt: string }, b: { startAt: string }) =>
  toDate(b.startAt).getTime() - toDate(a.startAt).getTime();

/** 故事相册里真正显示的故事：没删、没被合并进别的册子 */
export function selectActiveStories(stories: Story[]): Story[] {
  return stories.filter((s) => !s.isDeleted && !s.mergedIntoStoryId).sort(descByStart);
}

/** 已删除的故事，用于"撤销删除"入口 */
export function selectDeletedStories(stories: Story[]): Story[] {
  return stories.filter((s) => s.isDeleted && !s.mergedIntoStoryId).sort(descByStart);
}

export function selectStoryById(stories: Story[], storyId: string | null): Story | undefined {
  if (!storyId) return undefined;
  return stories.find((s) => s.id === storyId);
}

export function selectPlaceById(places: Place[], placeId: string | null): Place | undefined {
  if (!placeId) return undefined;
  return places.find((p) => p.id === placeId);
}

export function selectVisitById(visits: Visit[], visitId: string | null): Visit | undefined {
  if (!visitId) return undefined;
  return visits.find((v) => v.id === visitId);
}

/** 某地点的全部到访，最近的在前 */
export function selectVisitsOfPlace(visits: Visit[], placeId: string): Visit[] {
  return visits.filter((v) => v.placeId === placeId).sort(descByStart);
}

/** 到访与时间窗口是否有交集（跨窗口的到访仍然算在窗口内） */
export function visitOverlapsRange(visit: Visit, range: TimeRange): boolean {
  const s = toDate(visit.startAt).getTime();
  const e = toDate(visit.endAt).getTime();
  const rs = toDate(range.startAt).getTime();
  const re = toDate(range.endAt).getTime();
  return s <= re && e >= rs;
}

export function selectMediaByIds(media: MediaAsset[], ids: string[]): MediaAsset[] {
  const index = new Map(media.map((m) => [m.id, m]));
  return ids.map((id) => index.get(id)).filter((m): m is MediaAsset => Boolean(m));
}

export function selectMediaOfVisit(media: MediaAsset[], visit: Visit): MediaAsset[] {
  return selectMediaByIds(media, visit.mediaIds).sort(
    (a, b) => toDate(a.capturedAt).getTime() - toDate(b.capturedAt).getTime(),
  );
}

export function selectMediaById(media: MediaAsset[], id: string | undefined): MediaAsset | undefined {
  if (!id) return undefined;
  return media.find((m) => m.id === id);
}

/**
 * 地图标记的数据源（规格 §5.3）：
 *  - 一个 Place 只会产出一个标记；
 *  - 代表照片只从**当前时间窗口内**的到访里取，取最近一次到访的封面；
 *  - 窗口内没有到访时，仍返回该地点（canHighlight=false），由地图弱化显示，
 *    不能把它当成"地点不存在"。
 */
export function selectPlaceSummaries(
  places: Place[],
  visits: Visit[],
  media: MediaAsset[],
  range: TimeRange,
): PlaceSummary[] {
  const mediaIndex = new Map(media.map((m) => [m.id, m]));
  const visitsByPlace = new Map<string, Visit[]>();
  visits.forEach((v) => {
    const list = visitsByPlace.get(v.placeId) ?? [];
    list.push(v);
    visitsByPlace.set(v.placeId, list);
  });

  return places.map((place) => {
    const all = (visitsByPlace.get(place.id) ?? []).sort(descByStart);
    const inRange = all.filter((v) => visitOverlapsRange(v, range));
    const latestVisit = inRange[0] ?? all[0];
    const coverMedia = latestVisit ? mediaIndex.get(latestVisit.coverMediaId) : undefined;
    return {
      place,
      latestVisit,
      coverMedia,
      visitCountInRange: inRange.length,
    };
  });
}

/** 时间轴里"有回忆"的月份，用于刻度上打点 */
export function selectMonthsWithVisits(visits: Visit[], range: TimeRange): string[] {
  const keys = new Set<string>();
  visits.forEach((v) => {
    if (visitOverlapsRange(v, range)) {
      const d = toDate(v.startAt);
      keys.add(`${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}`);
    }
  });
  return Array.from(keys);
}

/**
 * 故事相册按时间段分组时用：同一天的多本排在一起。
 *
 * 优先用 `story.dateKey`（导入时固定的归属日），没有才回退到 startAt 的设备时区解读。
 * 这一条是「换时区后故事不换天」的落点：分组不再读设备时区。
 * 注意入参要求已按时间倒序（`selectActiveStories` 保证了这一点），
 * 这里只做相邻合并，不重新排序。
 */
export function groupStoriesByDay(
  stories: Story[],
): { dayKey: string; dateKey: string; stories: Story[] }[] {
  const groups: { dayKey: string; dateKey: string; stories: Story[] }[] = [];
  stories.forEach((story) => {
    const dateKey = dayKeyOf(story.startAt, story.dateKey);
    const last = groups[groups.length - 1];
    if (last && last.dateKey === dateKey) last.stories.push(story);
    else groups.push({ dayKey: dateKey, dateKey, stories: [story] });
  });
  return groups;
}

/** 是否落在当前时间窗口内，用于地图高亮判断 */
export function isStoryInRange(story: Story, range: TimeRange): boolean {
  return isWithinRange(story.startAt, range);
}

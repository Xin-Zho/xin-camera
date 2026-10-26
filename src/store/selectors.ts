import { dayKeyOf, toDate } from '@/src/utils/datetime';
import { computeMediaSpan, isDayKeyInRange, isWithinRange, type MediaSpan } from '@/src/domain/timeline';
import type { MediaAsset, Place, PlaceSummary, Story, TimeRange, Visit } from '@/src/domain/types';
import {
  buildMediaVisibility,
  type MediaVisibility,
  isVisitVisible,
  pickVisibleCover,
  visibleCount,
  visibleMedia,
  visibleMediaOf,
} from '@/src/domain/visibility';

/**
 * 纯选择函数：只吃数据、吐结果，不碰 React、不碰 store。
 * 页面和组件都从这里取派生数据，避免各自写一套筛选逻辑。
 *
 * 关于 `visibility`：凡是"该显示哪些照片"的问题，一律从 `selectVisibility` 拿快照再传进来，
 * 默认不传 = 不做可见性过滤。默认值只服务于断言和历史调用点，
 * **页面必须传**——否则就会出现"故事删了照片还在地图上"这种分裂。
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

export function selectMediaOfVisit(
  media: MediaAsset[],
  visit: Visit,
  visibility?: MediaVisibility,
): MediaAsset[] {
  const index = new Map(media.map((m) => [m.id, m]));
  const items = visibility
    ? visibleMediaOf(visit.mediaIds, index, visibility)
    : selectMediaByIds(media, visit.mediaIds);
  return items.sort((a, b) => toDate(a.capturedAt).getTime() - toDate(b.capturedAt).getTime());
}

export function selectMediaById(media: MediaAsset[], id: string | undefined): MediaAsset | undefined {
  if (!id) return undefined;
  return media.find((m) => m.id === id);
}

/* ---------------------------------------------------------------- 可见性 */

/**
 * 有效照片快照。全 App 只在这里算一次，页面用 `useMemo` 缓存住往下传。
 * 参数顺序刻意与 `buildMediaVisibility(media, stories)` 一致——
 * 顺序不一致的函数最容易在调用点写反，而这种错不会报错，只会让结果默默不对。
 */
export function selectVisibility(media: MediaAsset[], stories: Story[]): MediaVisibility {
  return buildMediaVisibility(media, stories);
}

/** 还看得见的照片（全量），保持原顺序 */
export function selectVisibleMedia(media: MediaAsset[], visibility: MediaVisibility): MediaAsset[] {
  return visibleMedia(media, visibility);
}

/** 用户从回忆相册移除的照片，最近移除的在前。回收站与恢复入口用 */
export function selectRemovedMedia(media: MediaAsset[], visibility: MediaVisibility): MediaAsset[] {
  return media
    .filter((item) => visibility.stateOf.get(item.id)?.reason === 'removed')
    .sort((a, b) => toDate(b.removedAt ?? '').getTime() - toDate(a.removedAt ?? '').getTime());
}

/** 时间轴该覆盖的范围。没有任何有效照片时返回 null——页面据此显示空状态 */
export function selectMediaSpan(media: MediaAsset[], visibility: MediaVisibility): MediaSpan | null {
  return computeMediaSpan(visibleMedia(media, visibility));
}

/** 一次到访是否落在当前时间窗口。按归属日离散比较，与时间轴刻度同一套口径 */
export function isVisitInRange(visit: Visit, range: TimeRange): boolean {
  return isDayKeyInRange(dayKeyOf(visit.startAt, visit.dateKey), range);
}

/**
 * 地图标记的数据源（规格 §5.3）：
 *  - 一个 Place 只会产出一个标记；
 *  - 代表照片只从**当前时间窗口内**的到访里取，取最近一次到访的封面；
 *  - 窗口内没有到访时，仍返回该地点（canHighlight=false），由地图弱化显示，
 *    不能把它当成"地点不存在"。
 *
 * 传了 `visibility` 时：只把「还剩可见照片的到访」算进计数，封面按可见性回退。
 * 注意它**仍然返回窗口内没有照片的地点**——"这一格暂时没内容"和"这个地点不该出现"
 * 是两件事，后者由 `selectMapPlaceSummaries` 处理。
 */
export function selectPlaceSummaries(
  places: Place[],
  visits: Visit[],
  media: MediaAsset[],
  range: TimeRange,
  visibility?: MediaVisibility,
): PlaceSummary[] {
  const mediaIndex = new Map(media.map((m) => [m.id, m]));
  const pool = visibility ? visits.filter((visit) => isVisitVisible(visit, visibility)) : visits;
  const visitsByPlace = new Map<string, Visit[]>();
  pool.forEach((v) => {
    const list = visitsByPlace.get(v.placeId) ?? [];
    list.push(v);
    visitsByPlace.set(v.placeId, list);
  });

  return places.map((place) => {
    const all = (visitsByPlace.get(place.id) ?? []).sort(descByStart);
    const inRange = all.filter((v) =>
      visibility ? isVisitInRange(v, range) : visitOverlapsRange(v, range),
    );
    const latestVisit = inRange[0] ?? all[0];
    const coverMedia = latestVisit
      ? visibility
        ? pickVisibleCover(
            latestVisit.mediaIds,
            latestVisit.coverMediaId,
            mediaIndex,
            visibility,
          )
        : mediaIndex.get(latestVisit.coverMediaId)
      : undefined;
    return {
      place,
      latestVisit,
      coverMedia,
      visitCountInRange: inRange.length,
    };
  });
}

/**
 * 地图上真正要画的标记。
 *
 * 比 `selectPlaceSummaries` 多两道过滤：
 *  - 未定位的照片收在一处，没有坐标，不能上地图（否则会被画到几内亚湾）；
 *  - **一张可见照片都没有的地点直接隐藏**。
 *    这一条就是「删除故事后照片从地图消失」的落点：故事删了 → 照片不可见 →
 *    到访没有可见照片 → 该地点没有 coverMedia → 标记不出现。
 */
export function selectMapPlaceSummaries(
  places: Place[],
  visits: Visit[],
  media: MediaAsset[],
  range: TimeRange,
  visibility: MediaVisibility,
): PlaceSummary[] {
  return selectPlaceSummaries(places, visits, media, range, visibility).filter(
    (summary) => !summary.place.unlocated && summary.coverMedia !== undefined,
  );
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

/** 一个地点里还剩多少张可见照片。地点的 mediaIds 是聚合字段，含已被移除的 */
export function selectPlaceVisibleCount(place: Place, visibility: MediaVisibility): number {
  return visibleCount(place.mediaIds, visibility);
}

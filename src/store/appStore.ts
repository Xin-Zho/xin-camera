import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type { StateCreator } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';

import { mockMedia, mockPlaces, mockStories, mockVisits } from '@/src/data';
import {
  computeMediaSpan,
  makeMonthRange,
  makeRange,
  reconcileRangeToSpan,
} from '@/src/domain/timeline';
import type {
  CoverTitleMode,
  MediaAsset,
  Place,
  Story,
  StoryLayout,
  TimeRange,
  Visit,
} from '@/src/domain/types';
import {
  buildMediaVisibility,
  isMediaVisible,
  visibleCount,
  visibleMedia,
} from '@/src/domain/visibility';
import type { ImportCandidate, ImportPlan } from '@/src/library/importPlan';
import { planLibraryImport } from '@/src/library/importPlan';
import type { MediaSourcePatch } from '@/src/library/repair';
import type { StorageIssue } from '@/src/store/storage';
import { writeQuarantine } from '@/src/store/storage';
import { formatDay } from '@/src/utils/datetime';

/**
 * 全局唯一 store（规格 §8）。
 * 地图页和故事页都必须从这里读，不允许各自维护副本。
 *
 * 持久化策略（v2）：**四层一起存**（`stories` / `places` / `visits` / `media`）。
 * v1 只存故事层，因为当时用户能改的只有故事，地点/到访/照片都是示例数据派生的。
 * 接入真实相册导入之后这条前提不成立了：导入会**新建**地点、到访和媒体，
 * 不存下来就等于每次重启都丢一次导入。
 *
 * 没进 `partialize` 的字段（`timeRange` / 选中项 / `lastMergedStoryId` / `mapFocus`）
 * 都是瞬态 UI 状态，重启回到「最近一次回忆所在月份」比恢复上次拖到的位置更符合预期。
 */

/** 地图归位请求。导入后把视野带到新照片所在地，否则新地点可能就在屏幕外 */
export interface MapFocusRequest {
  latitude: number;
  longitude: number;
  /** 自增口令：同一个坐标连续导入两次也要能触发第二次归位 */
  token: number;
}

interface AppState {
  places: Place[];
  visits: Visit[];
  media: MediaAsset[];
  stories: Story[];
  /** 地图右侧时间轴当前窗口 */
  timeRange: TimeRange;
  selectedPlaceId: string | null;
  selectedVisitId: string | null;
  /** 最近一次合并产生的故事，用于列表里提示"可拆分" */
  lastMergedStoryId: string | null;
  /** 导入后要求地图归位一次，消费后由页面清空 */
  mapFocus: MapFocusRequest | null;
  /**
   * 存档健康状态。不持久化，每次启动由 rehydrate 过程判定。
   * 设置页据此区分「能保存」和「只在本次运行有效」——这两件事对用户的含义完全不同。
   */
  storageIssue: StorageIssue;
}

interface AppActions {
  setSelectedTimeRange: (range: TimeRange) => void;
  selectPlace: (placeId: string | null) => void;
  selectVisit: (visitId: string | null) => void;
  updateStory: (storyId: string, patch: Partial<Story>) => void;
  /**
   * 编辑页专用语义化 action。
   * 页面不允许直接拼 patch 来改这些字段，原因：
   *  1. 校验集中（封面必须在媒体列表里、空标题不接受、越界不许动）；
   *  2. store 里只存纯数据，不存回调，保证将来能直接 JSON 序列化做持久化。
   */
  setStoryTitle: (storyId: string, title: string) => void;
  setStoryCover: (storyId: string, mediaId: string) => void;
  setStoryLayout: (storyId: string, layout: StoryLayout) => void;
  setStoryCoverTitleMode: (storyId: string, mode: CoverTitleMode) => void;
  setStoryText: (storyId: string, text: string) => void;
  moveStoryMedia: (storyId: string, mediaId: string, direction: -1 | 1) => void;
  reorderStoryMedia: (storyId: string, orderedMediaIds: string[]) => void;
  toggleHighlightedMedia: (storyId: string, mediaId: string) => void;
  /** 返回新故事 id；不满足合并条件时返回 null */
  mergeStories: (storyIds: string[], title: string) => string | null;
  /** 返回被还原的故事 id 列表；无快照可拆时返回空数组 */
  splitStory: (storyId: string) => string[];
  deleteStory: (storyId: string) => void;
  restoreStory: (storyId: string) => void;
  /**
   * 从回忆相册移除照片。**不删系统相册原图**，只在本 App 内隐藏。
   *
   * 只写 `removedAt`，不动 `story.mediaIds` / `visit.mediaIds` / `place.mediaIds`：
   * 引用留着，恢复时顺序和封面位置才能原样回来。显示与否由 `domain/visibility` 统一判定。
   */
  removeMedia: (mediaIds: string[]) => void;
  /** 撤销移除。已移除的照片不会因为重新导入而自动复活，只能从这里恢复 */
  restoreMedia: (mediaIds: string[]) => void;
  /** 丢掉本地存档，回到示例数据（设置页用） */
  resetToMock: () => void;
  /**
   * 导入真实相册照片。规划与切分在 `planLibraryImport` 里算完，这里只负责一次落库：
   * 要么全进、要么不进，不出现「地点建了照片没进」的中间态。
   */
  importLibraryAssets: (candidates: ImportCandidate[]) => ImportPlan;
  /**
   * 老存档媒体源自愈回写（src/library/repair.ts 用）。
   * 只 patch 指定记录的 uri / thumbUri，其他字段原样保留。
   */
  patchMediaSources: (patches: MediaSourcePatch[]) => void;
  /** 地图归位消费完清掉，避免回来的每次渲染都再飞一次 */
  clearMapFocus: () => void;
}

const dedupe = <T,>(items: T[]): T[] => Array.from(new Set(items));

const nowISO = () => new Date().toISOString();

/**
 * 只改目标故事，其余原样返回（保持引用，避免列表里其他卡片无谓重渲染）。
 * updater 返回 null 表示"这次改动无效，忽略"。
 * 全部无效时返回原数组本身——引用不变，zustand 就不会通知任何订阅者。
 */
function mapStory(
  stories: Story[],
  storyId: string,
  updater: (story: Story) => Partial<Story> | null,
): Story[] {
  let changed = false;
  const next = stories.map((s) => {
    if (s.id !== storyId) return s;
    const patch = updater(s);
    if (!patch) return s;
    changed = true;
    // id 永远不允许被 patch 覆盖。`editedByUser` 在这里统一打标：
    // mapStory 的调用方全是用户编辑动作，导入流程不经过它。
    return { ...s, ...patch, id: s.id, updatedAt: nowISO(), editedByUser: true };
  });
  return changed ? next : stories;
}

/** 标题规范化：折叠连续空白；规范化后为空则视为无效（不允许无标题卡片） */
function normalizeTitle(raw: string): string | null {
  const next = raw.replace(/\s+/g, ' ').trim();
  return next.length > 0 ? next : null;
}

/**
 * 数据一变就重算时间轴范围。
 *
 * 「有效照片集合」是唯一输入：删除故事、恢复故事、移除照片、恢复照片、导入之后都要过一遍。
 * 不重算的话会出现两种硬伤——滑块停在已经不存在的月份上，
 * 或者只剩三天照片却还按整月铺刻度（滑轨上一大半位置是空的）。
 *
 * 没有有效照片时原样返回：空状态由页面判断，不在这里编一个假范围糊弄过去。
 */
function withReconciledRange(prev: TimeRange, media: MediaAsset[], stories: Story[]): TimeRange {
  const span = computeMediaSpan(visibleMedia(media, buildMediaVisibility(media, stories)));
  if (!span) return prev;
  return reconcileRangeToSpan(prev, span);
}

/**
 * 合集默认标题：`地点 · 起止日期`。
 * 地点收敛（同一地点只写一次，多地点写"首个 等 n 处"），日期同一天就不写区间。
 * sources 必须已按 startAt 升序排好。
 */
function buildMergedTitle(sources: Story[], places: Place[]): string {
  const nameOf = (id: string) => places.find((p) => p.id === id)?.name;
  const names = dedupe(sources.flatMap((s) => s.placeIds))
    .map(nameOf)
    .filter((n): n is string => Boolean(n));
  const placePart =
    names.length === 0 ? '合集' : names.length === 1 ? names[0] : `${names[0]} 等 ${names.length} 处`;

  const startAt = sources[0].startAt;
  const endAt = sources[sources.length - 1].endAt;
  const dayPart =
    formatDay(startAt) === formatDay(endAt)
      ? formatDay(startAt)
      : `${formatDay(startAt)} – ${formatDay(endAt)}`;

  return `${placePart} · ${dayPart}`;
}

const newestStory = [...mockStories]
  .filter((s) => !s.isDeleted && !s.mergedIntoStoryId)
  .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime())[0];

/** 初始视野：最近一次回忆所在的月份（规格 §5.2） */
const initialRange = makeMonthRange(newestStory?.startAt ?? '2026-10-12T12:00:00+08:00');

/** 存档键与版本。改存档结构时版本 +1，并在 `migrate` 里补一条迁移。 */
export const STORE_KEY = 'xin-camera-store';
/** v2：从「只存故事层」扩到四层（故事 / 地点 / 到访 / 媒体），因为导入会新建后三层 */
export const STORE_VERSION = 2;

/**
 * 存档结构校验。
 * 旧版本存档、手改过的 JSON、字段缺失都可能进来，这一层不合格就整体丢弃回退示例数据——
 * 宁可丢一次编辑，也不要让页面读到半截对象然后白屏。
 */
function isValidStory(value: unknown): value is Story {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<Story>;
  return (
    typeof s.id === 'string' &&
    typeof s.title === 'string' &&
    Array.isArray(s.mediaIds) &&
    Array.isArray(s.placeIds) &&
    typeof s.startAt === 'string' &&
    Number.isFinite(new Date(s.startAt).getTime())
  );
}

function isValidPlace(value: unknown): value is Place {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<Place>;
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    !!p.coordinate &&
    Number.isFinite(p.coordinate.latitude) &&
    Number.isFinite(p.coordinate.longitude) &&
    Array.isArray(p.mediaIds)
  );
}

function isValidVisit(value: unknown): value is Visit {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<Visit>;
  return (
    typeof v.id === 'string' &&
    typeof v.placeId === 'string' &&
    typeof v.startAt === 'string' &&
    typeof v.endAt === 'string' &&
    Number.isFinite(new Date(v.startAt).getTime()) &&
    Array.isArray(v.mediaIds)
  );
}

function isValidMedia(value: unknown): value is MediaAsset {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<MediaAsset>;
  return (
    typeof m.id === 'string' &&
    typeof m.uri === 'string' &&
    typeof m.capturedAt === 'string' &&
    typeof m.width === 'number' &&
    typeof m.height === 'number'
  );
}

/**
 * 合集 id：时间戳 + 自增序号。
 * 只用 Date.now() 不保险——同一毫秒内连续合并两次会生成同一个 id，
 * 新合集就会覆盖中间合集的 id，中间合集变成"指向自己的合集"，拆分还原不出来。
 */
let mergeSeq = 0;
function nextMergeId(stories: Story[]): string {
  let id = '';
  do {
    mergeSeq += 1;
    id = `s-merge-${Date.now().toString(36)}-${mergeSeq}`;
  } while (stories.some((s) => s.id === id));
  return id;
}

const createAppState: StateCreator<AppState & AppActions> = (set, get) => ({
  places: mockPlaces,
  visits: mockVisits,
  media: mockMedia,
  stories: mockStories,
  timeRange: initialRange,
  selectedPlaceId: null,
  selectedVisitId: null,
  lastMergedStoryId: null,
  mapFocus: null,
  storageIssue: { kind: 'none' },

  setSelectedTimeRange: (range) => set({ timeRange: range }),

  selectPlace: (placeId) => set({ selectedPlaceId: placeId, selectedVisitId: null }),

  selectVisit: (visitId) => set({ selectedVisitId: visitId }),

  updateStory: (storyId, patch) =>
    set((state) => ({
      stories: state.stories.map((s) =>
        s.id === storyId
          ? { ...s, ...patch, id: s.id, updatedAt: nowISO(), editedByUser: true }
          : s,
      ),
    })),

  setStoryTitle: (storyId, title) => {
    const next = normalizeTitle(title);
    if (!next) return;
    set((state) => ({
      stories: mapStory(state.stories, storyId, (s) => (s.title === next ? null : { title: next })),
    }));
  },

  setStoryCover: (storyId, mediaId) =>
    set((state) => ({
      stories: mapStory(state.stories, storyId, (s) => {
        // 封面必须来自本故事的媒体，否则会显示一张不属于这本故事的照片
        if (!s.mediaIds.includes(mediaId)) return null;
        if (s.coverMediaId === mediaId) return null;
        return { coverMediaId: mediaId };
      }),
    })),

  setStoryLayout: (storyId, layout) =>
    set((state) => ({
      stories: mapStory(state.stories, storyId, (s) => (s.layout === layout ? null : { layout })),
    })),

  setStoryCoverTitleMode: (storyId, mode) =>
    set((state) => ({
      stories: mapStory(state.stories, storyId, (s) =>
        s.coverTitleMode === mode ? null : { coverTitleMode: mode },
      ),
    })),

  setStoryText: (storyId, text) => {
    const next = text.trim();
    set((state) => ({
      stories: mapStory(state.stories, storyId, (s) => {
        if ((s.userText ?? '') === next) return null;
        return { userText: next.length > 0 ? next : undefined };
      }),
    }));
  },

  moveStoryMedia: (storyId, mediaId, direction) =>
    set((state) => ({
      stories: mapStory(state.stories, storyId, (s) => {
        const from = s.mediaIds.indexOf(mediaId);
        if (from < 0) return null;
        const to = from + direction;
        if (to < 0 || to >= s.mediaIds.length) return null;
        const next = [...s.mediaIds];
        next[from] = next[to];
        next[to] = mediaId;
        return { mediaIds: next };
      }),
    })),

  reorderStoryMedia: (storyId, orderedMediaIds) =>
    set((state) => ({
      stories: state.stories.map((s) => {
        if (s.id !== storyId) return s;
        // 只允许重排，不允许增删；集合不一致时直接忽略
        const sameSet =
          orderedMediaIds.length === s.mediaIds.length &&
          orderedMediaIds.every((id) => s.mediaIds.includes(id));
        if (!sameSet) return s;
        return { ...s, mediaIds: orderedMediaIds, updatedAt: nowISO(), editedByUser: true };
      }),
    })),

  toggleHighlightedMedia: (storyId, mediaId) =>
    set((state) => ({
      stories: state.stories.map((s) => {
        if (s.id !== storyId) return s;
        const has = s.highlightedMediaIds.includes(mediaId);
        return {
          ...s,
          highlightedMediaIds: has
            ? s.highlightedMediaIds.filter((id) => id !== mediaId)
            : [...s.highlightedMediaIds, mediaId],
          updatedAt: nowISO(),
          editedByUser: true,
        };
      }),
    })),

  mergeStories: (storyIds, title) => {
    const { stories, places } = get();
    const sources = stories.filter(
      (s) => storyIds.includes(s.id) && !s.isDeleted && !s.mergedIntoStoryId,
    );
    if (sources.length < 2) return null;

    const ordered = [...sources].sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );
    const id = nextMergeId(stories);
    const mediaIds = dedupe(ordered.flatMap((s) => s.mediaIds));

    const merged: Story = {
      id,
      // 空标题不接受：合集必须有可辨识标题，否则列表里会出现一张无字卡片
      title: normalizeTitle(title) ?? buildMergedTitle(ordered, places),
      placeIds: dedupe(ordered.flatMap((s) => s.placeIds)),
      visitIds: dedupe(ordered.flatMap((s) => s.visitIds)),
      mediaIds,
      coverMediaId: ordered[0].coverMediaId,
      startAt: ordered[0].startAt,
      endAt: ordered[ordered.length - 1].endAt,
      layout: 'editorial',
      highlightedMediaIds: dedupe(ordered.flatMap((s) => s.highlightedMediaIds)),
      isDeleted: false,
      coverTitleMode: 'below',
      mergedFromStoryIds: ordered.map((s) => s.id),
      // 存整棵子树（含源故事自身的 snapshot），拆分才能递归还原
      mergeSnapshot: ordered.map((s) => ({ ...s, mergedIntoStoryId: undefined })),
      updatedAt: nowISO(),
    };

    set({
      stories: [
        ...stories.map((s) =>
          storyIds.includes(s.id) && !s.isDeleted && !s.mergedIntoStoryId
            ? { ...s, mergedIntoStoryId: id }
            : s,
        ),
        merged,
      ],
      lastMergedStoryId: id,
    });
    return id;
  },

  splitStory: (storyId) => {
    const { stories } = get();
    const target = stories.find((s) => s.id === storyId);
    const snapshot = target?.mergeSnapshot;
    if (!target || !snapshot || snapshot.length === 0) return [];

    const restoredIds = snapshot.map((s) => s.id);
    const next = stories
      .filter((s) => s.id !== storyId)
      .map((s) => {
        const snap = snapshot.find((x) => x.id === s.id);
        if (snap) return { ...snap, mergedIntoStoryId: undefined };
        return s;
      });

    set({ stories: next, lastMergedStoryId: null });
    return restoredIds;
  },

  /**
   * 软删除故事。**不改媒体引用**——照片是否还显示由 `domain/visibility` 判定：
   * 只要还有一本没删的故事引用它，它就继续出现在地图和到访图库里。
   * 这是「删故事 → 照片跟着从地图/时间轴消失」的实现方式，不是把照片删掉。
   */
  deleteStory: (storyId) => {
    const state = get();
    const stories = state.stories.map((s) =>
      s.id === storyId
        ? // 手动删除是最终决定：清掉自动删除标记，之后恢复照片也不该复活这本
          { ...s, isDeleted: true, deletedByEmptying: false, updatedAt: nowISO() }
        : s,
    );
    set({
      stories,
      lastMergedStoryId: state.lastMergedStoryId === storyId ? null : state.lastMergedStoryId,
      // 这本独占的照片已经不可见了，时间轴要跟着收
      timeRange: withReconciledRange(state.timeRange, state.media, stories),
    });
  },

  restoreStory: (storyId) => {
    const state = get();
    const stories = state.stories.map((s) =>
      s.id === storyId
        ? // 手动恢复同样清标记：之后照片再被移空会重新自动删除，走同一条链
          { ...s, isDeleted: false, deletedByEmptying: false, updatedAt: nowISO() }
        : s,
    );
    set({
      stories,
      // 恢复照片展示之后，原来撑不到的范围要重新扩回来
      timeRange: withReconciledRange(state.timeRange, state.media, stories),
    });
  },

  removeMedia: (mediaIds) => {
    const state = get();
    const targets = new Set(
      state.media.filter((item) => mediaIds.includes(item.id) && !item.removedAt).map((i) => i.id),
    );
    // 一张都没命中就完全不写：避免一次无意义的全局通知
    if (targets.size === 0) return;
    const removedAt = nowISO();
    const media = state.media.map((item) =>
      targets.has(item.id) ? { ...item, removedAt } : item,
    );

    // 照片被移空的故事自动进「已删除」（用户确认的产品逻辑：图库里移空 → 故事跟着删）。
    // 只删「本来有照片、现在一张都看不见」的活跃故事；天生没照片的不碰。
    const probe = buildMediaVisibility(media, state.stories);
    const emptiedIds = new Set(
      state.stories
        .filter(
          (s) =>
            !s.isDeleted &&
            !s.mergedIntoStoryId &&
            s.mediaIds.length > 0 &&
            visibleCount(s.mediaIds, probe) === 0,
        )
        .map((s) => s.id),
    );
    const stories =
      emptiedIds.size > 0
        ? state.stories.map((s) =>
            emptiedIds.has(s.id)
              ? { ...s, isDeleted: true, deletedByEmptying: true, updatedAt: removedAt }
              : s,
          )
        : state.stories;

    set({
      media,
      stories,
      timeRange: withReconciledRange(state.timeRange, media, stories),
    });
  },

  restoreMedia: (mediaIds) => {
    const state = get();
    const targets = new Set(
      state.media.filter((item) => mediaIds.includes(item.id) && item.removedAt).map((i) => i.id),
    );
    if (targets.size === 0) return;
    const media = state.media.map((item) => {
      if (!targets.has(item.id)) return item;
      const next: MediaAsset = { ...item };
      delete next.removedAt;
      return next;
    });

    // 对称恢复：因移空而自动删除的故事，只要有照片重新可见就自动回来。
    // 可见性要用「候选故事暂时算活跃」的快照判——它们此刻还是 isDeleted，
    // 直接判会把自家照片全算成 story-deleted，永远活不过来。
    const candidates = state.stories.filter((s) => s.isDeleted && s.deletedByEmptying);
    let stories = state.stories;
    if (candidates.length > 0) {
      const probeStories = state.stories.map((s) =>
        s.isDeleted && s.deletedByEmptying ? { ...s, isDeleted: false } : s,
      );
      const probe = buildMediaVisibility(media, probeStories);
      const reviveIds = new Set(
        candidates.filter((s) => visibleCount(s.mediaIds, probe) > 0).map((s) => s.id),
      );
      if (reviveIds.size > 0) {
        stories = stories.map((s) =>
          reviveIds.has(s.id)
            ? { ...s, isDeleted: false, deletedByEmptying: false, updatedAt: nowISO() }
            : s,
        );
      }
    }

    set({
      media,
      stories,
      timeRange: withReconciledRange(state.timeRange, media, stories),
    });
  },

  resetToMock: () =>
    set({
      // 深拷贝：存档对象一旦和模块常量共享引用，后续 patch 会把示例数据一起改掉，
      // 表现是"重置之后看到的还是上次改过的标题"
      stories: JSON.parse(JSON.stringify(mockStories)) as Story[],
      // 导入产生的三层也要一起清掉，否则会留下没有故事引用的孤儿地点和照片
      places: JSON.parse(JSON.stringify(mockPlaces)) as Place[],
      visits: JSON.parse(JSON.stringify(mockVisits)) as Visit[],
      media: JSON.parse(JSON.stringify(mockMedia)) as MediaAsset[],
      timeRange: initialRange,
      selectedPlaceId: null,
      selectedVisitId: null,
      lastMergedStoryId: null,
      mapFocus: null,
      // 重置后存档是干净的；存储本身不可用则保持原样，别把这个问题也"重置"掉
      storageIssue: get().storageIssue.kind === 'unavailable' ? get().storageIssue : { kind: 'none' },
    }),

  patchMediaSources: (patches) => {
    if (patches.length === 0) return;
    const byId = new Map(patches.map((patch) => [patch.id, patch]));
    set({
      media: get().media.map((item) => {
        const patch = byId.get(item.id);
        if (!patch) return item;
        return {
          ...item,
          uri: patch.uri,
          // 缩略图生成失败时不覆盖成 null——留着 undefined 让显示层回落到新 uri
          thumbUri: patch.thumbUri ?? item.thumbUri ?? null,
        };
      }),
    });
  },

  clearMapFocus: () => set({ mapFocus: null }),

  importLibraryAssets: (candidates) => {
    const state = get();
    const plan = planLibraryImport(candidates, {
      places: state.places,
      visits: state.visits,
      media: state.media,
      stories: state.stories,
    });

    // 一张新的都没有（全部是已导入过的）就完全不写 store：
    // 否则会白白刷新一次全部订阅者，还会把 timeRange 之类的瞬态状态搅动一遍
    if (plan.newMedia.length === 0) return plan;

    const appendByVisit = new Map(plan.appends.map((item) => [item.visitId, item]));

    const visits = state.visits
      .map((visit) => {
        const append = appendByVisit.get(visit.id);
        if (!append) return visit;
        return {
          ...visit,
          mediaIds: dedupe([...visit.mediaIds, ...append.mediaIds]),
          endAt: append.endAt,
        };
      })
      .concat(plan.newVisits);

    // 追加只发生在「故事没被用户改过」的到访上（由规划层保证），
    // 所以这里直接补媒体，不动标题、封面、顺序
    const stories = state.stories
      .map((story) => {
        const append = plan.appends.find((item) => item.storyId === story.id);
        if (!append) return story;
        const host = visits.find((visit) => visit.id === append.visitId);
        return {
          ...story,
          mediaIds: dedupe([...story.mediaIds, ...append.mediaIds]),
          endAt: host?.endAt ?? story.endAt,
          updatedAt: nowISO(),
        };
      })
      .concat(plan.newStories);

    const media = state.media.concat(plan.newMedia);

    // 地点的 mediaIds / visitIds 是聚合字段，这里按底层数据重算，
    // 不靠规划层维护——两次导入之间最容易出的不一致就是这两列对不上
    const affected = new Set(plan.affectedPlaceIds);
    const places = state.places
      .concat(plan.newPlaces)
      .map((place) => {
        if (!affected.has(place.id)) return place;
        return {
          ...place,
          mediaIds: media.filter((item) => item.placeId === place.id).map((item) => item.id),
          visitIds: visits.filter((visit) => visit.placeId === place.id).map((visit) => visit.id),
        };
      });

    // 导入的照片可能落在当前时间窗口之外（示例数据 2026-10、真实照片可能是上个月）。
    // 不扩窗口的话，导入成功了却在地图和列表里都看不到，看起来像没导入。
    // 两步：先把窗口挪到新照片所在那天，再按新的有效照片范围收敛粒度。
    let timeRange = state.timeRange;
    const newestStory = plan.newStories.reduce<Story | null>((latest, story) => {
      if (!latest) return story;
      return new Date(story.startAt).getTime() > new Date(latest.startAt).getTime() ? story : latest;
    }, null);
    if (newestStory) {
      const start = new Date(timeRange.startAt).getTime();
      const end = new Date(timeRange.endAt).getTime();
      const target = new Date(newestStory.startAt).getTime();
      if (target < start || target > end) timeRange = makeRange('day', newestStory.startAt);
    }
    timeRange = withReconciledRange(timeRange, media, stories);

    // 有定位的才需要地图归位；全是未定位照片时不要瞎飞。
    // 不止「新建的地点」——往已有地点里追加照片同样要归位：
    // 导入可能顺带切换了时间窗口，视野若停在上个月，用户的照片就还在屏幕外。
    const focusPlace =
      plan.newPlaces.find((place) => !place.unlocated) ??
      plan.affectedPlaceIds
        .map((id) => places.find((place) => place.id === id))
        .find((place) => place !== undefined && place.unlocated !== true);

    set({
      stories,
      visits,
      media,
      places,
      timeRange,
      mapFocus: focusPlace
        ? {
            latitude: focusPlace.coordinate.latitude,
            longitude: focusPlace.coordinate.longitude,
            token: (state.mapFocus?.token ?? 0) + 1,
          }
        : state.mapFocus,
    });

    return plan;
  },
});

/**
 * AsyncStorage 的容错包装。
 * 万一运行环境里没有这个原生模块（换了宿主、Expo Go 版本不匹配），
 * 存取失败只降级成内存态，不能让启动流程抛错——原型不能因为存不了档就打不开。
 */
let storageWarned = false;
function warnStorageUnavailable(error: unknown) {
  if (storageWarned) return;
  storageWarned = true;
  console.warn('[store] 本地存储不可用，本次运行不保存编辑结果', error);
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : JSON.stringify(error);
}

/**
 * 存档健康状态的中转站。
 *
 * rehydrate 发生在 store 创建之后、React 订阅之前，`merge` 里又拿不到 `set`，
 * 所以先记在模块变量上，等 `onRehydrateStorage` 回来时一次性写进 state。
 */
let pendingIssue: StorageIssue = { kind: 'none' };
/** getItem 读到的原始文本，`merge` 发现结构不对时用它做隔离备份 */
let lastRawArchive: string | null = null;

const safeStorage: StateStorage = {
  getItem: async (name) => {
    try {
      const raw = await AsyncStorage.getItem(name);
      lastRawArchive = raw;
      if (raw === null) return null;
      // 先自己验一次 JSON 能不能解析。
      // 直接抛给 zustand 的话，它只会回退示例数据，而下一帧 persist 就会把这份坏存档覆盖掉，
      // 用户攒的标题/合并/删除记录就彻底没了。所以先抄一份到隔离区，再返回 null。
      try {
        JSON.parse(raw);
      } catch (error) {
        const bytes = await writeQuarantine(raw, name, `JSON 解析失败：${messageOf(error)}`);
        pendingIssue =
          bytes === null
            ? { kind: 'unavailable', detail: `存档损坏且备份失败：${messageOf(error)}` }
            : {
                kind: 'archive-invalid',
                detail: messageOf(error),
                bytes,
              };
        return null;
      }
      return raw;
    } catch (error) {
      warnStorageUnavailable(error);
      pendingIssue = { kind: 'unavailable', detail: messageOf(error) };
      return null;
    }
  },
  setItem: async (name, value) => {
    try {
      await AsyncStorage.setItem(name, value);
    } catch (error) {
      warnStorageUnavailable(error);
      pendingIssue = { kind: 'unavailable', detail: messageOf(error) };
    }
  },
  removeItem: async (name) => {
    try {
      await AsyncStorage.removeItem(name);
    } catch (error) {
      warnStorageUnavailable(error);
    }
  },
};

/**
 * 存档层。v2 存四层；`merge` 里逐层做结构校验。
 *
 * 有一条刻意保留的降级路径：v1 存档里没有 places / visits / media 字段（当时只存故事），
 * 这种存档按旧行为接受故事层，其余三层用示例数据补齐。
 * 但如果存档**声明了**这几层却一条都读不出来，就不接受——
 * 那说明存档坏了，用示例地点去配导入故事会得到一堆「未知地点」，比直接回退更糟。
 */
export const useAppStore = create<AppState & AppActions>()(
  persist(createAppState, {
    name: STORE_KEY,
    version: STORE_VERSION,
    storage: createJSONStorage(() => safeStorage),
    partialize: (state) => ({
      stories: state.stories,
      places: state.places,
      visits: state.visits,
      media: state.media,
    }),
    merge: (persisted, current) => {
      const archive = persisted as
        | { stories?: unknown; places?: unknown; visits?: unknown; media?: unknown }
        | undefined;
      const stories = Array.isArray(archive?.stories)
        ? archive.stories.filter(isValidStory)
        : [];
      // 一条都留不下就当存档不可用：空相册比丢一次编辑更糟，直接回示例数据
      if (stories.length > 0) {
        const hasLayerFields =
          archive?.places !== undefined || archive?.visits !== undefined || archive?.media !== undefined;
        const places = Array.isArray(archive?.places) ? archive.places.filter(isValidPlace) : [];
        const visits = Array.isArray(archive?.visits) ? archive.visits.filter(isValidVisit) : [];
        const media = Array.isArray(archive?.media) ? archive.media.filter(isValidMedia) : [];

        if (!hasLayerFields) {
          // v1 存档：只有故事层，按旧行为补齐其余三层
          return { ...current, stories };
        }
        if (places.length === 0 || media.length === 0) {
          const raw = lastRawArchive ?? JSON.stringify(archive);
          pendingIssue = {
            kind: 'archive-empty',
            detail: `存档里地点 ${places.length} 条、媒体 ${media.length} 条，无法与故事配套`,
            bytes: raw.length,
          };
          void writeQuarantine(raw, STORE_KEY, '存档结构校验未通过');
          return current;
        }
        return { ...current, stories, places, visits, media };
      }

      // 存档确实在、确实有记录，但一条都没通过校验：这不是"没有存档"，是"存档坏了"。
      // 原样备份一份再回示例数据，否则下一次写入就把它盖掉了。
      if (Array.isArray(archive?.stories) && archive.stories.length > 0) {
        const raw = lastRawArchive ?? JSON.stringify(archive);
        pendingIssue = {
          kind: 'archive-empty',
          detail: `存档里 ${archive.stories.length} 条故事无一通过结构校验`,
          bytes: raw.length,
        };
        void writeQuarantine(raw, STORE_KEY, '存档结构校验未通过');
      }
      return current;
    },
    migrate: (persisted, version) => {
      // v1（以及没有 version 字段的更早存档）只存故事层，结构一致，直接接受
      if (version < 2) {
        const archive = persisted as { stories?: unknown } | undefined;
        return Array.isArray(archive?.stories) ? { stories: archive.stories } : {};
      }
      return persisted as Partial<AppState & AppActions>;
    },
    onRehydrateStorage: () => (_state, error) => {
      if (error) {
        console.warn('[store] 读取本地存档失败，本次回到示例数据', error);
        // JSON 解析失败在 getItem 里已经定性并备份过了，这里只兜底它没覆盖到的异常
        if (pendingIssue.kind === 'none') {
          pendingIssue = { kind: 'unavailable', detail: messageOf(error) };
        }
      }
      if (pendingIssue.kind !== 'none') {
        useAppStore.setState({ storageIssue: pendingIssue });
      }
    },
  }),
);

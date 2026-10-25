import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type { StateCreator } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';

import { mockMedia, mockPlaces, mockStories, mockVisits } from '@/src/data';
import { makeMonthRange } from '@/src/domain/timeline';
import type {
  CoverTitleMode,
  MediaAsset,
  Place,
  Story,
  StoryLayout,
  TimeRange,
  Visit,
} from '@/src/domain/types';
import { formatDay } from '@/src/utils/datetime';

/**
 * 全局唯一 store（规格 §8）。
 * 地图页和故事页都必须从这里读，不允许各自维护副本。
 *
 * 持久化策略（v1）：**只持久化 `stories`**。
 * 用户在原型里能改的只有故事这一层——编辑、合并、拆分、删除、恢复全落在 `Story` 上；
 * `places` / `visits` / `media` 是示例数据派生的，每次都从 mock 重建。
 * 这样做的直接好处是：换素材、改 mock 结构不会和旧存档打架，也不会因为
 * 存了 `mock:<slug>` 键而在素材改名后出现空图。接真实相册后再把三层一起存。
 *
 * 没进 `partialize` 的字段（`timeRange` / 选中项 / `lastMergedStoryId`）都是瞬态 UI 状态，
 * 重启回到「最近一次回忆所在月份」比恢复上次拖到的位置更符合预期。
 */

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
  /** 丢掉本地存档，回到示例数据（设置页用） */
  resetToMock: () => void;
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
    // id 永远不允许被 patch 覆盖
    return { ...s, ...patch, id: s.id, updatedAt: nowISO() };
  });
  return changed ? next : stories;
}

/** 标题规范化：折叠连续空白；规范化后为空则视为无效（不允许无标题卡片） */
function normalizeTitle(raw: string): string | null {
  const next = raw.replace(/\s+/g, ' ').trim();
  return next.length > 0 ? next : null;
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
export const STORE_VERSION = 1;

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

  setSelectedTimeRange: (range) => set({ timeRange: range }),

  selectPlace: (placeId) => set({ selectedPlaceId: placeId, selectedVisitId: null }),

  selectVisit: (visitId) => set({ selectedVisitId: visitId }),

  updateStory: (storyId, patch) =>
    set((state) => ({
      stories: state.stories.map((s) =>
        s.id === storyId ? { ...s, ...patch, id: s.id, updatedAt: nowISO() } : s,
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
        return { ...s, mediaIds: orderedMediaIds, updatedAt: nowISO() };
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

  deleteStory: (storyId) =>
    set((state) => ({
      stories: state.stories.map((s) =>
        s.id === storyId ? { ...s, isDeleted: true, updatedAt: nowISO() } : s,
      ),
      lastMergedStoryId: state.lastMergedStoryId === storyId ? null : state.lastMergedStoryId,
    })),

  restoreStory: (storyId) =>
    set((state) => ({
      stories: state.stories.map((s) =>
        s.id === storyId ? { ...s, isDeleted: false, updatedAt: nowISO() } : s,
      ),
    })),

  resetToMock: () =>
    set({
      // 深拷贝：存档对象一旦和模块常量共享引用，后续 patch 会把示例数据一起改掉，
      // 表现是"重置之后看到的还是上次改过的标题"
      stories: JSON.parse(JSON.stringify(mockStories)) as Story[],
      timeRange: initialRange,
      selectedPlaceId: null,
      selectedVisitId: null,
      lastMergedStoryId: null,
    }),
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

const safeStorage: StateStorage = {
  getItem: async (name) => {
    try {
      return await AsyncStorage.getItem(name);
    } catch (error) {
      warnStorageUnavailable(error);
      return null;
    }
  },
  setItem: async (name, value) => {
    try {
      await AsyncStorage.setItem(name, value);
    } catch (error) {
      warnStorageUnavailable(error);
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
 * 存档层。只写 `stories`（原因见文件头），其余字段在 rehydrate 时由初始值补齐。
 * `merge` 里做结构校验，存档不合格就整体回退示例数据。
 */
export const useAppStore = create<AppState & AppActions>()(
  persist(createAppState, {
    name: STORE_KEY,
    version: STORE_VERSION,
    storage: createJSONStorage(() => safeStorage),
    partialize: (state) => ({ stories: state.stories }),
    merge: (persisted, current) => {
      const archive = persisted as { stories?: unknown } | undefined;
      const stories = Array.isArray(archive?.stories)
        ? archive.stories.filter(isValidStory)
        : [];
      // 一条都留不下就当存档不可用：空相册比丢一次编辑更糟，直接回示例数据
      return stories.length > 0 ? { ...current, stories } : current;
    },
    migrate: (persisted, version) => {
      // v1 是第一个带版本号的存档；更早的没有 version 字段，结构一致，直接接受
      if (version < 1) {
        const archive = persisted as { stories?: unknown } | undefined;
        return Array.isArray(archive?.stories) ? { stories: archive.stories } : {};
      }
      return persisted as Partial<AppState & AppActions>;
    },
    onRehydrateStorage: () => (_state, error) => {
      if (error) {
        console.warn('[store] 读取本地存档失败，本次回到示例数据', error);
      }
    },
  }),
);

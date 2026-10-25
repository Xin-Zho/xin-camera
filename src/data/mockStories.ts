import type { Story } from '@/src/domain/types';

/**
 * 示例故事。
 *
 * 生成规则见规格 §7.2：**一次到访 = 一本故事**，不按地点聚合。
 * 这里刻意做了三种状态，供 UI 与验收检查：
 *   1. 深圳湾公园三次到访 → 三本独立故事（s-bay-*）
 *   2. 西安两本已被合并成 s-xian-merge，原两本用 mergedIntoStoryId 隐藏
 *      （不是删除，拆分时按 mergedFromStoryIds / mergeSnapshot 还原）
 *   3. 大鹏所城被删除（isDeleted），用来验证"删除后不自动重建"
 */

const xian0503Original: Story = {
  id: 's-xian-0503',
  title: '西安钟楼 · 5月3日',
  placeIds: ['p-xa-bell'],
  visitIds: ['v-bell-0503'],
  mediaIds: ['m-bell-1', 'm-bell-2'],
  coverMediaId: 'm-bell-1',
  startAt: '2026-05-03T20:10:00+08:00',
  endAt: '2026-05-03T21:40:00+08:00',
  layout: 'editorial',
  highlightedMediaIds: ['m-bell-1'],
  isDeleted: false,
  coverTitleMode: 'overlay',
  updatedAt: '2026-05-04T09:00:00+08:00',
};

const xian0504Original: Story = {
  id: 's-xian-0504',
  title: '陕西历史博物馆 · 5月4日',
  placeIds: ['p-xa-museum'],
  visitIds: ['v-museum-0504'],
  mediaIds: ['m-museum-1', 'm-museum-2'],
  coverMediaId: 'm-museum-1',
  startAt: '2026-05-04T09:30:00+08:00',
  endAt: '2026-05-04T12:10:00+08:00',
  layout: 'large-cover',
  highlightedMediaIds: ['m-museum-2'],
  isDeleted: false,
  coverTitleMode: 'below',
  updatedAt: '2026-05-04T13:00:00+08:00',
};

export const mockStories: Story[] = [
  // —— 深圳湾公园，三次到访 = 三本
  {
    id: 's-bay-1012',
    title: '深圳湾公园 · 10月12日',
    placeIds: ['p-sz-bay'],
    visitIds: ['v-bay-1012'],
    mediaIds: ['m-bay-a1', 'm-bay-a2', 'm-bay-a3', 'm-bay-a4'],
    coverMediaId: 'm-bay-a1',
    startAt: '2026-10-12T17:30:00+08:00',
    endAt: '2026-10-12T19:10:00+08:00',
    layout: 'editorial',
    highlightedMediaIds: ['m-bay-a1'],
    isDeleted: false,
    coverTitleMode: 'overlay',
    updatedAt: '2026-10-12T21:00:00+08:00',
  },
  {
    id: 's-bay-0928',
    title: '深圳湾公园 · 9月28日',
    placeIds: ['p-sz-bay'],
    visitIds: ['v-bay-0928'],
    mediaIds: ['m-bay-b1', 'm-bay-b2', 'm-bay-b3'],
    coverMediaId: 'm-bay-b2',
    startAt: '2026-09-28T06:40:00+08:00',
    endAt: '2026-09-28T08:05:00+08:00',
    layout: 'large-cover',
    highlightedMediaIds: ['m-bay-b2'],
    isDeleted: false,
    coverTitleMode: 'below',
    updatedAt: '2026-09-28T10:00:00+08:00',
  },
  {
    id: 's-bay-0615',
    title: '深圳湾公园 · 6月15日',
    placeIds: ['p-sz-bay'],
    visitIds: ['v-bay-0615'],
    mediaIds: ['m-bay-c1', 'm-bay-c2', 'm-bay-c3'],
    coverMediaId: 'm-bay-c1',
    startAt: '2026-06-15T19:20:00+08:00',
    endAt: '2026-06-15T21:00:00+08:00',
    layout: 'editorial',
    highlightedMediaIds: [],
    isDeleted: false,
    coverTitleMode: 'overlay',
    updatedAt: '2026-06-15T22:30:00+08:00',
  },

  // —— 咖啡店，同日另一地点，验证"同日多本"的并列展示
  {
    id: 's-cafe-1012',
    title: '山池咖啡 · 10月12日 上午',
    placeIds: ['p-sz-cafe'],
    visitIds: ['v-cafe-1012'],
    mediaIds: ['m-cafe-1', 'm-cafe-2', 'm-cafe-3'],
    coverMediaId: 'm-cafe-2',
    startAt: '2026-10-12T10:00:00+08:00',
    endAt: '2026-10-12T11:30:00+08:00',
    layout: 'grid',
    highlightedMediaIds: ['m-cafe-2'],
    isDeleted: false,
    coverTitleMode: 'below',
    updatedAt: '2026-10-12T12:00:00+08:00',
  },

  // —— 同楼里的第二本：地点与咖啡店几乎同坐标，用来验证"聚合后仍重叠 → 地点列表"
  {
    id: 's-book-1012',
    title: '旧天堂书店 · 10月12日 中午',
    placeIds: ['p-sz-book'],
    visitIds: ['v-book-1012'],
    mediaIds: ['m-book-1', 'm-book-2'],
    coverMediaId: 'm-book-1',
    startAt: '2026-10-12T11:40:00+08:00',
    endAt: '2026-10-12T12:30:00+08:00',
    layout: 'large-cover',
    highlightedMediaIds: ['m-book-1'],
    isDeleted: false,
    coverTitleMode: 'overlay',
    updatedAt: '2026-10-12T13:00:00+08:00',
  },

  // —— 被合并的合集（原两本通过 mergedIntoStoryId 隐藏）
  {
    id: 's-xian-merge',
    title: '西安两日',
    placeIds: ['p-xa-bell', 'p-xa-museum'],
    visitIds: ['v-bell-0503', 'v-museum-0504'],
    mediaIds: ['m-museum-2', 'm-bell-1', 'm-bell-2', 'm-museum-1'],
    coverMediaId: 'm-museum-2',
    startAt: '2026-05-03T20:10:00+08:00',
    endAt: '2026-05-04T12:10:00+08:00',
    layout: 'editorial',
    highlightedMediaIds: ['m-bell-1', 'm-museum-2'],
    userText: '两天，一座城。夜里看钟楼，早上进博物馆——顺序颠倒得刚刚好。',
    isDeleted: false,
    coverTitleMode: 'below',
    mergedFromStoryIds: ['s-xian-0503', 's-xian-0504'],
    mergeSnapshot: [xian0503Original, xian0504Original],
    updatedAt: '2026-10-20T20:00:00+08:00',
  },
  {
    ...xian0503Original,
    mergedIntoStoryId: 's-xian-merge',
  },
  {
    ...xian0504Original,
    mergedIntoStoryId: 's-xian-merge',
  },

  // —— 香港
  {
    id: 's-hk-0211',
    title: '尖沙咀海旁 · 2月11日',
    placeIds: ['p-hk-tst'],
    visitIds: ['v-hk-0211'],
    mediaIds: ['m-hk-1', 'm-hk-2', 'm-hk-3'],
    coverMediaId: 'm-hk-1',
    startAt: '2026-02-11T18:00:00+08:00',
    endAt: '2026-02-11T19:30:00+08:00',
    layout: 'large-cover',
    highlightedMediaIds: ['m-hk-1'],
    isDeleted: false,
    coverTitleMode: 'overlay',
    updatedAt: '2026-02-12T10:00:00+08:00',
  },

  // —— 已删除：验证"删了不会自动重建"，且底层地点/到访/媒体仍在
  {
    id: 's-dapeng-2511',
    title: '大鹏所城 · 11月22日',
    placeIds: ['p-sz-dapeng'],
    visitIds: ['v-dapeng-2511'],
    mediaIds: ['m-dapeng-1', 'm-dapeng-2'],
    coverMediaId: 'm-dapeng-1',
    startAt: '2025-11-22T14:00:00+08:00',
    endAt: '2025-11-22T16:30:00+08:00',
    layout: 'editorial',
    highlightedMediaIds: [],
    isDeleted: true,
    coverTitleMode: 'below',
    updatedAt: '2026-03-01T09:00:00+08:00',
  },
];

export const mockStoriesById = new Map(mockStories.map((s) => [s.id, s]));

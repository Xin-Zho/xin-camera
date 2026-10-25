import type { MediaAsset } from '@/src/domain/types';

/**
 * 示例媒体数据。
 * 时间全部落在对应 Visit 区间内，代表照片取各自到访里最有辨识度的一张。
 * 不复制真实媒体文件，只做引用（规格 §7.1）。
 */
export const mockMedia: MediaAsset[] = [
  // —— 深圳湾公园 · 2026-10-12 傍晚到访
  {
    id: 'm-bay-a1',
    uri: 'mock:bay-a1',
    kind: 'photo',
    capturedAt: '2026-10-12T17:32:00+08:00',
    placeId: 'p-sz-bay',
    visitId: 'v-bay-1012',
    width: 1200,
    height: 900,
  },
  {
    id: 'm-bay-a2',
    uri: 'mock:bay-a2',
    kind: 'video',
    capturedAt: '2026-10-12T17:58:00+08:00',
    placeId: 'p-sz-bay',
    visitId: 'v-bay-1012',
    width: 900,
    height: 1200,
  },
  {
    id: 'm-bay-a3',
    uri: 'mock:bay-a3',
    kind: 'photo',
    capturedAt: '2026-10-12T18:36:00+08:00',
    placeId: 'p-sz-bay',
    visitId: 'v-bay-1012',
    width: 1200,
    height: 900,
  },
  {
    id: 'm-bay-a4',
    uri: 'mock:bay-a4',
    kind: 'photo',
    capturedAt: '2026-10-12T19:02:00+08:00',
    placeId: 'p-sz-bay',
    visitId: 'v-bay-1012',
    width: 1200,
    height: 900,
  },

  // —— 深圳湾公园 · 2026-09-28 清晨到访
  {
    id: 'm-bay-b1',
    uri: 'mock:bay-b1',
    kind: 'photo',
    capturedAt: '2026-09-28T06:44:00+08:00',
    placeId: 'p-sz-bay',
    visitId: 'v-bay-0928',
    width: 1200,
    height: 900,
  },
  {
    id: 'm-bay-b2',
    uri: 'mock:bay-b2',
    kind: 'photo',
    capturedAt: '2026-09-28T07:12:00+08:00',
    placeId: 'p-sz-bay',
    visitId: 'v-bay-0928',
    width: 900,
    height: 1200,
  },
  {
    id: 'm-bay-b3',
    uri: 'mock:bay-b3',
    kind: 'photo',
    capturedAt: '2026-09-28T07:48:00+08:00',
    placeId: 'p-sz-bay',
    visitId: 'v-bay-0928',
    width: 1200,
    height: 900,
  },

  // —— 深圳湾公园 · 2026-06-15 晚上到访
  {
    id: 'm-bay-c1',
    uri: 'mock:bay-c1',
    kind: 'photo',
    capturedAt: '2026-06-15T19:24:00+08:00',
    placeId: 'p-sz-bay',
    visitId: 'v-bay-0615',
    width: 1200,
    height: 900,
  },
  {
    id: 'm-bay-c2',
    uri: 'mock:bay-c2',
    kind: 'photo',
    capturedAt: '2026-06-15T20:05:00+08:00',
    placeId: 'p-sz-bay',
    visitId: 'v-bay-0615',
    width: 900,
    height: 1200,
  },
  {
    id: 'm-bay-c3',
    uri: 'mock:bay-c3',
    kind: 'photo',
    capturedAt: '2026-06-15T20:41:00+08:00',
    placeId: 'p-sz-bay',
    visitId: 'v-bay-0615',
    width: 1200,
    height: 900,
  },

  // —— 山池咖啡 · 2026-10-12 上午到访
  {
    id: 'm-cafe-1',
    uri: 'mock:cafe-1',
    kind: 'photo',
    capturedAt: '2026-10-12T10:06:00+08:00',
    placeId: 'p-sz-cafe',
    visitId: 'v-cafe-1012',
    width: 1200,
    height: 900,
  },
  {
    id: 'm-cafe-2',
    uri: 'mock:cafe-2',
    kind: 'photo',
    capturedAt: '2026-10-12T10:33:00+08:00',
    placeId: 'p-sz-cafe',
    visitId: 'v-cafe-1012',
    width: 900,
    height: 1200,
  },
  {
    id: 'm-cafe-3',
    uri: 'mock:cafe-3',
    kind: 'photo',
    capturedAt: '2026-10-12T11:02:00+08:00',
    placeId: 'p-sz-cafe',
    visitId: 'v-cafe-1012',
    width: 1200,
    height: 900,
  },

  // —— 西安钟楼 · 2026-05-03 晚上到访
  {
    id: 'm-bell-1',
    uri: 'mock:bell-1',
    kind: 'video',
    capturedAt: '2026-05-03T20:18:00+08:00',
    placeId: 'p-xa-bell',
    visitId: 'v-bell-0503',
    width: 900,
    height: 1200,
  },
  {
    id: 'm-bell-2',
    uri: 'mock:bell-2',
    kind: 'photo',
    capturedAt: '2026-05-03T21:05:00+08:00',
    placeId: 'p-xa-bell',
    visitId: 'v-bell-0503',
    width: 1200,
    height: 900,
  },

  // —— 陕西历史博物馆 · 2026-05-04 上午到访
  {
    id: 'm-museum-1',
    uri: 'mock:museum-1',
    kind: 'photo',
    capturedAt: '2026-05-04T09:44:00+08:00',
    placeId: 'p-xa-museum',
    visitId: 'v-museum-0504',
    width: 900,
    height: 1200,
  },
  {
    id: 'm-museum-2',
    uri: 'mock:museum-2',
    kind: 'photo',
    capturedAt: '2026-05-04T11:20:00+08:00',
    placeId: 'p-xa-museum',
    visitId: 'v-museum-0504',
    width: 1200,
    height: 900,
  },

  // —— 香港尖沙咀海旁 · 2026-02-11 傍晚到访
  {
    id: 'm-hk-1',
    uri: 'mock:hk-1',
    kind: 'photo',
    capturedAt: '2026-02-11T18:08:00+08:00',
    placeId: 'p-hk-tst',
    visitId: 'v-hk-0211',
    width: 1200,
    height: 900,
  },
  {
    id: 'm-hk-2',
    uri: 'mock:hk-2',
    kind: 'video',
    capturedAt: '2026-02-11T18:30:00+08:00',
    placeId: 'p-hk-tst',
    visitId: 'v-hk-0211',
    width: 900,
    height: 1200,
  },
  {
    id: 'm-hk-3',
    uri: 'mock:hk-3',
    kind: 'photo',
    capturedAt: '2026-02-11T19:12:00+08:00',
    placeId: 'p-hk-tst',
    visitId: 'v-hk-0211',
    width: 900,
    height: 1200,
  },

  // —— 大鹏所城 · 2025-11-22 下午到访
  {
    id: 'm-dapeng-1',
    uri: 'mock:dapeng-1',
    kind: 'photo',
    capturedAt: '2025-11-22T14:20:00+08:00',
    placeId: 'p-sz-dapeng',
    visitId: 'v-dapeng-2511',
    width: 1200,
    height: 900,
  },
  {
    id: 'm-dapeng-2',
    uri: 'mock:dapeng-2',
    kind: 'photo',
    capturedAt: '2025-11-22T15:40:00+08:00',
    placeId: 'p-sz-dapeng',
    visitId: 'v-dapeng-2511',
    width: 900,
    height: 1200,
  },

  // —— 书店：与山池咖啡在同一栋楼里，两点相距几米。
  //    这是聚合的边界用例：无论放大到多少，两个标记都分不开 → 点聚合应给出地点列表。
  {
    id: 'm-book-1',
    uri: 'mock:book-1',
    kind: 'photo',
    capturedAt: '2026-10-12T11:45:00+08:00',
    placeId: 'p-sz-book',
    visitId: 'v-book-1012',
    width: 1200,
    height: 900,
  },
  {
    id: 'm-book-2',
    uri: 'mock:book-2',
    kind: 'photo',
    capturedAt: '2026-10-12T12:10:00+08:00',
    placeId: 'p-sz-book',
    visitId: 'v-book-1012',
    width: 900,
    height: 1200,
  },
];

export const mockMediaById = new Map(mockMedia.map((m) => [m.id, m]));

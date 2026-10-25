import type { Visit } from '@/src/domain/types';

/**
 * 示例到访。
 * 关键点：同一个地点（深圳湾公园）有 3 次到访 → 会各自生成一本故事（规格 §7.2）。
 * visit 之间的时间间隔远超 4 小时的待定阈值，所以分组不会被阈值争议影响。
 */
export const mockVisits: Visit[] = [
  {
    id: 'v-bay-1012',
    placeId: 'p-sz-bay',
    startAt: '2026-10-12T17:30:00+08:00',
    endAt: '2026-10-12T19:10:00+08:00',
    mediaIds: ['m-bay-a1', 'm-bay-a2', 'm-bay-a3', 'm-bay-a4'],
    coverMediaId: 'm-bay-a1',
  },
  {
    id: 'v-bay-0928',
    placeId: 'p-sz-bay',
    startAt: '2026-09-28T06:40:00+08:00',
    endAt: '2026-09-28T08:05:00+08:00',
    mediaIds: ['m-bay-b1', 'm-bay-b2', 'm-bay-b3'],
    coverMediaId: 'm-bay-b2',
  },
  {
    id: 'v-bay-0615',
    placeId: 'p-sz-bay',
    startAt: '2026-06-15T19:20:00+08:00',
    endAt: '2026-06-15T21:00:00+08:00',
    mediaIds: ['m-bay-c1', 'm-bay-c2', 'm-bay-c3'],
    coverMediaId: 'm-bay-c1',
  },
  {
    id: 'v-cafe-1012',
    placeId: 'p-sz-cafe',
    startAt: '2026-10-12T10:00:00+08:00',
    endAt: '2026-10-12T11:30:00+08:00',
    mediaIds: ['m-cafe-1', 'm-cafe-2', 'm-cafe-3'],
    coverMediaId: 'm-cafe-2',
  },
  {
    id: 'v-book-1012',
    placeId: 'p-sz-book',
    startAt: '2026-10-12T11:40:00+08:00',
    endAt: '2026-10-12T12:30:00+08:00',
    mediaIds: ['m-book-1', 'm-book-2'],
    coverMediaId: 'm-book-1',
  },
  {
    id: 'v-bell-0503',
    placeId: 'p-xa-bell',
    startAt: '2026-05-03T20:10:00+08:00',
    endAt: '2026-05-03T21:40:00+08:00',
    mediaIds: ['m-bell-1', 'm-bell-2'],
    coverMediaId: 'm-bell-1',
  },
  {
    id: 'v-museum-0504',
    placeId: 'p-xa-museum',
    startAt: '2026-05-04T09:30:00+08:00',
    endAt: '2026-05-04T12:10:00+08:00',
    mediaIds: ['m-museum-1', 'm-museum-2'],
    coverMediaId: 'm-museum-1',
  },
  {
    id: 'v-hk-0211',
    placeId: 'p-hk-tst',
    startAt: '2026-02-11T18:00:00+08:00',
    endAt: '2026-02-11T19:30:00+08:00',
    mediaIds: ['m-hk-1', 'm-hk-2', 'm-hk-3'],
    coverMediaId: 'm-hk-1',
  },
  {
    id: 'v-dapeng-2511',
    placeId: 'p-sz-dapeng',
    startAt: '2025-11-22T14:00:00+08:00',
    endAt: '2025-11-22T16:30:00+08:00',
    mediaIds: ['m-dapeng-1', 'm-dapeng-2'],
    coverMediaId: 'm-dapeng-1',
  },
];

export const mockVisitsById = new Map(mockVisits.map((v) => [v.id, v]));

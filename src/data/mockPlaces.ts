import type { Place } from '@/src/domain/types';

/**
 * 示例地点：跨 3 座城市，其中深圳湾公园有 3 次到访（用于验证
 * "同地点多次到访 → 多本故事"，规格 §7.2）。
 * 地图标记基于 Place，所以这里每个 id 只会出现一个标记。
 */
export const mockPlaces: Place[] = [
  {
    id: 'p-sz-bay',
    name: '深圳湾公园',
    coordinate: { latitude: 22.5181, longitude: 113.9456 },
    category: '海滨公园',
    city: '深圳',
    mediaIds: [
      'm-bay-a1',
      'm-bay-a2',
      'm-bay-a3',
      'm-bay-a4',
      'm-bay-b1',
      'm-bay-b2',
      'm-bay-b3',
      'm-bay-c1',
      'm-bay-c2',
      'm-bay-c3',
    ],
    visitIds: ['v-bay-1012', 'v-bay-0928', 'v-bay-0615'],
  },
  {
    id: 'p-sz-cafe',
    name: '山池咖啡',
    coordinate: { latitude: 22.5394, longitude: 113.9298 },
    category: '咖啡店',
    city: '深圳',
    mediaIds: ['m-cafe-1', 'm-cafe-2', 'm-cafe-3'],
    visitIds: ['v-cafe-1012'],
  },
  {
    id: 'p-sz-book',
    name: '旧天堂书店',
    // 与山池咖啡在同一栋楼，相距约 2 米：
    // 聚合的"分不开"边界用例，点聚合标记应退回地点列表（规格 §5.3）
    coordinate: { latitude: 22.53942, longitude: 113.92982 },
    category: '书店',
    city: '深圳',
    mediaIds: ['m-book-1', 'm-book-2'],
    visitIds: ['v-book-1012'],
  },
  {
    id: 'p-sz-dapeng',
    name: '大鹏所城',
    coordinate: { latitude: 22.5931, longitude: 114.4941 },
    category: '古城',
    city: '深圳',
    mediaIds: ['m-dapeng-1', 'm-dapeng-2'],
    visitIds: ['v-dapeng-2511'],
  },
  {
    id: 'p-xa-bell',
    name: '西安钟楼',
    coordinate: { latitude: 34.2612, longitude: 108.9452 },
    category: '地标',
    city: '西安',
    mediaIds: ['m-bell-1', 'm-bell-2'],
    visitIds: ['v-bell-0503'],
  },
  {
    id: 'p-xa-museum',
    name: '陕西历史博物馆',
    coordinate: { latitude: 34.2221, longitude: 108.9531 },
    category: '博物馆',
    city: '西安',
    mediaIds: ['m-museum-1', 'm-museum-2'],
    visitIds: ['v-museum-0504'],
  },
  {
    id: 'p-hk-tst',
    name: '尖沙咀海旁',
    coordinate: { latitude: 22.2931, longitude: 114.1721 },
    category: '海滨',
    city: '香港',
    mediaIds: ['m-hk-1', 'm-hk-2', 'm-hk-3'],
    visitIds: ['v-hk-0211'],
  },
];

export const mockPlacesById = new Map(mockPlaces.map((p) => [p.id, p]));

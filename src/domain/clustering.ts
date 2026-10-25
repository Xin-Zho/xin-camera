/**
 * 地图标记聚合（规格 §5.3）。
 *
 * 设计要点：
 *  - 聚合判据是**屏幕上两个标记的距离**，不是经纬度阈值。所以放大到一定程度
 *    自然就散开了，不需要额外维护"缩放级别"这种状态。
 *  - 纯函数，不碰 React、不碰 store，可以直接在 Node 里验证。
 *  - 聚合结果只是"渲染建议"，不改任何数据；地图标记仍然基于 Place。
 */
import type { MediaAsset, PlaceSummary } from '@/src/domain/types';

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** 聚合标记的三种时段状态，对应"当前时段有没有照片" */
export type ClusterDimState = 'active' | 'partial' | 'none';

export interface MapCluster {
  /** 成员 placeId 排序后拼接，作为稳定身份：成员不变，id 就不变 */
  id: string;
  coordinate: { latitude: number; longitude: number };
  members: PlaceSummary[];
  placeCount: number;
  /** 成员在当前时段内的到访总数 */
  visitCountInRange: number;
  dimState: ClusterDimState;
  coverMedia?: MediaAsset;
}

/** 两个标记在屏幕上小于这个距离就并成一个 */
export const CLUSTER_RADIUS_PX = 52;

/**
 * 点击聚合标记后放大的最小范围。
 * 0.004 约 440 米高：比这更近的时候，相距 200 米以上的两个地点一定能分开。
 */
export const MIN_REGION_DELTA = 0.004;

/** 放大后成员最多占视口的比例，留出余量避免贴着屏幕边 */
export const CLUSTER_VIEWPORT_RATIO = 0.62;

const EPS_COORD = 1e-6;

/**
 * 经纬度 → 屏幕像素。
 * 用线性映射（与 react-native-maps 在区域较小时的表现一致），
 * 把 region 的中心对齐到视口中心。
 */
export function projectToScreen(
  coordinate: { latitude: number; longitude: number },
  region: MapRegion,
  viewport: Viewport,
): { x: number; y: number } {
  const latDelta = region.latitudeDelta || 1e-9;
  const lngDelta = region.longitudeDelta || 1e-9;
  return {
    x: ((coordinate.longitude - (region.longitude - lngDelta / 2)) / lngDelta) * viewport.width,
    y: ((region.latitude + latDelta / 2 - coordinate.latitude) / latDelta) * viewport.height,
  };
}

/** 两个地点在屏幕上的像素距离（同一 region 下进行平移不变） */
export function screenDistance(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
  region: MapRegion,
  viewport: Viewport,
): number {
  const pa = projectToScreen(a, region, viewport);
  const pb = projectToScreen(b, region, viewport);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

function dimStateOf(members: PlaceSummary[]): ClusterDimState {
  const withPhotos = members.filter((m) => m.visitCountInRange > 0).length;
  if (withPhotos === 0) return 'none';
  if (withPhotos === members.length) return 'active';
  return 'partial';
}

function buildCluster(members: PlaceSummary[]): MapCluster {
  const sorted = [...members].sort((a, b) =>
    a.place.id < b.place.id ? -1 : a.place.id > b.place.id ? 1 : 0,
  );
  const id = sorted.map((m) => m.place.id).join('|');

  // 单个地点直接用它的真实坐标，不要因为居中计算产生偏移
  let coordinate = { ...sorted[0].place.coordinate };
  if (sorted.length > 1) {
    // 以"当前时段照片数 + 1"为权重，让有内容的那个地点把聚合标记拉近自己
    let weightSum = 0;
    let latSum = 0;
    let lngSum = 0;
    sorted.forEach((m) => {
      const w = m.visitCountInRange + 1;
      weightSum += w;
      latSum += m.place.coordinate.latitude * w;
      lngSum += m.place.coordinate.longitude * w;
    });
    coordinate = { latitude: latSum / weightSum, longitude: lngSum / weightSum };
  }

  const visitCountInRange = sorted.reduce((sum, m) => sum + m.visitCountInRange, 0);

  // 代表照片取"当前时段到访最多"的成员；都一样多时取排序后的第一个，保证结果稳定
  const cover = [...sorted].sort(
    (a, b) => b.visitCountInRange - a.visitCountInRange,
  )[0]?.coverMedia;

  return {
    id,
    coordinate,
    members: sorted,
    placeCount: sorted.length,
    visitCountInRange,
    dimState: dimStateOf(sorted),
    coverMedia: cover,
  };
}

/**
 * 把地点聚合成地图标记。
 *
 * 贪心算法：先挑当前时段内容最多的地点当锚点，把半径内的地点都归给它，
 * 再处理剩下的。地点数量是个人量级（几十个），O(n²) 完全够用，
 * 也不需要引入额外的聚合库。
 */
export function clusterPlaceSummaries(
  summaries: PlaceSummary[],
  region: MapRegion,
  viewport: Viewport,
  radiusPx: number = CLUSTER_RADIUS_PX,
): MapCluster[] {
  if (summaries.length === 0) return [];
  if (viewport.width <= 0 || viewport.height <= 0) {
    // 还没测量到视口尺寸时不聚合，宁可先显示散点，也不要算出错误的分组
    return summaries.map((s) => buildCluster([s]));
  }

  const points = summaries.map((summary) => ({
    summary,
    ...projectToScreen(summary.place.coordinate, region, viewport),
  }));

  const order = [...points].sort(
    (a, b) => b.summary.visitCountInRange - a.summary.visitCountInRange,
  );

  const used = new Set<string>();
  const clusters: MapCluster[] = [];

  order.forEach((anchor) => {
    const anchorId = anchor.summary.place.id;
    if (used.has(anchorId)) return;
    used.add(anchorId);
    const members: PlaceSummary[] = [anchor.summary];
    order.forEach((other) => {
      const otherId = other.summary.place.id;
      if (used.has(otherId)) return;
      if (Math.hypot(other.x - anchor.x, other.y - anchor.y) <= radiusPx) {
        members.push(other.summary);
        used.add(otherId);
      }
    });
    clusters.push(buildCluster(members));
  });

  return clusters;
}

export type ClusterPressPlan =
  | { kind: 'zoom'; region: MapRegion }
  | { kind: 'list'; reason: 'coincident' | 'max-zoom' | 'still-clustered' };

/**
 * 点击聚合标记后该做什么。
 *
 * 顺序是：能放大就放大；放大也分不开（坐标重合、或已经到了最小范围）就退回列表选择。
 * 判断"放大后能否分开"用的是同一套聚合函数模拟一次，而不是再写一套阈值，
 * 这样只要聚合规则改了，这里的判断会自动跟着变。
 */
export function planClusterPress(
  cluster: MapCluster,
  region: MapRegion,
  viewport: Viewport,
  options: { radiusPx?: number; minDelta?: number } = {},
): ClusterPressPlan {
  const radiusPx = options.radiusPx ?? CLUSTER_RADIUS_PX;
  const minDelta = options.minDelta ?? MIN_REGION_DELTA;

  if (cluster.placeCount < 2) return { kind: 'list', reason: 'coincident' };

  const lats = cluster.members.map((m) => m.place.coordinate.latitude);
  const lngs = cluster.members.map((m) => m.place.coordinate.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;

  // 坐标完全重合：无论怎么放大都会重新聚成一团
  if (latSpan < EPS_COORD && lngSpan < EPS_COORD) {
    return { kind: 'list', reason: 'coincident' };
  }
  if (region.latitudeDelta <= minDelta * 1.02) {
    return { kind: 'list', reason: 'max-zoom' };
  }

  const aspect = viewport.width > 0 && viewport.height > 0 ? viewport.height / viewport.width : 1;
  const needed = Math.max(latSpan, lngSpan * aspect) / CLUSTER_VIEWPORT_RATIO;
  // 上限取当前范围的 0.62：一次点击至少要缩小到六成，否则用户感觉"没反应"
  const targetDelta = Math.max(minDelta, Math.min(needed, region.latitudeDelta * 0.62));

  const targetRegion: MapRegion = {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: targetDelta,
    longitudeDelta: targetDelta / aspect,
  };

  // 用同一套聚合规则模拟：放大后还只有一团，说明这次点击解决不了
  const after = clusterPlaceSummaries(
    cluster.members,
    targetRegion,
    viewport,
    radiusPx * 0.9,
  );
  if (after.length <= 1) return { kind: 'list', reason: 'still-clustered' };

  return { kind: 'zoom', region: targetRegion };
}

/** 供 UI 判断"这个聚合里是否包含当前选中的地点" */
export function clusterContainsPlace(cluster: MapCluster, placeId: string | null): boolean {
  if (!placeId) return false;
  return cluster.members.some((m) => m.place.id === placeId);
}

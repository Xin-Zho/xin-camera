/**
 * 照片 → 到访 → 故事的导入规划层（纯函数，不碰 store、不碰 React）。
 *
 * 为什么单独一层：
 *   导入是**不可撤销的写入**，一旦生成错的地点或到访，用户只能一条条删。
 *   所以把「怎么切分、怎么去重、要不要追加」全部算完，再由 store 一次性落库；
 *   这样这套规则可以脱离真机、在 Node 里用断言跑完（见仓库 README 的断言一节）。
 *
 * 四条硬规则（都来自实际需求，不是设计洁癖）：
 *   1. **有定位 → 同一片区域合成一个地点；没有定位 → 全部收进「未定位」这一处**，
 *      不参与地图标记，但照片不丢、故事照样能看；
 *   2. **同一天 + 同一地点 + 间隔不超过 4 小时算一次到访**（4 小时是暂定阈值，
 *      它只决定「切成几本」，不影响「一次到访一本」的结论）；
 *   3. **重复导入不重复生成**：以 `libraryAssetId` 为数据源键，导入过的一律跳过；
 *   4. **不覆盖用户已有编辑**：新照片只有在目标故事「没有被用户改过」时才追加进去，
 *      改过就另起一本——否则会把人家排好的封面和顺序打乱。
 *
 * 还有一条容易被忽略的：**归属日在导入时固定**。
 * `dateKey` 一旦写进媒体和故事，之后分组、默认标题都只读它，
 * 不再从 `capturedAt` 用设备时区重新推一遍。否则回国/出差换个时区，
 * 走设备时区兜底的那批照片会整体换天。
 */

import type {
  DateSourceKind,
  MediaAsset,
  Place,
  Story,
  Visit,
} from '@/src/domain/types';
import { formatDayKey } from '@/src/utils/datetime';

/** 同一地点的判定半径。80 m ≈ 一个街区，比地图聚合半径（像素）宽，但不会把两个商场并成一个 */
export const PLACE_RADIUS_METERS = 80;

/** 同地点两批照片间隔超过这个值就切成两次到访（暂定，未做实验标定） */
export const VISIT_GAP_MINUTES = 240;

/** 未定位照片的收纳地点。固定 id，保证多次导入都落到同一处 */
export const UNLOCATED_PLACE_ID = 'p-lib-unlocated';
export const UNLOCATED_PLACE_NAME = '未定位';

export interface ImportCandidate {
  libraryAssetId: string;
  filename: string | null;
  width: number | null;
  height: number | null;
  /** 真实文件 uri。取不到时为空串，媒体仍然入库（列表会显示占位），不因此丢照片 */
  uri: string;
  /**
   * 沙盒内缩略图 uri（约 600px）。列表 / 封面优先显示它；
   * 生成失败时为 null，回落到 `uri`（宁慢不丢）。
   */
  thumbUri?: string | null;
  /** 拍摄的绝对时刻 */
  capturedMs: number;
  /** 导入时固定下来的归属日（YYYY-MM-DD） */
  dateKey: string;
  dateSource: DateSourceKind;
  /** 生效偏移（分钟），只用来算当地时刻和默认标题后缀 */
  offsetMinutes: number | null;
  location: { latitude: number; longitude: number } | null;
  isScreenshot: boolean;
}

export interface ImportContext {
  places: Place[];
  visits: Visit[];
  media: MediaAsset[];
  stories: Story[];
}

export interface ImportAppend {
  visitId: string;
  /**
   * 目标故事。只有「没被用户改过、没删、没合并」的故事才会被追加，
   * 所以这里实际总是一个真实故事 id；类型保留可空只是为了防御
   * 历史上可能存在的孤儿到访（到访还在、故事已被删）。
   * 孤儿到访**不追加**——照片追加进去就没有故事承载，用户在故事列表里找不到它，
   * 宁可另起一本。
   */
  storyId: string | null;
  mediaIds: string[];
  /** 追加后的到访结束时刻（ISO），store 直接写 */
  endAt: string;
}

export interface ImportPlan {
  newMedia: MediaAsset[];
  newPlaces: Place[];
  newVisits: Visit[];
  newStories: Story[];
  appends: ImportAppend[];
  /** 已导入过、本次跳过的张数 */
  skippedDuplicates: number;
  skippedDuplicateIds: string[];
  locatedMedia: number;
  unlocatedMedia: number;
  /** 新增数据的时间跨度，导入后据此扩时间窗口，否则新故事在时间轴外看不见 */
  rangeStartIso: string | null;
  rangeEndIso: string | null;
  /** 新建的地点名称（给结果提示用） */
  createdPlaceNames: string[];
  /**
   * 受影响的已有地点 id（本次往里塞了照片或到访）。
   * store 按它重算 `mediaIds` / `visitIds`——聚合字段由底层数据重新推，
   * 不靠调用方维护，免得两次导入之间出现「地点里少了照片」这种不一致。
   */
  affectedPlaceIds: string[];
  createdVisitCount: number;
  createdStoryCount: number;
  appendedMediaCount: number;
}

/** 32 位 FNV-1a。只用来把 PHAsset id 压成短而稳定的后缀，不承担密码学用途 */
function hashKey(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function pad2(n: number): string {
  return `${n}`.padStart(2, '0');
}

/** 带偏移的 ISO。偏移未知时退回 UTC，宁可显示 Z 也不假装知道时区 */
export function isoWithOffset(ms: number, offsetMinutes: number | null): string {
  if (offsetMinutes === null) return new Date(ms).toISOString();
  const d = new Date(ms + offsetMinutes * 60_000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(
    d.getUTCHours(),
  )}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}${sign}${pad2(
    Math.floor(abs / 60),
  )}:${pad2(abs % 60)}`;
}

/** 当地时刻 `HH:mm`，用于同一天同一地点的第二本起做标题后缀 */
function localClock(ms: number, offsetMinutes: number | null): string {
  const d = new Date(ms + (offsetMinutes ?? 0) * 60_000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** 两个经纬度之间的近似距离（米）。纬度 1° ≈ 111_320 m，经度按纬度收缩 */
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const latRad = ((a.latitude + b.latitude) / 2) * (Math.PI / 180);
  const dx = (a.longitude - b.longitude) * 111_320 * Math.cos(latRad);
  const dy = (a.latitude - b.latitude) * 111_320;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 只认导入产生的故事；示例故事不参与追加，避免把真实照片塞进示例相册 */
function isAppendableStory(story: Story | undefined): boolean {
  // story 为 undefined = 孤儿到访（故事已被删）。同样不追加，理由见 ImportAppend.storyId
  if (!story) return false;
  return !story.isDeleted && !story.mergedIntoStoryId && story.editedByUser !== true;
}

interface VisitWork {
  id: string;
  placeId: string;
  dateKey: string;
  startMs: number;
  endMs: number;
  mediaIds: string[];
  /** 本次新建的到访：直接改本地工作副本，不用 appends */
  isNew: boolean;
  storyId: string | null;
  appendable: boolean;
  originMediaCount: number;
  offsetMinutes: number | null;
}

/**
 * 主入口。输入候选照片与现有数据，输出一份可以直接落库的计划。
 * 不修改任何入参对象（工作副本另建），调用方可以放心重试。
 */
export function planLibraryImport(
  candidates: ImportCandidate[],
  context: ImportContext,
  nowIso: string = new Date().toISOString(),
): ImportPlan {
  const existingAssetIds = new Set(
    context.media
      .map((m) => m.libraryAssetId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

  const skippedDuplicateIds: string[] = [];
  const fresh: ImportCandidate[] = [];
  for (const candidate of candidates) {
    if (existingAssetIds.has(candidate.libraryAssetId)) {
      skippedDuplicateIds.push(candidate.libraryAssetId);
      continue;
    }
    // 同一批里重复出现也只算一次
    existingAssetIds.add(candidate.libraryAssetId);
    fresh.push(candidate);
  }
  fresh.sort((a, b) => a.capturedMs - b.capturedMs);

  const newPlaces: Place[] = [];
  const newVisits: Visit[] = [];
  const newStories: Story[] = [];
  const newMedia: MediaAsset[] = [];
  const createdPlaceNames: string[] = [];

  /** 地点工作集：已有的导入地点 + 本次新建，用于「就近并入」 */
  const placeWork: Place[] = context.places
    .filter((p) => p.origin === 'library')
    .map((p) => ({ ...p, mediaIds: [...p.mediaIds], visitIds: [...p.visitIds] }));

  let unlocatedPlace = placeWork.find((p) => p.id === UNLOCATED_PLACE_ID);
  if (!unlocatedPlace && context.places.some((p) => p.id === UNLOCATED_PLACE_ID)) {
    unlocatedPlace = {
      ...(context.places.find((p) => p.id === UNLOCATED_PLACE_ID) as Place),
      mediaIds: [],
      visitIds: [],
    };
  }

  const nextPlaceName = () =>
    `未命名地点 ${placeWork.filter((p) => p.id !== UNLOCATED_PLACE_ID).length + 1}`;

  /** 到访工作集：已有的导入到访 + 本次新建 */
  const storyByVisitId = new Map<string, Story>();
  context.stories.forEach((story) => {
    story.visitIds.forEach((visitId) => {
      // 同一到访被多本故事引用时取第一本，够用：导入只会有一本
      if (!storyByVisitId.has(visitId)) storyByVisitId.set(visitId, story);
    });
  });

  const visitWork: VisitWork[] = context.visits
    .filter((v) => v.origin === 'library')
    .map((v) => {
      const story = storyByVisitId.get(v.id);
      const startMs = new Date(v.startAt).getTime();
      const endMs = new Date(v.endAt).getTime();
      return {
        id: v.id,
        placeId: v.placeId,
        dateKey: v.dateKey ?? localDayKey(v.startAt),
        startMs: Number.isFinite(startMs) ? startMs : 0,
        endMs: Number.isFinite(endMs) ? endMs : 0,
        mediaIds: [...v.mediaIds],
        isNew: false,
        storyId: story?.id ?? null,
        appendable: isAppendableStory(story),
        originMediaCount: v.mediaIds.length,
        offsetMinutes: null,
      };
    });

  let unlocatedMedia = 0;
  let locatedMedia = 0;

  for (const candidate of fresh) {
    const isUnlocated = candidate.location === null;
    let place: Place | undefined;

    if (isUnlocated) {
      unlocatedMedia += 1;
      if (!unlocatedPlace) {
        unlocatedPlace = {
          id: UNLOCATED_PLACE_ID,
          name: UNLOCATED_PLACE_NAME,
          // 没有定位就没有坐标。这里写 0,0 只是为了满足类型，
          // 地图会按 unlocated 标记过滤掉，绝不会把它画到几内亚湾
          coordinate: { latitude: 0, longitude: 0 },
          mediaIds: [],
          visitIds: [],
          origin: 'library',
          unlocated: true,
          category: '这些照片没有定位信息',
        };
        placeWork.push(unlocatedPlace);
        newPlaces.push(unlocatedPlace);
        createdPlaceNames.push(unlocatedPlace.name);
      }
      place = unlocatedPlace;
    } else {
      locatedMedia += 1;
      const point = candidate.location as { latitude: number; longitude: number };
      let nearest: Place | undefined;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const item of placeWork) {
        if (item.unlocated) continue;
        const distance = distanceMeters(point, item.coordinate);
        if (distance <= PLACE_RADIUS_METERS && distance < nearestDistance) {
          nearest = item;
          nearestDistance = distance;
        }
      }
      if (!nearest) {
        const name = nextPlaceName();
        nearest = {
          id: `p-lib-${hashKey(`${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`)}`,
          name,
          coordinate: { ...point },
          mediaIds: [],
          visitIds: [],
          origin: 'library',
        };
        placeWork.push(nearest);
        newPlaces.push(nearest);
        createdPlaceNames.push(name);
      }
      place = nearest;
    }

    // ---- 找宿主到访：同地点 + 同归属日 + 间隔在阈值内 + 故事没被改过 ----
    const host = visitWork
      .filter((v) => v.placeId === place.id && v.dateKey === candidate.dateKey)
      .filter((v) => v.isNew || v.appendable)
      .filter((v) => {
        const gapMs = VISIT_GAP_MINUTES * 60_000;
        return candidate.capturedMs <= v.endMs + gapMs && candidate.capturedMs >= v.startMs - gapMs;
      })
      .sort((a, b) => Math.abs(a.endMs - candidate.capturedMs) - Math.abs(b.endMs - candidate.capturedMs))[0];

    const mediaId = `m-lib-${hashKey(candidate.libraryAssetId)}`;
    const width = candidate.width && candidate.width > 0 ? candidate.width : 3;
    const height = candidate.height && candidate.height > 0 ? candidate.height : 4;

    // 不管落进已有到访还是新到访，照片都归这个地点。
    // 聚合字段必须由这里一并写上：`newPlaces` 会原样交给 store，
    // 只写 visitIds 不写 mediaIds 会让新地点少照片（地点页空着）。
    place.mediaIds.push(mediaId);

    if (host) {
      host.mediaIds.push(mediaId);
      host.startMs = Math.min(host.startMs, candidate.capturedMs);
      host.endMs = Math.max(host.endMs, candidate.capturedMs);
      newMedia.push(
        buildMedia(candidate, mediaId, place.id, host.id, width, height),
      );
      continue;
    }

    // ---- 新到访 + 新故事 ----
    const visitId = `v-lib-${hashKey(`${candidate.libraryAssetId}|${place.id}`)}`;
    const sameDaySamePlace = [
      ...context.stories,
      ...newStories,
    ].filter(
      (s) =>
        !s.isDeleted &&
        !s.mergedIntoStoryId &&
        s.placeIds.includes(place.id) &&
        (s.dateKey ?? localDayKey(s.startAt)) === candidate.dateKey,
    ).length;

    const baseTitle = `${place.name} · ${formatDayKey(candidate.dateKey)}`;
    const title =
      sameDaySamePlace === 0
        ? baseTitle
        : `${baseTitle} · ${localClock(candidate.capturedMs, candidate.offsetMinutes)}`;

    const visit: Visit = {
      id: visitId,
      placeId: place.id,
      startAt: isoWithOffset(candidate.capturedMs, candidate.offsetMinutes),
      endAt: isoWithOffset(candidate.capturedMs, candidate.offsetMinutes),
      mediaIds: [mediaId],
      coverMediaId: mediaId,
      origin: 'library',
      dateKey: candidate.dateKey,
    };
    const story: Story = {
      id: `s-lib-${hashKey(`${candidate.libraryAssetId}|${place.id}`)}`,
      title,
      placeIds: [place.id],
      visitIds: [visitId],
      mediaIds: [mediaId],
      coverMediaId: mediaId,
      startAt: visit.startAt,
      endAt: visit.endAt,
      layout: 'editorial',
      highlightedMediaIds: [],
      isDeleted: false,
      coverTitleMode: 'below',
      updatedAt: nowIso,
      origin: 'library',
      dateKey: candidate.dateKey,
      editedByUser: false,
    };

    place.visitIds.push(visitId);
    newVisits.push(visit);
    newStories.push(story);
    newMedia.push(buildMedia(candidate, mediaId, place.id, visitId, width, height));
    visitWork.push({
      id: visitId,
      placeId: place.id,
      dateKey: candidate.dateKey,
      startMs: candidate.capturedMs,
      endMs: candidate.capturedMs,
      mediaIds: [mediaId],
      isNew: true,
      storyId: story.id,
      appendable: true,
      originMediaCount: 1,
      offsetMinutes: candidate.offsetMinutes,
    });
  }

  // 新建到访的最终时间范围写回对象（追加会延长 endMs）
  const visitById = new Map(newVisits.map((v) => [v.id, v]));
  const storyById = new Map(newStories.map((s) => [s.id, s]));
  for (const work of visitWork) {
    const offset = work.offsetMinutes;
    if (work.isNew) {
      const visit = visitById.get(work.id);
      if (visit) {
        visit.endAt = isoWithOffset(work.endMs, offset);
        visit.mediaIds = [...work.mediaIds];
      }
      const story = work.storyId ? storyById.get(work.storyId) : undefined;
      if (story) {
        story.endAt = visit?.endAt ?? story.endAt;
        story.mediaIds = [...work.mediaIds];
      }
    }
  }

  // 已有到访的追加记录
  const appends: ImportAppend[] = visitWork
    .filter((w) => !w.isNew && w.mediaIds.length > w.originMediaCount)
    .map((w) => {
      const offset = w.offsetMinutes ?? offsetOfIso(context.visits.find((v) => v.id === w.id)?.endAt);
      return {
        visitId: w.id,
        storyId: w.storyId,
        mediaIds: w.mediaIds.slice(w.originMediaCount),
        endAt: isoWithOffset(w.endMs, offset),
      };
    });

  const times = newMedia
    .map((m) => new Date(m.capturedAt).getTime())
    .filter((t) => Number.isFinite(t));

  const affectedPlaceIds = Array.from(
    new Set([
      ...newMedia.map((m) => m.placeId).filter((id): id is string => Boolean(id)),
      ...newPlaces.map((p) => p.id),
      ...newVisits.map((v) => v.placeId),
    ]),
  );

  return {
    newMedia,
    newPlaces,
    newVisits,
    newStories,
    appends,
    skippedDuplicates: skippedDuplicateIds.length,
    skippedDuplicateIds,
    locatedMedia,
    unlocatedMedia,
    rangeStartIso: times.length ? new Date(Math.min(...times)).toISOString() : null,
    rangeEndIso: times.length ? new Date(Math.max(...times)).toISOString() : null,
    createdPlaceNames,
    affectedPlaceIds,
    createdVisitCount: newVisits.length,
    createdStoryCount: newStories.length,
    appendedMediaCount: appends.reduce((sum, item) => sum + item.mediaIds.length, 0),
  };
}

function buildMedia(
  candidate: ImportCandidate,
  mediaId: string,
  placeId: string,
  visitId: string,
  width: number,
  height: number,
): MediaAsset {
  return {
    id: mediaId,
    uri: candidate.uri,
    thumbUri: candidate.thumbUri ?? null,
    kind: 'photo',
    capturedAt: isoWithOffset(candidate.capturedMs, candidate.offsetMinutes),
    placeId,
    visitId,
    isScreenshot: candidate.isScreenshot,
    width,
    height,
    origin: 'library',
    libraryAssetId: candidate.libraryAssetId,
    dateKey: candidate.dateKey,
    dateSource: candidate.dateSource,
  };
}

/** 设备时区解读出来的日期键，只用于没有固定 dateKey 的旧数据 */
function localDayKey(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 从已有 ISO 里取回时区偏移（分钟），用于让追加后的 endAt 与原数据同一套写法 */
function offsetOfIso(iso: string | undefined): number | null {
  if (!iso) return null;
  const match = iso.match(/([+-])(\d{2}):(\d{2})$/);
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

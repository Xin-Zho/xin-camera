/**
 * 全局共享类型 —— 唯一真源。
 * 任何 agent 都不得在别处重复定义这些形状，也不得私自改名。
 * 对应规格：docs/prototype-spec.md §7
 */

export type MediaKind = 'photo' | 'video';

export interface MediaAsset {
  id: string;
  /**
   * 原型阶段不用真实文件路径，用 `mock:<slug>` 资源键，
   * 由 src/data/mediaSource.ts 解析成项目内本地图片。
   */
  uri: string;
  kind: MediaKind;
  /** ISO 8601 */
  capturedAt: string;
  placeId?: string;
  visitId?: string;
  isScreenshot?: boolean;
  width: number;
  height: number;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface Place {
  id: string;
  name: string;
  coordinate: GeoPoint;
  category?: string;
  city?: string;
  mediaIds: string[];
  visitIds: string[];
}

export interface Visit {
  id: string;
  placeId: string;
  /** ISO 8601 */
  startAt: string;
  /** ISO 8601 */
  endAt: string;
  mediaIds: string[];
  coverMediaId: string;
}

export type StoryLayout = 'editorial' | 'large-cover' | 'grid';

/**
 * 封面标题布局：叠在照片上，或放在照片下方留白处。
 * 原型阶段由预设值模拟，不做真实构图分析（规格 §10）。
 */
export type CoverTitleMode = 'overlay' | 'below';

export interface Story {
  id: string;
  title: string;
  placeIds: string[];
  /** 自动生成的故事与 Visit 为 1:1（规格 §7.2）；合并后可以有多条 */
  visitIds: string[];
  /** 已排序的媒体 ID，顺序独立于 Visit.mediaIds */
  mediaIds: string[];
  coverMediaId: string;
  /** ISO 8601 */
  startAt: string;
  /** ISO 8601 */
  endAt: string;
  layout: StoryLayout;
  highlightedMediaIds: string[];
  userText?: string;
  coverTitleMode?: CoverTitleMode;
  /** 删除只改展示状态，不动地点 / 到访 / 媒体 */
  isDeleted: boolean;
  /** 合并进本册的源故事 ID，用于拆分还原 */
  mergedFromStoryIds?: string[];
  /**
   * 被合并后指向合集故事。有这个字段的故事不单独显示，
   * 但它**不是被删除**，拆分时按 mergedFromStoryIds 还原。
   */
  mergedIntoStoryId?: string;
  /** 原型中用于可逆拆分；正式版可改为独立快照结构 */
  mergeSnapshot?: Story[];
  updatedAt: string;
}

export type TimeGranularity = 'year' | 'month' | 'day';

export interface TimeRange {
  startAt: string;
  endAt: string;
  granularity: TimeGranularity;
}

/** 用于地图标注、列表项等轻量展示 */
export interface PlaceSummary {
  place: Place;
  /** 当前时间窗口内该地点最近一次到访 */
  latestVisit?: Visit;
  /** 当前时间窗口内的代表照片 */
  coverMedia?: MediaAsset;
  /** 当前时间窗口内的到访数 */
  visitCountInRange: number;
}

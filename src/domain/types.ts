/**
 * 全局共享类型 —— 唯一真源。
 * 任何 agent 都不得在别处重复定义这些形状，也不得私自改名。
 * 对应规格：docs/prototype-spec.md §7
 */

export type MediaKind = 'photo' | 'video';

/**
 * 数据来源。示例素材与真实相册导入的数据放在同一套结构里，
 * 靠这个字段区分——地图聚合、地点合并、测试断言都只认同一类来源，
 * 不会出现「真实照片被并进示例地点」这种看起来对、其实错的结果。
 */
export type DataOrigin = 'mock' | 'library';

/**
 * 归属日（日历日）的来源。与 src/library/dateRule.ts 的判定结果一一对应，
 * 这里单独声明是为了让领域类型不反向依赖读取层。
 */
export type DateSourceKind = 'exif-offset' | 'exif-datetime-original' | 'device-tz' | 'none';

export interface MediaAsset {
  id: string;
  /**
   * 示例素材是 `mock:<slug>` 资源键，由 src/data/mediaSource.ts 解析成本地图片；
   * 导入的真实照片是 `file://…`，此时直接交给 Image。
   */
  uri: string;
  /**
   * 缩略图 uri（约 600px，导入时由原图生成、存在 App 沙盒内）。
   * 列表 / 瓦片 / 封面一律优先用它——原图直出既慢又是临时文件，随时会失效。
   * 查看大图（阅读页整宽图、未来的查看器）才回落到 `uri`。
   * 示例数据没有这层，为 undefined 时走 `uri` 即可。
   */
  thumbUri?: string | null;
  kind: MediaKind;
  /** ISO 8601 */
  capturedAt: string;
  placeId?: string;
  visitId?: string;
  isScreenshot?: boolean;
  width: number;
  height: number;
  origin?: DataOrigin;
  /** 真实相册的 PHAsset id。重复导入的数据源键，没有它就无法判断「这张是不是已经导入过」 */
  libraryAssetId?: string;
  /**
   * 导入时**当场固定**下来的归属日（YYYY-MM-DD）。
   * 之后所有按天分组、默认标题都读它，不再从 capturedAt 推——
   * 否则设备时区一变（回国、出差），走设备时区兜底的那批照片会整体换天。
   */
  dateKey?: string;
  /** 归属日是怎么定的，便于回溯；导入后不改 */
  dateSource?: DateSourceKind;
  /**
   * 用户「从回忆相册移除」这一张的时刻。
   *
   * 刻意**不删除**媒体、也不从 `story.mediaIds` / `visit.mediaIds` 里摘掉：
   *  1. 移除要能恢复，顺序和封面位置都得原样回来，删引用就等于把顺序丢了；
   *  2. 「哪些照片还该显示」只能有一个开关。多存一处状态就会多一处对不上的可能。
   *
   * 存时刻而不是布尔值，是为了回收站能按移除时间倒序排。
   * 它**不影响 iPhone 系统相册里的原图**，只在本 App 内隐藏。
   */
  removedAt?: string;
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
  origin?: DataOrigin;
  /** 没有定位的照片收在这一处，不参与地图标记 */
  unlocated?: boolean;
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
  origin?: DataOrigin;
  /** 归属日，用来判断「同一天同一地点是否已经有到访」 */
  dateKey?: string;
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
  /**
   * 因照片被全部移除而**自动**删除的标记（用户确认的产品逻辑：
   * 图库里把故事的照片移空，故事跟着进「已删除」）。
   * 只在这条自动链路里置位/清除：恢复其中任何一张照片，故事自动回来。
   * 用户手动删除时必须清掉它——手动删除是最终决定，恢复照片不该复活故事。
   */
  deletedByEmptying?: boolean;
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
  origin?: DataOrigin;
  /**
   * 归属日（YYYY-MM-DD）。有它就按它分组和显示，不看 startAt 的时区解读。
   * 这是「导入时固定日期」这条规则在展示层的落点。
   */
  dateKey?: string;
  /**
   * 用户是否亲手改过这本（改标题、封面、布局、标题位置、正文、调序、重点、合并）。
   * 导入时**只往没被改过的故事里追加新照片**，改过的一律不动——追加会打乱用户排好的顺序。
   */
  editedByUser?: boolean;
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

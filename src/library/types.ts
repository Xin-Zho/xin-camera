/**
 * 真实相册读取层的类型。
 *
 * 这里只描述「原生到底给了什么」，不做任何推测性补齐：
 * 拿不到就记为缺失，并把缺失和读取失败分开，避免上层把两种不同的空当成同一种。
 *
 * 字段来源（expo-media-library@58 的 class 版 API，已核对 iOS 原生实现）：
 *   - 列表页：Query.exeForMetadata() → id / filename / mediaType / width / height /
 *     duration / creationTime / modificationTime / isFavorite / mediaSubtypes
 *   - 单个资产：Asset.getUri() / getLocation() / getExif()
 * metadata 里**没有**定位和 URI，所以定位必须逐个资产另取，代价见 reader.ts。
 */

/** 原生媒体类型。audio 只出现在 Android，iOS 的 PHAsset 不会有。 */
export type LibraryMediaType = 'photo' | 'video' | 'audio' | 'unknown';

/**
 * 时间戳单位的判定结果。
 * 之所以要单独判一次：expo-media-library 的 TS 注释写的是「秒」，
 * 但 iOS 实现是 `Date.millisecondsSince1970`，返回的是**毫秒**。
 * 注释和实现对不上，所以原值保留、单位显式标注，不默认按任何一种换算。
 */
export type EpochUnit = 'ms' | 's' | 'unknown' | 'none';

export interface RawEpoch {
  /** 原生返回的原始数值，未做单位换算 */
  readonly raw: number | null;
  readonly unit: EpochUnit;
}

/**
 * 定位的三态。
 * `missing` = 读取成功但系统没有这张照片的位置（相册里很多图确实没有）；
 * `error` = 读取本身失败（权限变化、资产已删除）。
 * 两者都不能当成"位置未知"含糊过去，UI 文案也不一样。
 */
export type LibraryLocation =
  | { kind: 'unread' }
  | { kind: 'value'; latitude: number; longitude: number }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

/** 缩略图解析状态。视频不解析缩略图，直接给 null + 类型角标。 */
export type ThumbState =
  | { kind: 'pending' }
  | { kind: 'ready'; uri: string }
  | { kind: 'error'; message: string }
  | { kind: 'skipped' };

export interface LibraryAsset {
  /** 形如 `ph://<localIdentifier>`，可直接用来重建 Asset 实例 */
  id: string;
  filename: string | null;
  mediaType: LibraryMediaType;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  creationTime: RawEpoch;
  modificationTime: RawEpoch;
  isFavorite: boolean;
  /** iOS 的 PHAssetMediaSubtype，例如 livePhoto / screenshot / panorama */
  subtypes: string[];
  thumb: ThumbState;
  location: LibraryLocation;
}

/** 权限状态。availability 单独一档，用来区分「没权限」和「这台宿主根本没有相册模块」。 */
export type LibraryPermissionStatus = 'granted' | 'denied' | 'undetermined';

export type AccessPrivileges = 'all' | 'limited' | 'none' | 'unknown';

export interface LibraryPermission {
  status: LibraryPermissionStatus;
  /** iOS 14+ 的「仅选定照片」。Android 14+ 也有 limited。 */
  accessPrivileges: AccessPrivileges;
  canAskAgain: boolean;
}

/** 宿主是否带相册原生模块。单独建模，避免把"模块缺失"显示成"你拒绝了权限"。 */
export type LibraryAvailability =
  | { kind: 'ok' }
  | { kind: 'module-missing'; detail: string };

export interface LibraryPage {
  assets: LibraryAsset[];
  /** 本页返回条数少于 pageSize 即认为到底 */
  hasMore: boolean;
  /** 本次实际请求的 offset，便于排查分页错位 */
  offset: number;
}

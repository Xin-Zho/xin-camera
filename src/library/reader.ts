// Metro 提供 CommonJS 的 require。这里只在函数内部调用，用来把相册模块的求值推迟到真正要用的时候：
// expo-media-library 在模块顶层就 requireNativeModule('ExpoMediaLibraryNext')，
// 宿主没有这个原生模块时会直接抛错。如果静态 import，整个 App（包括示例数据流程）都会在启动时白屏。
declare function require(id: string): unknown;

import { requireOptionalNativeModule } from 'expo';

import { mapWithConcurrency } from './concurrency';
import { makeRawEpoch } from './epoch';
import type {
  AccessPrivileges,
  LibraryAsset,
  LibraryAvailability,
  LibraryLocation,
  LibraryMediaType,
  LibraryPage,
  LibraryPermission,
  LibraryPermissionStatus,
  ThumbState,
} from './types';

/**
 * 真实相册读取层。只读，不写相册、不改示例数据。
 *
 * 两次原生产生成本差异很大，这里刻意分开：
 *   - 一页元数据：`Query.exeForMetadata()`，一次原生调用拿 24 条轻量字段（含拍摄时间）
 *   - 每条资产的缩略图和定位：必须逐个资产另取（`Asset.getUri()` / `Asset.getLocation()`），
 *     metadata 里没有这两个字段。所以页大小不能开太大。
 */

/** 每页条数。范围验证阶段故意小：一页 24 条的缩略图已经要 24 次原生调用。 */
export const PAGE_SIZE = 24;

/** 缩略图/定位解析的并发上限，见 concurrency.ts 的注释 */
const ENRICH_CONCURRENCY = 3;

type MediaLibraryModule = typeof import('expo-media-library');

let moduleCache: MediaLibraryModule | null = null;
let moduleLoadError: string | null = null;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : JSON.stringify(error);
}

/**
 * 宿主是否具备相册能力。
 * 先问 expo 有没有 `ExpoMediaLibraryNext` 原生模块，再决定要不要加载 JS 层——
 * 这样"模块缺失"和"用户拒绝权限"在界面上是两件完全不同的事。
 */
export function checkAvailability(): LibraryAvailability {
  try {
    const native = requireOptionalNativeModule('ExpoMediaLibraryNext');
    if (!native) {
      return {
        kind: 'module-missing',
        detail:
          '当前宿主没有 ExpoMediaLibraryNext 原生模块。Expo Go 未内置或自建 dev client 未重新编译时会出现这种情况。',
      };
    }
    return { kind: 'ok' };
  } catch (error) {
    return { kind: 'module-missing', detail: messageOf(error) };
  }
}

function loadModule(): MediaLibraryModule {
  if (moduleCache) return moduleCache;
  if (moduleLoadError) throw new Error(moduleLoadError);
  try {
    const loaded = require('expo-media-library') as MediaLibraryModule;
    moduleCache = loaded;
    return loaded;
  } catch (error) {
    moduleLoadError = messageOf(error);
    throw error;
  }
}

/** 给上层用的安全包装：任何原生异常都变成 { ok:false }，不让页面崩 */
export async function withModule<T>(
  run: (mod: MediaLibraryModule) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  try {
    return { ok: true, value: await run(loadModule()) };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

function normalizeStatus(status: string | undefined): LibraryPermissionStatus {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

/**
 * 权限归一化。
 * accessPrivileges 缺失时记成 `unknown` 而不是猜 `all`——
 * Android 14 以下不会区分全部/部分，那时候写「全部照片」是编的。
 */
export function normalizePermission(response: {
  status?: string;
  canAskAgain?: boolean;
  accessPrivileges?: 'all' | 'limited' | 'none';
}): LibraryPermission {
  const status = normalizeStatus(response.status);
  const privileges: AccessPrivileges =
    status === 'granted' ? response.accessPrivileges ?? 'unknown' : 'none';
  return {
    status,
    accessPrivileges: privileges,
    canAskAgain: response.canAskAgain ?? true,
  };
}

/** 读权限；request=true 时弹系统授权框 */
export async function readPermission(request: boolean): Promise<LibraryPermission> {
  const mod = loadModule();
  const granular = ['photo', 'video'] as const;
  const response = request
    ? await mod.requestPermissionsAsync(false, [...granular])
    : await mod.getPermissionsAsync(false, [...granular]);
  return normalizePermission(response);
}

/** 仅「部分照片」时让用户增选，系统会弹出选图面板 */
export async function presentLimitedPicker(): Promise<void> {
  const mod = loadModule();
  await mod.presentPermissionsPicker(['photo', 'video']);
}

/** MediaType 枚举值是 unknown / image / audio / video，本项目的领域词是 photo */
export function normalizeMediaType(value: string | undefined): LibraryMediaType {
  if (value === 'image') return 'photo';
  if (value === 'video') return 'video';
  if (value === 'audio') return 'audio';
  return 'unknown';
}

/** 视频不做缩略图：需要 AVAsset 抽取，代价与收益不成比例，先只给类型角标 */
function initialThumb(mediaType: LibraryMediaType): ThumbState {
  return mediaType === 'photo' ? { kind: 'pending' } : { kind: 'skipped' };
}

function toAsset(meta: {
  id: string;
  filename?: string | null;
  mediaType?: string;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  creationTime?: number | null;
  modificationTime?: number | null;
  isFavorite?: boolean;
  mediaSubtypes?: string[];
}): LibraryAsset {
  const mediaType = normalizeMediaType(meta.mediaType);
  return {
    id: meta.id,
    filename: meta.filename ?? null,
    mediaType,
    width: meta.width ?? null,
    height: meta.height ?? null,
    durationMs: meta.duration ?? null,
    creationTime: makeRawEpoch(meta.creationTime),
    modificationTime: makeRawEpoch(meta.modificationTime),
    isFavorite: Boolean(meta.isFavorite),
    subtypes: meta.mediaSubtypes ?? [],
    thumb: initialThumb(mediaType),
    location: { kind: 'unread' },
  };
}

/**
 * 读一页。按拍摄时间倒序，offset 分页。
 *
 * 用 offset 而不是游标：新版 Query 只有 offset。副作用是相册在两次读页之间发生变化时
 * 可能出现重复或漏项，页面按 id 去重，并在 UI 上说明。
 */
export async function readPage(offset: number, pageSize = PAGE_SIZE): Promise<LibraryPage> {
  const mod = loadModule();
  const metadata = await new mod.Query()
    .orderBy({ key: mod.AssetField.CREATION_TIME, ascending: false })
    .limit(pageSize)
    .offset(offset)
    .exeForMetadata();

  const assets = metadata.map((meta) => toAsset(meta as Parameters<typeof toAsset>[0]));
  return {
    assets,
    hasMore: assets.length >= pageSize,
    offset,
  };
}

/** 单个资产的缩略图 uri。注意 iOS 上会请求 fullSizeImageURL，iCloud 资产会触发下载。 */
export async function resolveThumb(assetId: string): Promise<ThumbState> {
  try {
    const mod = loadModule();
    const uri = await new mod.Asset(assetId).getUri();
    return uri ? { kind: 'ready', uri } : { kind: 'error', message: '系统返回空 uri' };
  } catch (error) {
    return { kind: 'error', message: messageOf(error) };
  }
}

/** 单个资产的定位。读取失败和"没有定位"分开记。 */
export async function resolveLocation(assetId: string): Promise<LibraryLocation> {
  try {
    const mod = loadModule();
    const location = await new mod.Asset(assetId).getLocation();
    if (!location) return { kind: 'missing' };
    return {
      kind: 'value',
      latitude: location.latitude,
      longitude: location.longitude,
    };
  } catch (error) {
    return { kind: 'error', message: messageOf(error) };
  }
}

/** 为一页资产补缩略图和定位，返回和入参同序的新数组 */
export async function enrichPage(
  assets: LibraryAsset[],
  options: { onProgress?: (assetId: string, patch: Partial<LibraryAsset>) => void } = {},
): Promise<LibraryAsset[]> {
  const next = assets.map((asset) => ({ ...asset }));

  await mapWithConcurrency(next, ENRICH_CONCURRENCY, async (asset, index) => {
    if (asset.mediaType === 'photo') {
      const thumb = await resolveThumb(asset.id);
      next[index].thumb = thumb;
      options.onProgress?.(asset.id, { thumb });
    }
    const location = await resolveLocation(asset.id);
    next[index].location = location;
    options.onProgress?.(asset.id, { location });
  });

  return next;
}

export interface AssetDetail {
  id: string;
  info: {
    filename: string | null;
    mediaType: LibraryMediaType;
    width: number | null;
    height: number | null;
    durationMs: number | null;
  };
  creationTime: LibraryAsset['creationTime'];
  modificationTime: LibraryAsset['modificationTime'];
  location: LibraryLocation;
  subtypes: string[];
  isFavorite: boolean;
  /** 读取过程中的部分失败：某几项读不到不影响整页展示 */
  failures: string[];
}

/** 检查页用的详情读取：把能拿到的都拿到，单项失败只记 failures 不整体失败 */
export async function readAssetDetail(assetId: string): Promise<AssetDetail> {
  const mod = loadModule();
  const asset = new mod.Asset(assetId);
  const failures: string[] = [];

  const info = await asset.getInfo();

  let location: LibraryLocation = { kind: 'unread' };
  try {
    const raw = await asset.getLocation();
    location = raw
      ? { kind: 'value', latitude: raw.latitude, longitude: raw.longitude }
      : { kind: 'missing' };
  } catch (error) {
    location = { kind: 'error', message: messageOf(error) };
    failures.push(`定位：${messageOf(error)}`);
  }

  let subtypes: string[] = [];
  try {
    subtypes = await asset.getMediaSubtypes();
  } catch (error) {
    failures.push(`子类型：${messageOf(error)}`);
  }

  return {
    id: assetId,
    info: {
      filename: info.filename ?? null,
      mediaType: normalizeMediaType(info.mediaType as unknown as string),
      width: info.width ?? null,
      height: info.height ?? null,
      durationMs: info.duration ?? null,
    },
    creationTime: makeRawEpoch(info.creationTime),
    modificationTime: makeRawEpoch(info.modificationTime),
    location,
    subtypes,
    isFavorite: Boolean(info.isFavorite),
    failures,
  };
}

/**
 * 读 EXIF。代价很高：iOS 实现会先把当前版本导出成临时文件再解析，
 * iCloud 资产还会触发下载。所以只在用户主动点按的时候调用，绝不进列表循环。
 */
export async function readAssetExif(assetId: string): Promise<Record<string, unknown>> {
  const mod = loadModule();
  const exif = await new mod.Asset(assetId).getExif();
  return exif as Record<string, unknown>;
}

/** 判断资产是否在 iCloud 上（未下载），用于解释为什么缩略图很慢 */
export async function isInCloud(assetId: string): Promise<boolean | null> {
  try {
    const mod = loadModule();
    return await new mod.Asset(assetId).getIsInCloud();
  } catch {
    return null;
  }
}

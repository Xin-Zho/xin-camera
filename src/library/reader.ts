// Metro 提供 CommonJS 的 require。这里只在函数内部调用，用来把相册模块的求值推迟到真正要用的时候：
// expo-media-library 在模块顶层就 requireNativeModule('ExpoMediaLibraryNext')，
// 宿主没有这个原生模块时会直接抛错。如果静态 import，整个 App（包括示例数据流程）都会在启动时白屏。
declare function require(id: string): unknown;

import { requireOptionalNativeModule } from 'expo';

import { mapWithConcurrency } from './concurrency';
import { makeRawEpoch } from './epoch';

/**
 * expo-file-system / expo-image-manipulator 也走惰性 require：
 * 顶层静态 import 原生模块会让缺模块的宿主在启动时白屏（与 expo-media-library 同理），
 * 而且断言桩环境解析不了这些包。类型用 `import type`（编译期擦除），运行时才取真模块。
 */
type FsModule = typeof import('expo-file-system');
let fsCache: FsModule | null = null;
function loadFs(): FsModule {
  if (!fsCache) fsCache = require('expo-file-system') as FsModule;
  return fsCache;
}

type ManipulatorModule = typeof import('expo-image-manipulator');
let manipulatorCache: ManipulatorModule | null = null;
function loadManipulator(): ManipulatorModule {
  if (!manipulatorCache) manipulatorCache = require('expo-image-manipulator') as ManipulatorModule;
  return manipulatorCache;
}
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

/** 沙盒内媒体持久目录。导入的原图 / 缩略图都搬到这里，临时目录的文件系统随时会清 */
function mediaDir(): import('expo-file-system').Directory {
  const { Directory, Paths } = loadFs();
  return new Directory(Paths.document, 'media');
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function extnameOf(filename: string | null): string | null {
  if (!filename) return null;
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{2,5}$/.test(ext) ? ext : null;
}

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

/**
 * 导入用的原图 uri。拿不到就返回 null——**不抛错**：
 * 一张照片取不到 uri 不该让整批导入失败，媒体照样入库（列表显示占位），用户还能改。
 *
 * 提醒：iOS 上这是临时目录里的副本，系统清理后 uri 会失效。
 * 原型阶段接受这个代价（见 docs/v4-import.md），正式版应复制进沙盒并长期持有。
 */
export async function resolveUri(assetId: string): Promise<string | null> {
  try {
    const mod = loadModule();
    const uri = await new mod.Asset(assetId).getUri();
    return uri ?? null;
  } catch {
    return null;
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

/**
 * 只补定位，不碰缩略图。
 * 日期口径那页不需要预览图（列表是数据行不是相册格），少一次 getUri 就少一次潜在的原图/iCloud 下载。
 */
export async function enrichLocations(
  assets: LibraryAsset[],
  options: { onProgress?: (assetId: string, location: LibraryLocation) => void } = {},
): Promise<LibraryAsset[]> {
  const next = assets.map((asset) => ({ ...asset }));
  await mapWithConcurrency(next, ENRICH_CONCURRENCY, async (asset, index) => {
    const location = await resolveLocation(asset.id);
    next[index].location = location;
    options.onProgress?.(asset.id, location);
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

/**
 * 把原稿持久化进 App 沙盒。
 *
 * `Asset.getUri()` 返回的是系统临时目录里的副本，iOS 清理 tmp 后路径就死了——
 * 表现就是「图片加载慢，之后干脆不显示」。所以导入时必须当场把文件搬进
 * documentDirectory，拿到一个长期有效的 uri。拿不到返回 null（同 resolveUri 的宽容语义）。
 */
export async function persistOriginal(assetId: string, filename: string | null): Promise<string | null> {
  try {
    const mod = loadModule();
    const { File } = loadFs();
    const tmpUri = await new mod.Asset(assetId).getUri();
    if (!tmpUri) return null;

    const dir = mediaDir();
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });

    const ext = extnameOf(filename) ?? 'jpg';
    const dest = new File(dir, `${sanitizeId(assetId)}.${ext}`);
    if (dest.exists) return dest.uri; // 同一资产重复导入：已有副本直接复用

    await new File(tmpUri).copy(dest);
    return dest.uri;
  } catch {
    return null;
  }
}

/** 缩略图目标宽度。三列瓦片、封面、卡片最大也就 ~400pt，600px 留足 2x 余量 */
const THUMB_WIDTH = 600;

/** 老存档自愈后的媒体源。thumbUri 可能为 null（缩略图生成失败，但持久化原图已到手） */
export interface PersistedSources {
  uri: string;
  thumbUri: string | null;
}

/**
 * 为 M16 之前导入的媒体补持久化副本 + 缩略图（自愈迁移）。
 *
 * 老记录的 `uri` 是临时目录副本，iOS 清理后就是死路径——表现是「一部分照片
 * 等很久也显示不出来」。存档里存了 `libraryAssetId`，照片还在系统相册就能
 * 按它重新取原稿、复制进沙盒、生成缩略图。persistOriginal 幂等：已有副本直接复用。
 */
export async function repairPersistedSources(assetId: string): Promise<PersistedSources | null> {
  const uri = await persistOriginal(assetId, null);
  if (!uri) return null;
  const thumbUri = await makeThumb(uri);
  return { uri, thumbUri };
}

/**
 * 由持久化后的原图生成缩略图。视频或损坏文件会失败——返回 null，
 * 调用方回落到原 uri（原 uri 都没有时展示占位，页面已有兜底）。
 */
export async function makeThumb(uri: string): Promise<string | null> {
  try {
    const { manipulateAsync, SaveFormat } = loadManipulator();
    const result = await manipulateAsync(
      uri,
      [{ resize: { width: THUMB_WIDTH } }],
      { compress: 0.8, format: SaveFormat.JPEG },
    );
    return result.uri ?? null;
  } catch {
    return null;
  }
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

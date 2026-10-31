import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { collectExifTimeEvidence, resolveShootDate } from '@/src/library/dateRule';
import { deviceOffsetMinutes, toEpochMs } from '@/src/library/epoch';
import type { ImportCandidate } from '@/src/library/importPlan';
import {
  PAGE_SIZE,
  checkAvailability,
  enrichPage,
  makeThumb,
  persistOriginal,
  presentLimitedPicker,
  readAssetExif,
  readPage,
  readPermission,
  resolveLocation,
  resolveUri,
} from '@/src/library/reader';
import { formatShortTime } from '@/src/library/epoch';
import type {
  LibraryAsset,
  LibraryAvailability,
  LibraryLocation,
  LibraryMediaType,
  LibraryPermission,
} from '@/src/library/types';
import { useAppStore } from '@/src/store/appStore';
import { colors, layout, radius, spacing, typography } from '@/src/theme';

/**
 * 真实相册（只读实验）。
 *
 * 这一页的目标是把「系统到底给了什么」摊开看，不是接进故事流程：
 * 不写 store、不生成到访、不影响示例数据那条链路，随时可以整页删掉。
 *
 * 三条刻意的约束：
 *  1. 只在拿到权限后才读第一页，翻页必须用户点，避免一进页面就扫全库、顺带触发 iCloud 下载；
 *  2. 缺失和失败分开显示（无定位 / 定位读取失败），不合并成"未知"；
 *  3. 时间原值原样带进检查页，单位由 epoch.ts 按量级判定，不默认套毫秒。
 */

const GRID_COLS = 3;
const GRID_GAP = 6;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : JSON.stringify(error);
}

function mediaTypeLabel(mediaType: LibraryMediaType): string {
  switch (mediaType) {
    case 'photo':
      return '照片';
    case 'video':
      return '视频';
    case 'audio':
      return '音频';
    default:
      return '未知类型';
  }
}

function locationLabel(location: LibraryLocation): string {
  switch (location.kind) {
    case 'value':
      return '有定位';
    case 'missing':
      return '无定位';
    case 'error':
      return '定位读取失败';
    default:
      return '定位读取中';
  }
}

function privilegesLabel(permission: LibraryPermission): string {
  if (permission.status === 'denied') return '已拒绝';
  if (permission.status === 'undetermined') return '未授权';
  if (permission.accessPrivileges === 'all') return '全部照片';
  if (permission.accessPrivileges === 'limited') return '仅选定照片';
  if (permission.accessPrivileges === 'none') return '无可见照片';
  return '已授权（宿主未区分范围）';
}

function durationLabel(ms: number | null): string | null {
  if (!ms || ms <= 0) return null;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${`${seconds}`.padStart(2, '0')}`;
}

/** 一次导入的结果。逐项列出来，是为了让「为什么只进了 12 张」当场有答案 */
interface ImportOutcome {
  addedMedia: number;
  locatedMedia: number;
  unlocatedMedia: number;
  createdPlaces: number;
  createdStories: number;
  appendedMedia: number;
  skippedDuplicates: number;
  skippedNoDate: number;
  skippedNonPhoto: number;
  cancelled: boolean;
}

export default function LibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [availability, setAvailability] = useState<LibraryAvailability | null>(null);
  const [permission, setPermission] = useState<LibraryPermission | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  const importLibraryAssets = useAppStore((s) => s.importLibraryAssets);
  const importCancelled = useRef(false);

  const cancelled = useRef(false);
  const loadingRef = useRef(false);
  const offsetRef = useRef(0);
  const seenIds = useRef<Set<string>>(new Set());
  const autoLoaded = useRef(false);

  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  const cellSize = Math.floor(
    (width - layout.screenPadding * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS,
  );

  const loadNext = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadingPage(true);
    setError(null);
    try {
      const page = await readPage(offsetRef.current, PAGE_SIZE);
      if (cancelled.current) return;

      // 相册在翻页过程中可能变化，offset 分页会有重叠项，按 id 去掉
      const fresh = page.assets.filter((asset) => !seenIds.current.has(asset.id));
      fresh.forEach((asset) => seenIds.current.add(asset.id));
      offsetRef.current = page.offset + page.assets.length;

      setAssets((prev) => [...prev, ...fresh]);
      setHasMore(page.hasMore);
      setPageCount((n) => n + 1);

      // 缩略图和定位逐个补，边到边显示，不阻塞列表出现
      enrichPage(fresh, {
        onProgress: (assetId, patch) => {
          if (cancelled.current) return;
          setAssets((prev) =>
            prev.map((asset) => (asset.id === assetId ? { ...asset, ...patch } : asset)),
          );
        },
      }).catch((enrichError) => {
        if (!cancelled.current) setError(`补充缩略图/定位时出错：${messageOf(enrichError)}`);
      });
    } catch (pageError) {
      if (!cancelled.current) setError(messageOf(pageError));
    } finally {
      loadingRef.current = false;
      if (!cancelled.current) setLoadingPage(false);
    }
  }, []);

  const resetAndReload = useCallback(() => {
    seenIds.current = new Set();
    offsetRef.current = 0;
    setAssets([]);
    setPageCount(0);
    setHasMore(true);
    setError(null);
    void loadNext();
  }, [loadNext]);

  // 首次进入：先判能力，再读权限。两件事都不弹窗，弹窗只由用户点按钮触发。
  useEffect(() => {
    const boot = async () => {
      const availabilityResult = checkAvailability();
      if (cancelled.current) return;
      setAvailability(availabilityResult);
      if (availabilityResult.kind !== 'ok') return;
      try {
        const permissionResult = await readPermission(false);
        if (!cancelled.current) setPermission(permissionResult);
      } catch (permissionError) {
        if (!cancelled.current) setError(messageOf(permissionError));
      }
    };
    void boot();
  }, []);

  // 拿到权限后自动读第一页，只自动一次；后面的页要用户点
  useEffect(() => {
    if (permission?.status !== 'granted') return;
    if (autoLoaded.current) return;
    autoLoaded.current = true;
    void loadNext();
  }, [permission, loadNext]);

  const requestPermission = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await readPermission(true);
      if (cancelled.current) return;
      setPermission(next);
    } catch (permissionError) {
      if (!cancelled.current) setError(messageOf(permissionError));
    } finally {
      if (!cancelled.current) setBusy(false);
    }
  }, []);

  const openLimitedPicker = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await presentLimitedPicker();
      // 系统不会告诉 JS 用户改了哪些照片，只能重新读一遍
      resetAndReload();
    } catch (pickerError) {
      if (!cancelled.current) setError(messageOf(pickerError));
    } finally {
      if (!cancelled.current) setBusy(false);
    }
  }, [resetAndReload]);

  /**
   * 把当前已加载的照片导入成地点 / 到访 / 故事。
   *
   * 流程刻意是「逐张顺序处理」而不是并发：
   *   读 EXIF 在 iOS 上要把当前版本导出成临时文件，并发读更容易被系统掐掉；
   *   顺序做还能稳定显示进度，用户知道还要等多久。
   *
   * 单张失败不中止整批——一张读不出时间就跳过，剩下的照常进。
   * 去重、切分、追加规则全在 planLibraryImport 里，这里只准备候选数据。
   */
  const runImport = useCallback(
    async (targets: LibraryAsset[]) => {
      importCancelled.current = false;
      setOutcome(null);
      setError(null);

      const photos = targets.filter((asset) => asset.mediaType === 'photo');
      const skippedNonPhoto = targets.length - photos.length;
      const candidates: ImportCandidate[] = [];
      let skippedNoDate = 0;

      setImporting({ done: 0, total: photos.length });
      for (let index = 0; index < photos.length; index += 1) {
        if (importCancelled.current) break;
        const asset = photos[index];
        setImporting({ done: index, total: photos.length });
        try {
          const epochMs = toEpochMs(asset.creationTime);
          if (epochMs === null) {
            skippedNoDate += 1;
            continue;
          }

          // 定位可能还没补完（上一页的 enrich 还在跑），这里补一次再定地点
          const location =
            asset.location.kind === 'value' || asset.location.kind === 'missing'
              ? asset.location
              : await resolveLocation(asset.id);

          // EXIF 读不到就当没有：判定层会把来源标成设备时区，不编证据
          let evidence = null;
          try {
            evidence = collectExifTimeEvidence(await readAssetExif(asset.id));
          } catch {
            evidence = null;
          }

          const resolution = resolveShootDate({
            epochMs,
            deviceOffsetMinutes: deviceOffsetMinutes(epochMs),
            exif: evidence,
            hasLocation: location.kind === 'value',
          });
          if (!resolution.dateKey) {
            skippedNoDate += 1;
            continue;
          }

          // 原图先搬进沙盒：`getUri()` 的临时副本会被系统清掉，直接存是
          // 「图片加载慢、后来干脆不显示」的根因。搬不动才退回旧的宽容链路。
          // 缩略图由持久原图生成——导入慢一点，换之后所有页面秒开。
          const persisted = await persistOriginal(asset.id, asset.filename);
          const uri =
            persisted ??
            (asset.thumb.kind === 'ready' ? asset.thumb.uri : ((await resolveUri(asset.id)) ?? ''));
          const thumbUri = persisted ? await makeThumb(persisted) : null;

          candidates.push({
            libraryAssetId: asset.id,
            filename: asset.filename,
            width: asset.width,
            height: asset.height,
            uri,
            thumbUri,
            capturedMs: epochMs,
            dateKey: resolution.dateKey,
            dateSource: resolution.source,
            offsetMinutes: resolution.offsetMinutes,
            location:
              location.kind === 'value'
                ? { latitude: location.latitude, longitude: location.longitude }
                : null,
            isScreenshot: asset.subtypes.some((s) => s.toLowerCase().includes('screenshot')),
          });
        } catch {
          // 单张失败（资产被删、权限变化）只影响这一张
          skippedNoDate += 1;
        }
      }
      setImporting(null);

      const wasCancelled = importCancelled.current;
      if (candidates.length === 0) {
        setOutcome({
          addedMedia: 0,
          locatedMedia: 0,
          unlocatedMedia: 0,
          createdPlaces: 0,
          createdStories: 0,
          appendedMedia: 0,
          skippedDuplicates: 0,
          skippedNoDate,
          skippedNonPhoto,
          cancelled: wasCancelled,
        });
        return;
      }

      const plan = importLibraryAssets(candidates);
      setOutcome({
        addedMedia: plan.newMedia.length,
        locatedMedia: plan.locatedMedia,
        unlocatedMedia: plan.unlocatedMedia,
        createdPlaces: plan.createdPlaceNames.length,
        createdStories: plan.createdStoryCount,
        appendedMedia: plan.appendedMediaCount,
        skippedDuplicates: plan.skippedDuplicates,
        skippedNoDate,
        skippedNonPhoto,
        cancelled: wasCancelled,
      });
    },
    [importLibraryAssets],
  );

  const confirmImport = useCallback(() => {
    const photoCount = assets.filter((asset) => asset.mediaType === 'photo').length;
    if (photoCount === 0) return;
    Alert.alert(
      '导入到回忆？',
      `会用当前已加载的 ${photoCount} 张照片，按拍摄时间和定位生成地点、到访和故事。\n\n` +
        '· 已导入过的照片会跳过，不会生成两份\n' +
        '· 你改过标题或顺序的故事不会被追加照片\n' +
        '· 归属日在导入时固定，之后换时区也不会变',
      [
        { text: '取消', style: 'cancel' },
        { text: '开始导入', onPress: () => void runImport(assets) },
      ],
    );
  }, [assets, runImport]);

  const renderCell = ({ item }: { item: LibraryAsset }) => {
    const duration = durationLabel(item.durationMs);
    const isVideo = item.mediaType === 'video';
    const isAudio = item.mediaType === 'audio';
    return (
      <Pressable
        style={{ width: cellSize }}
        onPress={() =>
          router.push({ pathname: '/library/inspect', params: { id: item.id } })
        }
        accessibilityLabel={`${mediaTypeLabel(item.mediaType)} ${formatShortTime(item.creationTime)}`}>
        <View style={[styles.cell, { width: cellSize, height: cellSize }]}>
          {item.thumb.kind === 'ready' ? (
            <Image
              source={{ uri: item.thumb.uri }}
              style={styles.cellImage}
              resizeMode="cover"
            />
          ) : item.thumb.kind === 'skipped' ? (
            // 视频没有预览接口，不能留空白——空白看起来像加载失败。
            // 给一张明确的占位卡：深底 + 播放图标 + 类型文字，和「照片读失败」在视觉上分开。
            <View style={styles.videoCard}>
              <SymbolView
                name={{ ios: 'play.rectangle.fill', android: 'movie', web: 'movie' }}
                tintColor={colors.textOnMedia}
                size={26}
              />
              <Text style={styles.videoCardText}>{isVideo ? '视频' : isAudio ? '音频' : '媒体'}</Text>
            </View>
          ) : item.thumb.kind === 'error' ? (
            <View style={styles.cellPlaceholder}>
              <SymbolView
                name={{ ios: 'photo.badge.exclamationmark', android: 'broken_image', web: 'broken_image' }}
                tintColor={colors.textTertiary}
                size={20}
              />
              <Text style={styles.cellPlaceholderText}>无法预览</Text>
            </View>
          ) : (
            <View style={styles.cellPlaceholder}>
              <ActivityIndicator size="small" color={colors.textTertiary} />
            </View>
          )}
          {duration ? (
            <View style={styles.durationBadge}>
              <Text style={styles.durationText}>{duration}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.cellTime} numberOfLines={1}>
          {formatShortTime(item.creationTime)}
        </Text>
        <Text style={styles.cellMeta} numberOfLines={1}>
          {mediaTypeLabel(item.mediaType)} · {locationLabel(item.location)}
        </Text>
      </Pressable>
    );
  };

  const renderHeader = () => (
    <View>
      {permission?.status === 'granted' && permission.accessPrivileges === 'limited' ? (
        <View style={styles.noticeAmber}>
          <Text style={styles.noticeAmberTitle}>当前只能看到你选中的照片</Text>
          <Text style={styles.noticeAmberBody}>
            系统返回的是「部分照片」授权，其余照片对 App 不可见。
            可以再选一批，选完这里会重新读一遍。
          </Text>
          <Pressable
            onPress={openLimitedPicker}
            disabled={busy}
            style={styles.inlineButton}>
            <Text style={styles.inlineButtonText}>选择更多照片</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.summaryRow}>
        <Text style={styles.summaryText}>
          权限：{permission ? privilegesLabel(permission) : '读取中'}
        </Text>
        <Text style={styles.summaryText}>
          已加载 {assets.length} 张 · {pageCount} 批
        </Text>
      </View>

      <Pressable
        style={styles.entryButton}
        onPress={() => router.push('/library/dates')}>
        <View style={styles.entryText}>
          <Text style={styles.entryTitle}>日期口径验证</Text>
          <Text style={styles.entryHint}>
            看每张照片该归到哪一天、依据是什么；决定要不要接坐标反查时区
          </Text>
        </View>
        <SymbolView
          name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
          tintColor={colors.textTertiary}
          size={14}
        />
      </Pressable>

      <Pressable
        style={[styles.importButton, (assets.length === 0 || importing !== null) && styles.importButtonOff]}
        disabled={assets.length === 0 || importing !== null}
        onPress={confirmImport}>
        <Text style={styles.importButtonText}>
          {importing
            ? `读取时间与定位 ${importing.done}/${importing.total}`
            : `导入到回忆（${assets.filter((item) => item.mediaType === 'photo').length} 张）`}
        </Text>
      </Pressable>
      {importing ? (
        <Pressable
          style={styles.importCancel}
          onPress={() => {
            importCancelled.current = true;
          }}>
          <Text style={styles.importCancelText}>取消（已处理的部分会保存）</Text>
        </Pressable>
      ) : null}
      <Text style={styles.importHint}>
        生成地点、到访和故事，写入本机存档。需要逐张读 EXIF，所以会慢一些；
        读不到拍摄时间或已经导入过的会自动跳过。
      </Text>

      {outcome ? (
        <View style={styles.outcomeBox}>
          <Text style={styles.outcomeTitle}>
            {outcome.cancelled ? '导入被中断，已经处理的部分已保存' : '导入完成'}
          </Text>
          <Text style={styles.outcomeLine} selectable>
            新增照片 {outcome.addedMedia} 张（有定位 {outcome.locatedMedia} · 未定位{' '}
            {outcome.unlocatedMedia}）
          </Text>
          <Text style={styles.outcomeLine} selectable>
            新建地点 {outcome.createdPlaces} 个 · 新故事 {outcome.createdStories} 本
            {outcome.appendedMedia > 0 ? ` · 追加进已有故事 ${outcome.appendedMedia} 张` : ''}
          </Text>
          <Text style={styles.outcomeLine} selectable>
            跳过：重复 {outcome.skippedDuplicates} 张 · 没有可用拍摄时间 {outcome.skippedNoDate} 张
            {outcome.skippedNonPhoto > 0 ? ` · 非照片 ${outcome.skippedNonPhoto} 个` : ''}
          </Text>
          {outcome.addedMedia > 0 ? (
            <Pressable
              style={styles.outcomeLink}
              onPress={() => router.push('/(tabs)/stories')}>
              <Text style={styles.outcomeLinkText}>去故事页看</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.hint}>
        按拍摄时间倒序，每批 {PAGE_SIZE} 张。读取是只读的（不写相册）；导入会把照片变成地点、到访和故事，
        写进本机存档。点任意一张可以看系统返回的原始字段。
      </Text>

      {error ? (
        <View style={styles.noticeDanger}>
          <Text style={styles.noticeDangerText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );

  const renderFooter = () => {
    if (permission?.status !== 'granted') return null;
    if (loadingPage) {
      return (
        <View style={styles.footer}>
          <ActivityIndicator color={colors.textTertiary} />
          <Text style={styles.footerText}>正在读取第 {pageCount + 1} 批…</Text>
        </View>
      );
    }
    if (!hasMore) {
      return (
        <View style={styles.footer}>
          <Text style={styles.footerText}>已到相册末尾，共 {assets.length} 张</Text>
        </View>
      );
    }
    return (
      <View style={styles.footer}>
        <Pressable onPress={() => void loadNext()} style={styles.loadMoreButton}>
          <Text style={styles.loadMoreText}>读取下一批（{PAGE_SIZE} 张）</Text>
        </Pressable>
      </View>
    );
  };

  const granted = permission?.status === 'granted';

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={8}
          accessibilityLabel="返回">
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            tintColor={colors.textPrimary}
            size={20}
          />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>真实相册</Text>
          <Text style={styles.subtitle}>读取全只读 · 导入会生成地点与故事</Text>
        </View>
      </View>

      {availability === null ? (
        <View style={styles.centerBlock}>
          <ActivityIndicator color={colors.textTertiary} />
          <Text style={styles.centerText}>正在检查宿主能力…</Text>
        </View>
      ) : availability.kind === 'module-missing' ? (
        <View style={styles.centerBlock}>
          <Text style={styles.centerTitle}>这台宿主没有相册模块</Text>
          <Text style={styles.centerText}>{availability.detail}</Text>
          <Pressable
            style={styles.primaryButton}
            onPress={() => {
              cancelled.current = false;
              setAvailability(checkAvailability());
            }}>
            <Text style={styles.primaryButtonText}>重新检查</Text>
          </Pressable>
        </View>
      ) : permission === null ? (
        <View style={styles.centerBlock}>
          <ActivityIndicator color={colors.textTertiary} />
          <Text style={styles.centerText}>正在读取相册权限…</Text>
        </View>
      ) : permission.status === 'undetermined' ? (
        <View style={styles.centerBlock}>
          <Text style={styles.centerTitle}>需要读取相册的权限</Text>
          <Text style={styles.centerText}>
            只读取照片的拍摄时间、类型和定位，用来验证能不能生成回忆。
            不会上传，不会修改相册，也不会动到现有示例数据。
          </Text>
          <Pressable
            style={styles.primaryButton}
            disabled={busy}
            onPress={() => void requestPermission()}>
            <Text style={styles.primaryButtonText}>{busy ? '正在请求…' : '允许访问照片'}</Text>
          </Pressable>
        </View>
      ) : permission.status === 'denied' ? (
        <View style={styles.centerBlock}>
          <Text style={styles.centerTitle}>相册权限被拒绝</Text>
          <Text style={styles.centerText}>
            拒绝之后没有照片可以读，这一页会一直是空的。示例数据那条流程不受影响。
          </Text>
          {permission.canAskAgain ? (
            <Pressable
              style={styles.primaryButton}
              disabled={busy}
              onPress={() => void requestPermission()}>
              <Text style={styles.primaryButtonText}>{busy ? '正在请求…' : '再请求一次'}</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.secondaryButton} onPress={() => void Linking.openSettings()}>
            <Text style={styles.secondaryButtonText}>打开系统设置</Text>
          </Pressable>
          {error ? <Text style={styles.centerError}>{error}</Text> : null}
        </View>
      ) : (
        <FlatList
          data={assets}
          keyExtractor={(item) => item.id}
          renderItem={renderCell}
          numColumns={GRID_COLS}
          ListHeaderComponent={renderHeader()}
          ListFooterComponent={renderFooter() ?? undefined}
          columnWrapperStyle={styles.column}
          contentContainerStyle={{
            paddingHorizontal: layout.screenPadding,
            paddingBottom: insets.bottom + spacing.xxl,
            gap: spacing.md,
          }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {granted && assets.length === 0 && loadingPage ? (
        <View style={styles.centerOverlay}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.md,
  },
  backButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -6,
  },
  headerText: { flex: 1, gap: 1 },
  title: { ...typography.title2, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textTertiary },
  column: { gap: GRID_GAP },
  cell: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.mediaPlaceholder,
  },
  cellImage: { width: '100%', height: '100%' },
  cellPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  cellPlaceholderText: { ...typography.caption2, color: colors.textTertiary },
  /** 视频/音频占位卡：深色底 + 图标 + 类型文字，和「照片读失败」的浅灰占位区分开 */
  videoCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceTranslucentDark,
  },
  videoCardText: { ...typography.caption2, color: colors.textOnMedia },
  cellTime: {
    ...typography.caption2,
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  cellMeta: { ...typography.caption2, color: colors.textTertiary },
  durationBadge: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.videoBadge,
  },
  durationText: { ...typography.caption2, color: colors.textOnMedia, fontVariant: ['tabular-nums'] },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  summaryText: { ...typography.caption, color: colors.textSecondary },
  entryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.backgroundGrouped,
    marginBottom: spacing.sm,
  },
  entryText: { flex: 1, gap: 2 },
  entryTitle: { ...typography.footnote, color: colors.textPrimary, fontWeight: '600' },
  entryHint: { ...typography.caption2, color: colors.textTertiary, lineHeight: 14 },
  importButton: {
    minHeight: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  importButtonOff: { opacity: 0.4 },
  importButtonText: { ...typography.callout, color: colors.textOnMedia, fontWeight: '600' },
  importCancel: { alignSelf: 'center', paddingVertical: spacing.xs },
  importCancelText: { ...typography.caption, color: colors.textSecondary },
  importHint: {
    ...typography.caption2,
    color: colors.textTertiary,
    lineHeight: 15,
    marginBottom: spacing.sm,
  },
  outcomeBox: {
    backgroundColor: colors.accentMuted,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 3,
    marginBottom: spacing.sm,
  },
  outcomeTitle: { ...typography.footnote, color: colors.accent, fontWeight: '600' },
  outcomeLine: { ...typography.caption2, color: colors.textSecondary, lineHeight: 16 },
  outcomeLink: { alignSelf: 'flex-start', paddingTop: spacing.xxs },
  outcomeLinkText: { ...typography.caption, color: colors.accent, fontWeight: '600' },
  hint: {
    ...typography.caption,
    color: colors.textTertiary,
    lineHeight: 17,
    marginBottom: spacing.sm,
  },
  noticeAmber: {
    backgroundColor: colors.warningMuted,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  noticeAmberTitle: { ...typography.footnote, color: colors.warning, fontWeight: '600' },
  noticeAmberBody: { ...typography.caption, color: colors.warning, lineHeight: 17 },
  noticeDanger: {
    backgroundColor: colors.dangerMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  noticeDangerText: { ...typography.caption, color: colors.danger, lineHeight: 17 },
  inlineButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    marginTop: spacing.xxs,
  },
  inlineButtonText: { ...typography.caption, color: colors.warning, fontWeight: '600' },
  footer: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.lg,
  },
  footerText: { ...typography.caption, color: colors.textTertiary },
  loadMoreButton: {
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundGrouped,
  },
  loadMoreText: { ...typography.callout, color: colors.textPrimary },
  centerBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
  },
  centerTitle: { ...typography.title2, color: colors.textPrimary, textAlign: 'center' },
  centerText: {
    ...typography.footnote,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  centerError: { ...typography.caption, color: colors.danger, textAlign: 'center' },
  primaryButton: {
    minHeight: layout.minTouchTarget,
    minWidth: 160,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.textPrimary,
  },
  primaryButtonText: { ...typography.callout, color: colors.textOnMedia, fontWeight: '600' },
  secondaryButton: {
    minHeight: layout.minTouchTarget,
    minWidth: 160,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundGrouped,
  },
  secondaryButtonText: { ...typography.callout, color: colors.textPrimary },
  centerOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    alignItems: 'center',
  },
});

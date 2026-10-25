import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

import {
  PAGE_SIZE,
  checkAvailability,
  enrichPage,
  presentLimitedPicker,
  readPage,
  readPermission,
} from '@/src/library/reader';
import { formatShortTime } from '@/src/library/epoch';
import type {
  LibraryAsset,
  LibraryAvailability,
  LibraryLocation,
  LibraryMediaType,
  LibraryPermission,
} from '@/src/library/types';
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

      <Text style={styles.hint}>
        按拍摄时间倒序，每批 {PAGE_SIZE} 张。这一页只读：不写入相册，也不生成到访和故事。
        点任意一张可以看系统返回的原始字段。
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
          <Text style={styles.subtitle}>只读实验 · 不生成到访和故事</Text>
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

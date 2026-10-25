import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  buildSampleReport,
  collectExifTimeEvidence,
  describeDateSource,
  formatOffset,
  resolveShootDate,
  summarizeDateRule,
} from '@/src/library/dateRule';
import type { DateRuleSample, DateSource, ExifState, ExifTimeEvidence } from '@/src/library/dateRule';
import { deviceOffsetMinutes, toEpochMs } from '@/src/library/epoch';
import {
  PAGE_SIZE,
  enrichLocations,
  readAssetExif,
  readPage,
  readPermission,
  resolveLocation,
} from '@/src/library/reader';
import type { LibraryAsset } from '@/src/library/types';
import { colors, layout, radius, spacing, typography } from '@/src/theme';

/**
 * 日期口径验证页。
 *
 * 只回答一个问题：**这张照片应该归到哪一天，依据是什么。**
 * 目标是「旅行照片回到国内后仍归在拍摄当地那一天」，所以这里把三个来源的可用性
 * 逐张摊开，用真实样本决定「坐标反查时区」值不值得做，而不是先假定它必要。
 *
 * 三条刻意的约束：
 *  1. 不写 store、不生成到访和故事——这一页删掉不影响任何已有流程；
 *  2. EXIF 读取代价高（iOS 会把当前版本导出成临时文件，iCloud 还会触发下载），
 *     所以默认不读，逐张点按才读，批量读要用户自己按；
 *  3. 判定依据（evidence）直接显示在行内，不只给结论——口径这种东西没有依据就没法复核。
 */

type Filter = 'all' | 'photo' | 'video' | 'screenshot';

interface ExifEntry {
  state: ExifState;
  evidence?: ExifTimeEvidence;
  error?: string;
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'photo', label: '照片' },
  { key: 'video', label: '视频' },
  { key: 'screenshot', label: '截图' },
];

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : JSON.stringify(error);
}

function pad2(n: number): string {
  return `${n}`.padStart(2, '0');
}

/** 设备时区下的 `MM-DD HH:mm`，和相册列表的短时间保持一致 */
function fmtDevice(ms: number | null): string {
  if (ms === null) return '—';
  const offset = deviceOffsetMinutes(ms);
  const d = new Date(ms + offset * 60_000);
  return `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(
    d.getUTCMinutes(),
  )}`;
}

function fmtUtc(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  return `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(
    d.getUTCMinutes(),
  )}`;
}

function sourceTone(source: DateSource): { bg: string; fg: string } {
  if (source === 'exif-offset' || source === 'exif-datetime-original') {
    return { bg: colors.accentMuted, fg: colors.accent };
  }
  if (source === 'device-tz') return { bg: colors.warningMuted, fg: colors.warning };
  return { bg: colors.dangerMuted, fg: colors.danger };
}

function mediaLabel(mediaType: LibraryAsset['mediaType']): string {
  if (mediaType === 'video') return '视频';
  if (mediaType === 'audio') return '音频';
  if (mediaType === 'unknown') return '未知类型';
  return '照片';
}

export default function DateRuleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [granted, setGranted] = useState<boolean | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [exifMap, setExifMap] = useState<Record<string, ExifEntry>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [loadingPage, setLoadingPage] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancelled = useRef(false);
  const offsetRef = useRef(0);
  const seenIds = useRef<Set<string>>(new Set());
  const loadingRef = useRef(false);
  const autoLoaded = useRef(false);
  const batchRef = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const loadNext = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadingPage(true);
    setError(null);
    try {
      const page = await readPage(offsetRef.current, PAGE_SIZE);
      if (cancelled.current) return;
      const fresh = page.assets.filter((asset) => !seenIds.current.has(asset.id));
      fresh.forEach((asset) => seenIds.current.add(asset.id));
      offsetRef.current = page.offset + page.assets.length;
      setAssets((prev) => [...prev, ...fresh]);
      setHasMore(page.hasMore);

      // 只补定位：这一页不需要预览图，少一次 getUri 就少一次潜在的原图/iCloud 下载
      enrichLocations(fresh, {
        onProgress: (assetId, location) => {
          if (cancelled.current) return;
          setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, location } : a)));
        },
      }).catch((enrichError) => {
        if (!cancelled.current) setError(`补充定位时出错：${messageOf(enrichError)}`);
      });
    } catch (pageError) {
      if (!cancelled.current) setError(messageOf(pageError));
    } finally {
      loadingRef.current = false;
      if (!cancelled.current) setLoadingPage(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const permission = await readPermission(false);
        if (cancelled.current) return;
        setGranted(permission.status === 'granted');
      } catch (permissionError) {
        if (!cancelled.current) {
          setGranted(false);
          setError(messageOf(permissionError));
        }
      }
    })();
  }, []);

  useEffect(() => {
    if (granted !== true || autoLoaded.current) return;
    autoLoaded.current = true;
    void loadNext();
  }, [granted, loadNext]);

  const readOneExif = useCallback(async (assetId: string) => {
    setExifMap((prev) => ({ ...prev, [assetId]: { state: 'reading' } }));
    try {
      const raw = await readAssetExif(assetId);
      if (cancelled.current) return;
      setExifMap((prev) => ({
        ...prev,
        [assetId]: { state: 'read', evidence: collectExifTimeEvidence(raw) },
      }));
    } catch (exifError) {
      if (cancelled.current) return;
      setExifMap((prev) => ({
        ...prev,
        [assetId]: { state: 'failed', error: messageOf(exifError) },
      }));
    }
  }, []);

  /** 批量读当前已加载、还没读过的样本。顺序执行：并发读 EXIF 会同时触发多次导出，更容易被系统掐。 */
  const readBatch = useCallback(
    async (targets: { id: string }[]) => {
      if (batchRef.current) return;
      batchRef.current = true;
      setBatch({ done: 0, total: targets.length });
      for (let i = 0; i < targets.length; i += 1) {
        if (cancelled.current) break;
        // eslint-disable-next-line no-await-in-loop
        await readOneExif(targets[i].id);
        if (cancelled.current) break;
        setBatch({ done: i + 1, total: targets.length });
      }
      batchRef.current = false;
      if (!cancelled.current) setBatch(null);
    },
    [readOneExif],
  );

  const samples = useMemo<DateRuleSample[]>(() => {
    return assets.map((asset) => {
      const entry = exifMap[asset.id];
      const entryState: ExifState = entry?.state ?? 'unread';
      const epochMs = toEpochMs(asset.creationTime);
      const resolution = resolveShootDate({
        epochMs,
        deviceOffsetMinutes: epochMs === null ? null : deviceOffsetMinutes(epochMs),
        exif: entryState === 'read' ? entry.evidence ?? null : null,
        hasLocation: asset.location.kind === 'value',
      });
      return {
        id: asset.id,
        filename: asset.filename,
        mediaType: asset.mediaType,
        isScreenshot: asset.subtypes.some((s) => s.toLowerCase().includes('screenshot')),
        hasLocation: asset.location.kind === 'value',
        exifState: entryState,
        resolution,
      };
    });
  }, [assets, exifMap]);

  const summary = useMemo(() => summarizeDateRule(samples), [samples]);

  const visible = useMemo(() => {
    if (filter === 'all') return samples;
    if (filter === 'photo') return samples.filter((s) => s.mediaType === 'photo' && !s.isScreenshot);
    if (filter === 'video') return samples.filter((s) => s.mediaType === 'video');
    return samples.filter((s) => s.isScreenshot);
  }, [samples, filter]);

  const pendingExif = useMemo(
    () => visible.filter((s) => s.exifState === 'unread'),
    [visible],
  );

  const locateOne = useCallback(async (assetId: string) => {
    const location = await resolveLocation(assetId);
    if (cancelled.current) return;
    setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, location } : a)));
  }, []);

  const share = useCallback(async () => {
    try {
      await Share.share({ message: buildSampleReport(samples, summary) });
    } catch (shareError) {
      setError(messageOf(shareError));
    }
  }, [samples, summary]);

  const renderRow = ({ item }: { item: DateRuleSample }) => {
    const asset = assets.find((a) => a.id === item.id);
    const entry = exifMap[item.id];
    const r = item.resolution;
    const tone = sourceTone(r.source);

    return (
      <View style={styles.row}>
        <View style={styles.rowHead}>
          <Text style={styles.rowDate}>{r.dateKey ?? '无法判定'}</Text>
          <View style={[styles.chip, { backgroundColor: tone.bg }]}>
            <Text style={[styles.chipText, { color: tone.fg }]}>{describeDateSource(r.source)}</Text>
          </View>
          {r.crossDay ? (
            <View style={[styles.chip, { backgroundColor: colors.accentMuted }]}>
              <Text style={[styles.chipText, { color: colors.accent }]}>与设备口径跨日</Text>
            </View>
          ) : null}
          {r.conflict ? (
            <View style={[styles.chip, { backgroundColor: colors.dangerMuted }]}>
              <Text style={[styles.chipText, { color: colors.danger }]}>证据冲突</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.rowMeta} selectable>
          UTC {fmtUtc(r.epochMs)} · 设备 {fmtDevice(r.epochMs)} → {r.deviceDateKey ?? '—'}
          {r.offsetMinutes === null ? '' : ` · 生效偏移 ${formatOffset(r.offsetMinutes)}`}
        </Text>
        <Text style={styles.rowMeta} selectable>
          {mediaLabel(item.mediaType)}
          {item.isScreenshot ? '（截图）' : ''} · {item.hasLocation ? '有定位' : '无定位'} ·{' '}
          {item.filename ?? '无文件名'}
        </Text>

        <Text style={styles.rowReason}>{r.reason}</Text>

        {r.impliedOffsetMinutes !== null ? (
          <Text style={styles.rowMeta}>
            反推偏移 {formatOffset(r.impliedOffsetMinutes)}
            {r.impliedOffsetPlausible ? '' : '（不合理，已弃用）'}
            {r.impliedMatchesDevice ? ' · 等于设备偏移' : ''}
          </Text>
        ) : null}

        {entry?.state === 'read' ? (
          <Text style={styles.rowMeta}>
            EXIF 时间字段 {entry.evidence?.fields.length ?? 0} 个
            {entry.evidence?.noTimeFields ? '（没有时间/时区字段）' : ''}
            {entry.evidence?.offsetSource ? ` · 偏移来自 ${entry.evidence.offsetSource}` : ''}
          </Text>
        ) : null}
        {entry?.state === 'failed' ? (
          <Text style={styles.rowWarn}>EXIF 读取失败：{entry.error}</Text>
        ) : null}
        {r.conflict || r.wallClockRejected ? (
          <View style={styles.evidenceBox}>
            {r.evidence.map((line) => (
              <Text key={line} style={styles.evidenceLine}>
                · {line}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.rowActions}>
          <Pressable
            style={styles.miniButton}
            onPress={() => router.push({ pathname: '/library/inspect', params: { id: item.id } })}
            hitSlop={6}>
            <Text style={styles.miniButtonText}>原始字段</Text>
          </Pressable>
          {asset?.location.kind === 'unread' ? (
            <Pressable style={styles.miniButton} onPress={() => void locateOne(item.id)} hitSlop={6}>
              <Text style={styles.miniButtonText}>读定位</Text>
            </Pressable>
          ) : null}
          {entry?.state === 'reading' ? (
            <View style={styles.miniBusy}>
              <ActivityIndicator size="small" color={colors.textTertiary} />
              <Text style={styles.miniButtonText}>读 EXIF…</Text>
            </View>
          ) : (
            <Pressable
              style={styles.miniButton}
              onPress={() => void readOneExif(item.id)}
              hitSlop={6}>
              <Text style={styles.miniButtonText}>
                {entry?.state === 'read' ? '重读 EXIF' : '读 EXIF'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  };

  const renderHeader = () => (
    <View style={styles.headerBlock}>
      <View style={styles.goalCard}>
        <Text style={styles.goalTitle}>目标：归在拍摄当地那一天</Text>
        <Text style={styles.goalBody}>
          海外拍的照片回到国内后，不能因为手机现在是东八区就被挪到前一天。判定按这个顺序取第一个可用的证据：
          {'\n'}1. EXIF 声明偏移（OffsetTimeOriginal 一类）
          {'\n'}2. EXIF DateTimeOriginal 的日期部分（相机写的当地墙上时间）
          {'\n'}3. 都没有 → 回退设备时区，并明确标成「设备时区」
        </Text>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.summaryGrid}>
          <SummaryStat label="样本" value={`${summary.total}`} />
          <SummaryStat label="EXIF 已读" value={`${summary.exifRead}`} />
          <SummaryStat label="EXIF 拍摄时间" value={`${summary.bySource['exif-datetime-original']}`} />
          <SummaryStat label="EXIF 偏移" value={`${summary.bySource['exif-offset']}`} />
          <SummaryStat label="回退设备时区" value={`${summary.bySource['device-tz']}`} />
          <SummaryStat label="跨日" value={`${summary.crossDay}`} />
        </View>
        <Text style={styles.summaryLine}>
          需兜底且有坐标 {summary.fallbackWithLocation} 张，其中落在午夜前后{' '}
          {summary.fallbackNearMidnightWithLocation} 张。
          {summary.impliedTotal > 0
            ? ` 反推偏移与设备偏移一致 ${summary.impliedMatchesDevice}/${summary.impliedTotal} 张。`
            : ''}
        </Text>
        <View
          style={[
            styles.verdict,
            summary.verdictLevel === 'worth'
              ? styles.verdictWarn
              : summary.verdictLevel === 'need-data'
                ? styles.verdictInfo
                : styles.verdictCalm,
          ]}>
          <Text style={styles.verdictText}>{summary.verdict}</Text>
        </View>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => setFilter(item.key)}
            style={[styles.filterChip, filter === item.key && styles.filterChipActive]}>
            <Text
              style={[styles.filterText, filter === item.key && styles.filterTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.actionRow}>
        <Pressable
          style={[styles.actionButton, pendingExif.length === 0 && styles.actionDisabled]}
          disabled={pendingExif.length === 0 || batch !== null}
          onPress={() => void readBatch(pendingExif.map((s) => ({ id: s.id })))}>
          <Text style={styles.actionButtonText}>
            {batch
              ? `读取 EXIF ${batch.done}/${batch.total}`
              : `读取本页 EXIF（${pendingExif.length}）`}
          </Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={() => void share()}>
          <Text style={styles.actionButtonText}>分享汇总</Text>
        </Pressable>
      </View>

      <Text style={styles.hint}>
        读 EXIF 每张都要导出一次原图，iCloud 上的照片会真的开始下载，所以默认不读。
        建议只挑 5 类样本各读一张：普通本地、海外午夜前后、截图、社交软件保存、视频。
        上方「读取本页 EXIF」会把当前筛选下没读过的全读一遍，慢是正常的。
      </Text>

      {error ? (
        <View style={styles.noticeDanger}>
          <Text style={styles.noticeDangerText}>{error}</Text>
        </View>
      ) : null}

      {visible.length === 0 && assets.length > 0 ? (
        <Text style={styles.hint}>当前筛选下没有样本。换一个筛选，或继续读下一批。</Text>
      ) : null}
    </View>
  );

  const renderFooter = () => {
    if (granted !== true) return null;
    if (loadingPage) {
      return (
        <View style={styles.footer}>
          <ActivityIndicator color={colors.textTertiary} />
          <Text style={styles.footerText}>正在读取下一批元数据…</Text>
        </View>
      );
    }
    if (!hasMore) {
      return (
        <View style={styles.footer}>
          <Text style={styles.footerText}>已到相册末尾</Text>
        </View>
      );
    }
    return (
      <View style={styles.footer}>
        <Pressable onPress={() => void loadNext()} style={styles.loadMore}>
          <Text style={styles.loadMoreText}>读取下一批（{PAGE_SIZE} 条元数据）</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.navRow}>
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
        <View style={styles.navText}>
          <Text style={styles.title}>日期口径</Text>
          <Text style={styles.subtitle}>只记录事实，不改任何数据</Text>
        </View>
      </View>

      {granted === null ? (
        <View style={styles.centerBlock}>
          <ActivityIndicator color={colors.textTertiary} />
          <Text style={styles.centerText}>正在读取权限…</Text>
        </View>
      ) : granted === false ? (
        <View style={styles.centerBlock}>
          <Text style={styles.centerTitle}>没有相册权限</Text>
          <Text style={styles.centerText}>
            这一页要用真实照片的拍摄时间和 EXIF 才能验证口径。先回相册页授权。
          </Text>
          <Pressable style={styles.primaryButton} onPress={() => router.replace('/library')}>
            <Text style={styles.primaryButtonText}>去相册页</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          renderItem={renderRow}
          ListHeaderComponent={renderHeader()}
          ListFooterComponent={renderFooter() ?? undefined}
          contentContainerStyle={{
            paddingHorizontal: layout.screenPadding,
            paddingBottom: insets.bottom + spacing.xxl,
          }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  navRow: {
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
  navText: { flex: 1, gap: 1 },
  title: { ...typography.title2, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textTertiary },

  headerBlock: { gap: spacing.md, paddingBottom: spacing.md },
  goalCard: {
    backgroundColor: colors.backgroundGrouped,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  goalTitle: { ...typography.footnote, color: colors.textPrimary, fontWeight: '600' },
  goalBody: { ...typography.caption, color: colors.textSecondary, lineHeight: 19 },

  summaryCard: { gap: spacing.sm },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  stat: {
    minWidth: 72,
    flexGrow: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.backgroundGrouped,
    gap: 1,
  },
  statValue: { ...typography.headline, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  statLabel: { ...typography.caption2, color: colors.textTertiary },
  summaryLine: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },

  verdict: { borderRadius: radius.md, padding: spacing.md },
  verdictWarn: { backgroundColor: colors.warningMuted },
  verdictInfo: { backgroundColor: colors.accentMuted },
  verdictCalm: { backgroundColor: colors.backgroundGrouped },
  verdictText: { ...typography.caption, color: colors.textPrimary, lineHeight: 19 },

  filterRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundGrouped,
  },
  filterChipActive: { backgroundColor: colors.textPrimary },
  filterText: { ...typography.caption, color: colors.textSecondary },
  filterTextActive: { color: colors.textOnMedia, fontWeight: '600' },

  actionRow: { flexDirection: 'row', gap: spacing.sm },
  actionButton: {
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundGrouped,
  },
  actionDisabled: { opacity: 0.45 },
  actionButtonText: { ...typography.footnote, color: colors.textPrimary },

  hint: { ...typography.caption, color: colors.textTertiary, lineHeight: 17 },

  row: {
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    gap: 3,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  rowDate: {
    ...typography.headline,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
    marginRight: spacing.xxs,
  },
  chip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  chipText: { ...typography.caption2, fontWeight: '600' },
  rowMeta: { ...typography.caption2, color: colors.textSecondary, lineHeight: 16 },
  rowReason: { ...typography.caption, color: colors.textPrimary, lineHeight: 18 },
  rowWarn: { ...typography.caption2, color: colors.warning, lineHeight: 16 },
  evidenceBox: {
    backgroundColor: colors.backgroundGrouped,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: 2,
    marginTop: 2,
  },
  evidenceLine: { ...typography.caption2, color: colors.textSecondary, lineHeight: 15 },
  rowActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  miniButton: {
    minHeight: 28,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundGrouped,
  },
  miniButtonText: { ...typography.caption2, color: colors.textPrimary },
  miniBusy: {
    minHeight: 28,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },

  footer: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.lg },
  footerText: { ...typography.caption, color: colors.textTertiary },
  loadMore: {
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundGrouped,
  },
  loadMoreText: { ...typography.callout, color: colors.textPrimary },

  noticeDanger: {
    backgroundColor: colors.dangerMuted,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  noticeDangerText: { ...typography.caption, color: colors.danger, lineHeight: 17 },

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
});

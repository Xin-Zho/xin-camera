import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { describeEpoch, describeUnit, formatOffset } from '@/src/library/epoch';
import { exifTopLevelKeys, extractExifTimeFields } from '@/src/library/exif';
import { readAssetDetail, readAssetExif } from '@/src/library/reader';
import type { AssetDetail } from '@/src/library/reader';
import type { LibraryLocation, RawEpoch } from '@/src/library/types';
import { colors, layout, radius, spacing, typography } from '@/src/theme';

/**
 * 原始值检查页。
 *
 * 存在的理由：这一轮不生成到访和故事，只回答一个问题——系统到底给了什么。
 * 所以这一页不做任何美化性换算，原始数值、判定出的单位、UTC、设备本地时间并排列出来，
 * 让人能自己看出「原生有没有提供拍摄地时区」这件事。
 */

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : JSON.stringify(error);
}

function locationText(location: LibraryLocation): { label: string; detail: string } {
  switch (location.kind) {
    case 'value':
      return {
        label: '有定位',
        detail: `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`,
      };
    case 'missing':
      return { label: '无定位', detail: '系统读到了这个资产，但它没有关联位置信息' };
    case 'error':
      return { label: '读取失败', detail: location.message };
    default:
      return { label: '未读取', detail: '—' };
  }
}

function Field({
  label,
  value,
  hint,
  selectable = true,
}: {
  label: string;
  value: string;
  hint?: string;
  selectable?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} selectable={selectable}>
        {value}
      </Text>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

function EpochBlock({ title, value }: { title: string; value: RawEpoch }) {
  const info = describeEpoch(value);
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Field label="原生原始值" value={value.raw === null ? 'null' : `${value.raw}`} />
      <Field
        label="单位判定"
        value={describeUnit(value.unit)}
        hint="expo-media-library 的类型注释写「秒」，iOS 实现返回毫秒。这里按数值量级判定，不做默认换算。"
        selectable={false}
      />
      {info.resolvable ? (
        <>
          <Field label="换算为 UTC" value={info.utcISO ?? '—'} />
          <Field
            label="按设备时区解释"
            value={info.deviceLocalISO ?? '—'}
            hint={
              info.deviceOffsetMinutes === null
                ? undefined
                : `设备当前偏移 ${formatOffset(info.deviceOffsetMinutes)}。这是这台设备现在的时区，不是拍摄地的时区。`
            }
            selectable={false}
          />
        </>
      ) : (
        <Text style={styles.fieldWarn}>这个值换算不出日期，页面不做猜测。</Text>
      )}
    </View>
  );
}

export default function InspectScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exif, setExif] = useState<Record<string, unknown> | null>(null);
  const [exifLoading, setExifLoading] = useState(false);
  const [exifError, setExifError] = useState<string | null>(null);

  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    if (!id) {
      setError('没有拿到资产 id');
      return;
    }
    void (async () => {
      try {
        const result = await readAssetDetail(id);
        if (!cancelled.current) setDetail(result);
      } catch (detailError) {
        if (!cancelled.current) setError(messageOf(detailError));
      }
    })();
    return () => {
      cancelled.current = true;
    };
  }, [id]);

  const loadExif = useCallback(async () => {
    if (!id) return;
    setExifLoading(true);
    setExifError(null);
    try {
      const result = await readAssetExif(id);
      if (!cancelled.current) setExif(result);
    } catch (exifLoadError) {
      if (!cancelled.current) setExifError(messageOf(exifLoadError));
    } finally {
      if (!cancelled.current) setExifLoading(false);
    }
  }, [id]);

  const location = detail ? locationText(detail.location) : null;
  const exifTimeFields = exif ? extractExifTimeFields(exif) : [];

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{
        paddingTop: insets.top + spacing.sm,
        paddingBottom: insets.bottom + spacing.xxl,
      }}
      showsVerticalScrollIndicator={false}>
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
          <Text style={styles.title}>原始字段</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {detail?.info.filename ?? id ?? ''}
          </Text>
        </View>
      </View>

      {error ? (
        <View style={styles.noticeDanger}>
          <Text style={styles.noticeDangerText}>{error}</Text>
        </View>
      ) : null}

      {!detail && !error ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator color={colors.textTertiary} />
          <Text style={styles.loadingText}>正在读取资产信息…</Text>
        </View>
      ) : null}

      {detail ? (
        <View style={styles.sections}>
          <EpochBlock title="拍摄时间" value={detail.creationTime} />
          <EpochBlock title="修改时间" value={detail.modificationTime} />

          <View style={styles.card}>
            <Text style={styles.cardTitle}>定位</Text>
            <Field label="状态" value={location?.label ?? '—'} selectable={false} />
            <Field label="坐标" value={location?.detail ?? '—'} />
            <Text style={styles.fieldHint}>
              iOS 只暴露经纬度，没有海拔、没有采集时间、没有拍摄地时区。
              所以「这张照片是在哪个时区拍的」无法从相册 API 直接得到。
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>文件</Text>
            <Field label="媒体类型" value={detail.info.mediaType} selectable={false} />
            <Field
              label="尺寸"
              value={
                detail.info.width && detail.info.height
                  ? `${detail.info.width} × ${detail.info.height}`
                  : '系统未提供'
              }
            />
            <Field
              label="时长"
              value={
                detail.info.durationMs === null || detail.info.durationMs === 0
                  ? '—'
                  : `${detail.info.durationMs} ms`
              }
            />
            <Field
              label="子类型"
              value={detail.subtypes.length > 0 ? detail.subtypes.join(', ') : '无'}
            />
            <Field label="收藏" value={detail.isFavorite ? '是' : '否'} selectable={false} />
            {detail.failures.length > 0 ? (
              <Text style={styles.fieldWarn}>部分字段读取失败：{detail.failures.join('；')}</Text>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>EXIF 时间字段</Text>
            <Text style={styles.fieldHint}>
              只有 EXIF 里可能残留拍摄地时区偏移（OffsetTimeOriginal 之类）。
              读取代价高：iOS 会把当前版本导出成临时文件再解析，iCloud 资产还会触发下载。
              所以只在点按的时候读，不进列表循环。
            </Text>

            {exif ? (
              exifTimeFields.length > 0 ? (
                exifTimeFields.map((field) => (
                  <Field key={field.path} label={field.path} value={field.value} />
                ))
              ) : (
                <Text style={styles.fieldWarn}>
                  读到了 EXIF，但没有时间/时区相关字段。顶层分组：
                  {exifTopLevelKeys(exif).join(', ') || '（空）'}
                </Text>
              )
            ) : null}

            {exifError ? <Text style={styles.fieldWarn}>读取失败：{exifError}</Text> : null}

            <Pressable
              style={styles.secondaryButton}
              disabled={exifLoading}
              onPress={() => void loadExif()}>
              <Text style={styles.secondaryButtonText}>
                {exifLoading ? '正在读取…' : exif ? '重新读取 EXIF' : '读取 EXIF'}
              </Text>
            </Pressable>
          </View>

          <Text style={styles.footer}>
            这一页只读。看完返回相册列表，不会留下任何修改。
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.backgroundGrouped },
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
  sections: { paddingHorizontal: layout.screenPadding, gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xxs },
  field: { gap: 2 },
  fieldLabel: { ...typography.caption2, color: colors.textTertiary, letterSpacing: 0.4 },
  fieldValue: {
    ...typography.footnote,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  fieldHint: { ...typography.caption, color: colors.textTertiary, lineHeight: 17 },
  fieldWarn: { ...typography.caption, color: colors.warning, lineHeight: 17 },
  noticeDanger: {
    backgroundColor: colors.dangerMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.md,
  },
  noticeDangerText: { ...typography.caption, color: colors.danger, lineHeight: 17 },
  loadingBlock: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xxl,
  },
  loadingText: { ...typography.caption, color: colors.textTertiary },
  secondaryButton: {
    alignSelf: 'flex-start',
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundGrouped,
    marginTop: spacing.xxs,
  },
  secondaryButtonText: { ...typography.callout, color: colors.textPrimary },
  footer: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: spacing.md,
    marginLeft: spacing.xs,
    lineHeight: 17,
  },
});

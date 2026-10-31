import { useMemo, useState } from 'react';
import { Dimensions, Image, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveDisplaySource } from '@/src/data';
import type { MediaAsset } from '@/src/domain/types';
import PhotoViewer from '@/src/components/viewer/PhotoViewer';
import { useAppStore } from '@/src/store/appStore';
import { colors, layout, radius, spacing, typography } from '@/src/theme';

// 与到访图库同一套照片墙参数：近无缝间距（Ente galleryGridSpacing=1 的精神）让照片当主角
const COLUMNS = 3;
const GAP = 2;
// 苹果相册：照片墙通铺到屏幕边缘，不留页边距
const TILE = Math.floor((Dimensions.get('window').width - GAP * (COLUMNS - 1)) / COLUMNS);

export default function LibraryTabScreen() {
  const insets = useSafeAreaInsets();
  const media = useAppStore((s) => s.media);

  /** 回收站里的（removedAt）不进图库，它们有自己的页面 */
  const items = useMemo(
    () =>
      media
        .filter((item) => !item.removedAt)
        .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()),
    [media],
  );

  /**
   * 按月分组（苹果相册的「月」颗粒）。归属日用 dateKey（导入时固定），
   * 没有的回落 capturedAt——示例数据没这层。
   */
  const sections = useMemo(() => {
    const byMonth = new Map<string, MediaAsset[]>();
    items.forEach((item) => {
      const dayKey = item.dateKey ?? item.capturedAt.slice(0, 10);
      const month = dayKey.slice(0, 7); // YYYY-MM
      const bucket = byMonth.get(month);
      if (bucket) bucket.push(item);
      else byMonth.set(month, [item]);
    });
    return Array.from(byMonth.entries()).map(([month, list]) => {
      const [year, m] = month.split('-');
      const rows: MediaAsset[][] = [];
      for (let i = 0; i < list.length; i += COLUMNS) {
        rows.push(list.slice(i, i + COLUMNS));
      }
      // SectionList 只认 data 字段（item 即一行照片）；label/key 是自定义挂载
      return { key: month, label: `${year}年${Number(m)}月`, data: rows };
    });
  }, [items]);

  /** 点击任意一张 → 全屏查看器，翻页范围是整个图库（跨月连续） */
  const indexById = useMemo(() => new Map(items.map((item, i) => [item.id, i])), [items]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>图库</Text>
        <Text style={styles.count}>{items.length > 0 ? `${items.length} 张` : ''}</Text>
      </View>

      <SectionList<MediaAsset[], { key: string; label: string; data: MediaAsset[][] }>
        sections={sections}
        keyExtractor={(row) => row.map((item) => item.id).join('|')}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionLabel}>{section.label}</Text>
        )}
        renderItem={({ item: row }) => (
          <View style={styles.row}>
            {row.map((item) => (
              <Pressable
                key={item.id}
                style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
                onPress={() => setViewerIndex(indexById.get(item.id) ?? null)}
                accessibilityRole="imagebutton"
                accessibilityLabel="查看这张照片">
                <TileImage item={item} />
              </Pressable>
            ))}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>还没有照片</Text>
            <Text style={styles.emptyText}>
              从「相册」页导入的照片，还有示例回忆，都会出现在这里。
            </Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
      />

      {viewerIndex !== null && items.length > 0 ? (
        <PhotoViewer
          items={items}
          initialIndex={Math.min(viewerIndex, items.length - 1)}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </View>
  );
}

/** 填不满一行的最后几张：仍然按格宽排，右侧留白——与苹果相册一致 */
function TileImage({ item }: { item: MediaAsset }) {
  const source = resolveDisplaySource(item);
  return (
    <View style={styles.tileInner}>
      {source ? (
        <Image source={source} style={styles.tileImage} resizeMode="cover" />
      ) : (
        <View style={styles.tileFallback} />
      )}
      {item.kind === 'video' ? (
        <View style={styles.videoBadge}>
          <SymbolView
            name={{ ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }}
            tintColor={colors.textOnMedia}
            size={10}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    paddingHorizontal: layout.screenPadding,
    marginBottom: spacing.md,
  },
  title: { ...typography.largeTitle, color: colors.textPrimary },
  count: { ...typography.footnote, color: colors.textSecondary },
  sectionLabel: {
    ...typography.headline,
    color: colors.textPrimary,
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  // 行间留 GAP：SectionList 的 item 就是一行，行距在这里补
  row: { flexDirection: 'row', gap: GAP, marginBottom: GAP },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: radius.xxs,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  tilePressed: { transform: [{ scale: 0.96 }] },
  tileInner: { width: '100%', height: '100%', backgroundColor: colors.mediaPlaceholder },
  tileImage: { width: '100%', height: '100%' },
  tileFallback: { flex: 1, backgroundColor: colors.mediaPlaceholder },
  videoBadge: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.videoBadge,
  },
  emptyBox: { paddingVertical: spacing.xxl, gap: spacing.xs, paddingHorizontal: layout.screenPadding },
  emptyTitle: { ...typography.headline, color: colors.textPrimary },
  emptyText: { ...typography.callout, color: colors.textSecondary },
});

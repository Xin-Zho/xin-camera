import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo } from 'react';
import {
  Alert,
  Dimensions,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveDisplaySource } from '@/src/data';
import type { MediaAsset } from '@/src/domain/types';
import { selectRemovedMedia, selectVisibility } from '@/src/store/selectors';
import { useAppStore } from '@/src/store/appStore';
import { colors, layout, radius, spacing, typography } from '@/src/theme';
import { dayLabelOf } from '@/src/utils/datetime';

const COLUMNS = 3;
const GAP = 3;
const SCREEN_WIDTH = Dimensions.get('window').width;
const TILE = Math.floor((SCREEN_WIDTH - layout.screenPadding * 2 - GAP * (COLUMNS - 1)) / COLUMNS);

/**
 * 已移除的照片（App 内回收站）。
 *
 * 为什么单独一页而不是只放在到访图库里：
 *   图库是"按到访看照片"的地方。如果某次到访的照片全被移除，那张到访卡片就从地点页消失了，
 *   用户再也进不去那个图库——等于把恢复入口一起藏了。这页不看归属，任何被移除的照片都能恢复。
 *
 * 这里**只读本地状态**，不访问系统相册：移除从来没有动过 iPhone 上的原图，
 * 所以恢复也不需要向系统要权限。
 */
export default function RemovedMediaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const media = useAppStore((s) => s.media);
  const stories = useAppStore((s) => s.stories);
  const visits = useAppStore((s) => s.visits);
  const restoreMedia = useAppStore((s) => s.restoreMedia);

  const visibility = useMemo(() => selectVisibility(media, stories), [stories, media]);
  const removed = useMemo(() => selectRemovedMedia(media, visibility), [media, visibility]);

  const visitById = useMemo(() => new Map(visits.map((v) => [v.id, v])), [visits]);

  const handleRestoreAll = useCallback(() => {
    if (removed.length === 0) return;
    Alert.alert(
      '恢复全部照片',
      `这 ${removed.length} 张会回到它们原来的故事、地点和时间轴上，顺序不变。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '恢复',
          onPress: () => restoreMedia(removed.map((item) => item.id)),
        },
      ],
    );
  }, [removed, restoreMedia]);

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
          <Text style={styles.title}>已移除的照片</Text>
          <Text style={styles.meta}>
            {removed.length > 0 ? `${removed.length} 张 · 只在本 App 内隐藏` : '这里空着'}
          </Text>
        </View>
        {removed.length > 0 ? (
          <Pressable onPress={handleRestoreAll} hitSlop={10}>
            <Text style={styles.selectToggle}>恢复全部</Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={removed}
        keyExtractor={(item) => item.id}
        numColumns={COLUMNS}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={{
          gap: GAP,
          paddingHorizontal: layout.screenPadding,
          paddingTop: spacing.md,
          paddingBottom: insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          removed.length > 0 ? (
            <Text style={styles.sectionLabel}>
              iPhone 系统相册里的原图一直都在，恢复不会重新导入，也不会改动已有的编辑。
            </Text>
          ) : undefined
        }
        renderItem={({ item }) => (
          <RemovedTile
            item={item}
            meta={describeWhere(item, visitById)}
            onRestore={() => restoreMedia([item.id])}
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>没有被移除的照片</Text>
            <Text style={styles.emptyText}>
              在到访图库里长按照片，或者右上角「选择」多选后，就能从回忆相册移除。
            </Text>
          </View>
        }
      />
    </View>
  );
}

/** 这张照片原来属于哪一天哪次到访。给"我到底移除了什么"一点上下文 */
function describeWhere(item: MediaAsset, visitById: Map<string, { startAt: string; dateKey?: string }>): string {
  const visit = item.visitId ? visitById.get(item.visitId) : undefined;
  if (!visit) return dayLabelOf({ startAt: item.capturedAt, dateKey: item.dateKey });
  return dayLabelOf(visit);
}

function RemovedTile({
  item,
  meta,
  onRestore,
}: {
  item: MediaAsset;
  meta: string;
  onRestore: () => void;
}) {
  return (
    <View style={[styles.tile, { width: TILE, height: TILE }]}>
      <Image
        source={resolveDisplaySource(item)}
        style={styles.tileImage}
        resizeMode="cover"
      />
      <View style={styles.tileScrim} pointerEvents="none" />
      <Text style={styles.tileMeta} numberOfLines={1}>
        {meta}
      </Text>
      <Pressable
        onPress={onRestore}
        style={styles.restorePill}
        hitSlop={6}
        accessibilityLabel="恢复这张照片">
        <Text style={styles.restorePillText}>恢复</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  backButton: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: layout.minTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundGrouped,
  },
  headerText: { flex: 1, gap: 1 },
  title: { ...typography.title2, color: colors.textPrimary },
  meta: { ...typography.footnote, color: colors.textTertiary },
  selectToggle: { ...typography.callout, color: colors.accent, fontWeight: '600' },
  sectionLabel: {
    ...typography.caption,
    color: colors.textTertiary,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  tile: {
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.mediaPlaceholder,
  },
  tileImage: { width: '100%', height: '100%', opacity: 0.55 },
  tileScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '42%',
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  tileMeta: {
    position: 'absolute',
    left: 5,
    bottom: 26,
    right: 5,
    ...typography.caption2,
    color: 'rgba(255,255,255,0.86)',
  },
  restorePill: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTranslucent,
  },
  restorePillText: { ...typography.caption2, color: colors.textPrimary },
  emptyBox: { paddingVertical: spacing.xxl, gap: spacing.xs },
  emptyTitle: { ...typography.headline, color: colors.textPrimary },
  emptyText: { ...typography.callout, color: colors.textSecondary, lineHeight: 21 },
});

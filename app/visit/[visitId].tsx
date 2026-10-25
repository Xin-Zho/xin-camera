import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Dimensions, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveMediaSource } from '@/src/data';
import type { MediaAsset } from '@/src/domain/types';
import {
  selectMediaOfVisit,
  selectPlaceById,
  selectVisitById,
} from '@/src/store/selectors';
import { useAppStore } from '@/src/store/appStore';
import { colors, layout, radius, spacing, typography } from '@/src/theme';
import { formatClock, formatDayFull, formatWeekday, partOfDay } from '@/src/utils/datetime';

const COLUMNS = 3;
const GAP = 3;
const SCREEN_WIDTH = Dimensions.get('window').width;
const TILE = Math.floor((SCREEN_WIDTH - layout.screenPadding * 2 - GAP * (COLUMNS - 1)) / COLUMNS);

export default function VisitGalleryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { visitId } = useLocalSearchParams<{ visitId: string }>();

  const visits = useAppStore((s) => s.visits);
  const places = useAppStore((s) => s.places);
  const media = useAppStore((s) => s.media);
  const stories = useAppStore((s) => s.stories);

  const visit = selectVisitById(visits, visitId ?? null);
  const place = visit ? selectPlaceById(places, visit.placeId) : undefined;
  const items = useMemo(
    () => (visit ? selectMediaOfVisit(media, visit) : []),
    [media, visit],
  );

  /**
   * 这次到访对应的那本故事（规格 §7.2：一次到访一本）。
   * 到访若已被合并进合集，合集自己的 visitIds 里也有它，所以这里会直接落到合集上，
   * 用户能看出"这次到访已经被并进某本合集"。
   */
  const linkedStory = useMemo(
    () =>
      stories.find(
        (s) => !s.isDeleted && !s.mergedIntoStoryId && s.visitIds.includes(visitId ?? ''),
      ),
    [stories, visitId],
  );

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
          <Text style={styles.title} numberOfLines={1}>
            {visit ? `${formatDayFull(visit.startAt)} ${partOfDay(visit.startAt)}` : '图库'}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {place?.name ?? ''}
            {visit ? ` · ${formatClock(visit.startAt)} – ${formatClock(visit.endAt)}` : ''}
            {visit ? ` · ${formatWeekday(visit.startAt)}` : ''}
          </Text>
        </View>
      </View>

      {/* 把「到访 → 故事」这一环接上：不用切回故事 tab 再凭日期找 */}
      {linkedStory ? (
        <Pressable
          onPress={() =>
            router.push({
              pathname: '/story/[storyId]',
              params: { storyId: linkedStory.id },
            })
          }
          style={({ pressed }) => [styles.storyLink, pressed && styles.storyLinkPressed]}
          accessibilityLabel={`打开故事 ${linkedStory.title}`}>
          <SymbolView
            name={{ ios: 'book', android: 'menu_book', web: 'menu_book' }}
            tintColor={colors.accent}
            size={13}
          />
          <Text style={styles.storyLinkText} numberOfLines={1}>
            {linkedStory.title}
          </Text>
          <Text style={styles.storyLinkChevron}>›</Text>
        </Pressable>
      ) : null}

      <FlatList
        data={items}
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
          <Text style={styles.sectionLabel}>
            这次到访 · {items.length} 张
            {items.some((m) => m.kind === 'video')
              ? ` · ${items.filter((m) => m.kind === 'video').length} 段视频`
              : ''}
          </Text>
        }
        renderItem={({ item }) => <GalleryTile item={item} />}
        ListEmptyComponent={<Text style={styles.empty}>这次到访没有留下媒体。</Text>}
      />
    </View>
  );
}

function GalleryTile({ item }: { item: MediaAsset }) {
  const source = resolveMediaSource(item.uri);
  const isPortrait = item.height > item.width;
  return (
    <View style={[styles.tile, { width: TILE, height: TILE }]}>
      {source ? (
        <Image source={source} style={styles.tileImage} resizeMode="cover" />
      ) : (
        <View style={styles.tileFallback} />
      )}
      {isPortrait ? <View style={styles.portraitHint} /> : null}
      {item.kind === 'video' ? (
        <View style={styles.videoBadge}>
          <SymbolView
            name={{ ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }}
            tintColor={colors.textOnMedia}
            size={10}
          />
          <Text style={styles.videoText}>视频</Text>
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
  sectionLabel: {
    ...typography.caption2,
    color: colors.textTertiary,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  storyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: layout.screenPadding,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accentMuted,
  },
  storyLinkPressed: { opacity: 0.6 },
  storyLinkText: { ...typography.footnote, color: colors.accent, flex: 1 },
  storyLinkChevron: { ...typography.callout, color: colors.accent },
  tile: {
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.mediaPlaceholder,
  },
  tileImage: { width: '100%', height: '100%' },
  tileFallback: { flex: 1, backgroundColor: colors.mediaPlaceholder },
  portraitHint: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 8,
    height: 12,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  videoBadge: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.videoBadge,
  },
  videoText: { ...typography.caption2, fontSize: 9, color: colors.textOnMedia },
  empty: { ...typography.callout, color: colors.textSecondary, paddingVertical: spacing.xxl },
});

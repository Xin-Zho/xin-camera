import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { resolveMediaSource } from '@/src/data';
import type { MediaAsset, Place, Story } from '@/src/domain/types';
import { colors, radius, spacing, typography } from '@/src/theme';
import { formatDay, formatVisitRange } from '@/src/utils/datetime';

/**
 * 杂志封面式故事卡片（规格 §5.5）。
 * coverTitleMode 决定标题叠在照片上还是放在照片下方留白处；
 * 原型阶段用预设值模拟，不做真实构图分析。
 */
interface Props {
  story: Story;
  places: Place[];
  media: MediaAsset[];
  onPress?: () => void;
  /** 选择模式：卡片不再进阅读页，点击只切换选中 */
  selectable?: boolean;
  selected?: boolean;
  onLongPress?: () => void;
}

export function StoryCoverCard({
  story,
  places,
  media,
  onPress,
  selectable = false,
  selected = false,
  onLongPress,
}: Props) {
  const cover = useMemo(
    () => media.find((m) => m.id === story.coverMediaId),
    [media, story.coverMediaId],
  );
  const placeLabel = useMemo(() => {
    const names = story.placeIds
      .map((id) => places.find((p) => p.id === id)?.name)
      .filter((n): n is string => Boolean(n));
    if (names.length === 0) return '未知地点';
    if (names.length === 1) return names[0];
    return `${names[0]} 等 ${names.length} 处`;
  }, [places, story.placeIds]);

  const meta = useMemo(() => {
    const range =
      formatDay(story.startAt) === formatDay(story.endAt)
        ? formatDay(story.startAt)
        : `${formatDay(story.startAt)} – ${formatDay(story.endAt)}`;
    const videos = story.mediaIds.filter((id) => media.find((m) => m.id === id)?.kind === 'video')
      .length;
    const countLabel = videos > 0 ? `${story.mediaIds.length} 张 · ${videos} 段视频` : `${story.mediaIds.length} 张`;
    return `${range} · ${countLabel}`;
  }, [media, story]);

  const isOverlay = story.coverTitleMode === 'overlay';

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={320}
      style={styles.card}
      disabled={!onPress && !onLongPress}
      accessibilityLabel={selectable ? `${story.title}${selected ? '，已选中' : ''}` : story.title}>
      <View style={[styles.mediaWrap, selected && styles.mediaWrapSelected]}>
        {cover ? (
          <Image source={resolveMediaSource(cover.uri)} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.imageFallback} />
        )}

        {isOverlay ? (
          <View style={styles.overlayLayer} pointerEvents="none">
            <View style={styles.scrimStrong} />
            <View style={styles.scrimSoft} />
            <View style={styles.overlayTextWrap}>
              <Text style={styles.overlayTitle} numberOfLines={2}>
                {story.title}
              </Text>
              <Text style={styles.overlayMeta} numberOfLines={1}>
                {placeLabel} · {meta}
              </Text>
            </View>
          </View>
        ) : null}

        {story.mergedFromStoryIds?.length ? (
          <View style={styles.mergeBadge}>
            <Text style={styles.mergeBadgeText}>
              已合并 {story.mergedFromStoryIds.length} 本
            </Text>
          </View>
        ) : null}

        {selectable ? (
          <View style={[styles.selectDot, selected && styles.selectDotOn]}>
            {selected ? (
              <SymbolView
                name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                tintColor={colors.textOnMedia}
                size={12}
              />
            ) : null}
          </View>
        ) : null}
      </View>

      {!isOverlay ? (
        <View style={styles.belowWrap}>
          <Text style={styles.belowTitle} numberOfLines={2}>
            {story.title}
          </Text>
          <Text style={styles.belowMeta} numberOfLines={1}>
            {placeLabel} · {meta}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.xxl,
  },
  mediaWrap: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: radius.media,
    overflow: 'hidden',
    backgroundColor: colors.mediaPlaceholder,
  },
  // 选中描边画在容器内侧，不会改变卡片占位，列表不会因此跳动
  mediaWrapSelected: { borderWidth: 2, borderColor: colors.accent },
  selectDot: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.9)',
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectDotOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  image: { width: '100%', height: '100%' },
  imageFallback: { flex: 1, backgroundColor: colors.mediaPlaceholder },
  overlayLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'flex-end',
  },
  scrimSoft: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '42%',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  scrimStrong: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '24%',
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  overlayTextWrap: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  overlayTitle: { ...typography.title, color: colors.textOnMedia },
  overlayMeta: { ...typography.footnote, color: 'rgba(255,255,255,0.86)' },
  belowWrap: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.xxs,
    gap: spacing.xxs,
  },
  belowTitle: { ...typography.title2, color: colors.textPrimary },
  belowMeta: { ...typography.footnote, color: colors.textSecondary },
  mergeBadge: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTranslucent,
  },
  mergeBadgeText: { ...typography.caption2, color: colors.textPrimary },
});

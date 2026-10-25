import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveMediaSource } from '@/src/data';
import type { MediaAsset, Story } from '@/src/domain/types';
import { selectStoryById } from '@/src/store/selectors';
import { useAppStore } from '@/src/store/appStore';
import { colors, editorialTypography, layout, radius, spacing, typography } from '@/src/theme';
import { formatDay, formatDayFull, formatWeekday, partOfDay } from '@/src/utils/datetime';
import { fitWithin, maxReaderMediaHeight } from '@/src/utils/mediaFit';

/** 把故事媒体按版式切成"行"，每行是全宽图或两张并排 */
type MediaRow =
  | { kind: 'full'; item: MediaAsset }
  | { kind: 'pair'; items: MediaAsset[] };

function buildRows(story: Story, items: MediaAsset[]): MediaRow[] {
  if (items.length === 0) return [];
  const highlighted = new Set(story.highlightedMediaIds);

  if (story.layout === 'grid') {
    const rows: MediaRow[] = [];
    for (let i = 0; i < items.length; i += 2) {
      rows.push({ kind: 'pair', items: items.slice(i, i + 2) });
    }
    return rows;
  }

  if (story.layout === 'large-cover') {
    return items.map((item) => ({ kind: 'full' as const, item }));
  }

  // editorial：封面永远全宽开场；之后被标为重点的照片单独占满一行，
  // 其余两两并排。星标因此不是看不见的元数据——编辑完回阅读页能直接看出节奏变化。
  const rows: MediaRow[] = [{ kind: 'full', item: items[0] }];
  let buffer: MediaAsset[] = [];
  const flush = () => {
    for (let i = 0; i < buffer.length; i += 2) {
      rows.push({ kind: 'pair', items: buffer.slice(i, i + 2) });
    }
    buffer = [];
  };

  items.slice(1).forEach((item) => {
    if (highlighted.has(item.id)) {
      flush();
      rows.push({ kind: 'full', item });
    } else {
      buffer.push(item);
    }
  });
  flush();
  return rows;
}

export default function StoryReaderScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { storyId } = useLocalSearchParams<{ storyId: string }>();

  // 用实时窗口尺寸，而不是模块级 Dimensions：横竖屏、分屏、不同机型都要算对。
  // 这张图能占多高完全由它决定，算错一截，图就会有一部分落在屏幕外。
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const contentWidth = Math.max(1, windowWidth - layout.screenPadding * 2);
  const halfWidth = Math.max(1, Math.floor((contentWidth - spacing.sm) / 2));
  const mediaBoxHeight = maxReaderMediaHeight(windowHeight);

  const stories = useAppStore((s) => s.stories);
  const media = useAppStore((s) => s.media);
  const places = useAppStore((s) => s.places);
  const splitStory = useAppStore((s) => s.splitStory);

  /**
   * 拆分后这本合集立刻从 store 里消失，但返回动画还要播三百毫秒。
   * 不留快照的话，整屏会在返回途中闪一下「这本故事不在了」。
   */
  const [leaving, setLeaving] = useState<Story | null>(null);
  const story = selectStoryById(stories, storyId ?? null) ?? leaving;

  const items = useMemo(() => {
    if (!story) return [];
    const index = new Map(media.map((m) => [m.id, m]));
    return story.mediaIds
      .map((id) => index.get(id))
      .filter((m): m is MediaAsset => Boolean(m));
  }, [media, story]);

  const rows = useMemo(() => (story ? buildRows(story, items) : []), [items, story]);
  const highlightedSet = useMemo(() => new Set(story?.highlightedMediaIds ?? []), [story]);

  const placeNames = useMemo(() => {
    if (!story) return '';
    return story.placeIds
      .map((id) => places.find((p) => p.id === id)?.name)
      .filter((n): n is string => Boolean(n))
      .join(' · ');
  }, [places, story]);

  if (!story) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.missing}>这本故事不在了。</Text>
      </View>
    );
  }

  const sameDay = formatDay(story.startAt) === formatDay(story.endAt);
  const mergedCount = story.mergedFromStoryIds?.length ?? 0;

  // 拆分会丢弃在合集上做的编辑（按快照还原源故事），所以必须确认一次
  const handleSplit = () => {
    Alert.alert(
      '拆开合集',
      `会还原成 ${mergedCount} 本独立故事，各自按合并前的标题、封面和照片顺序恢复。合并之后在这个合集里做的修改不会保留。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '拆分',
          style: 'destructive',
          onPress: () => {
            setLeaving(story);
            splitStory(story.id);
            router.back();
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{
        paddingTop: insets.top + spacing.sm,
        paddingBottom: insets.bottom + spacing.huge,
        paddingHorizontal: layout.screenPadding,
      }}
      showsVerticalScrollIndicator={false}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back()}
          style={styles.headerButton}
          hitSlop={8}
          accessibilityLabel="返回">
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            tintColor={colors.textPrimary}
            size={20}
          />
        </Pressable>
        <View style={styles.headerActions}>
          {mergedCount > 0 ? (
            <Pressable
              onPress={handleSplit}
              style={styles.editButton}
              hitSlop={8}
              accessibilityLabel={`把这个合集拆回 ${mergedCount} 本`}>
              <Text style={styles.editButtonText}>拆分</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() =>
              router.push({ pathname: '/story/[storyId]/edit', params: { storyId: story.id } })
            }
            style={styles.editButton}
            hitSlop={8}
            accessibilityLabel="编辑这本故事">
            <Text style={styles.editButtonText}>编辑</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.kicker}>
        {formatDayFull(story.startAt)} {formatWeekday(story.startAt)}{' '}
        {partOfDay(story.startAt)}
        {sameDay ? '' : ` – ${formatDay(story.endAt)}`}
      </Text>
      <Text style={styles.title}>{story.title}</Text>
      <Text style={styles.placeLine}>{placeNames}</Text>

      {story.userText ? <Text style={styles.userText}>{story.userText}</Text> : null}

      <View style={styles.rule} />

      <View style={styles.flow}>
        {rows.map((row, index) => {
          if (row.kind === 'full') {
            const source = resolveMediaSource(row.item.uri);
            // 等比缩进「整宽 × 半屏高」的盒子里。横图照旧铺满整宽，
            // 竖图缩到盒高以内、水平居中——宁可两边留白，也不让任何一边落在屏幕外。
            const box = fitWithin(row.item, contentWidth, mediaBoxHeight);
            return (
              <View
                key={`full-${row.item.id}-${index}`}
                style={[styles.fullBlock, { width: box.width, height: box.height }]}>
                <Image source={source} style={styles.fullImage} resizeMode="cover" />
                {row.item.kind === 'video' ? <VideoTag /> : null}
                {highlightedSet.has(row.item.id) ? <HighlightTag /> : null}
              </View>
            );
          }
          // 网格版式照片数为奇数时，最后一行只有一张：
          // 它占整宽，高度也必须按整宽算，不能再沿用半宽的比例——否则这张会被压成一条。
          const box =
            row.items.length === 1
              ? fitWithin(row.items[0], contentWidth, mediaBoxHeight)
              : null;
          return (
            <View key={`pair-${index}`} style={styles.pairRow}>
              {row.items.map((item) => {
                const source = resolveMediaSource(item.uri);
                const isWide = item.width >= item.height;
                return (
                  <View
                    key={item.id}
                    style={[styles.pairItem, { width: box ? box.width : halfWidth }]}>
                    <Image
                      source={source}
                      style={{
                        width: '100%',
                        // 半宽格子：矮图给一个不至于太扁的高度，高图按比例给到刚好不被裁
                        height: box
                          ? box.height
                          : isWide
                            ? halfWidth * 0.72
                            : halfWidth / (item.width / item.height),
                        borderRadius: radius.media,
                      }}
                      resizeMode="cover"
                    />
                    {item.kind === 'video' ? <VideoTag /> : null}
                    {highlightedSet.has(item.id) ? <HighlightTag /> : null}
                  </View>
                );
              })}
            </View>
          );
        })}
      </View>

      <Text style={styles.footer}>
        版式 ·{' '}
        {story.layout === 'editorial'
          ? '杂志交错'
          : story.layout === 'large-cover'
            ? '大图封面'
            : '网格'}
        {story.mergedFromStoryIds?.length
          ? ` · 由 ${story.mergedFromStoryIds.length} 本合并而成`
          : ''}
        {story.highlightedMediaIds.length > 0
          ? ` · 精选 ${story.highlightedMediaIds.length} 张`
          : ''}
      </Text>
    </ScrollView>
  );
}

function HighlightTag() {
  return (
    <View style={styles.highlightTag}>
      <Text style={styles.highlightTagText} allowFontScaling={false}>
        精选
      </Text>
    </View>
  );
}

function VideoTag() {
  return (
    <View style={styles.videoTag}>
      <SymbolView
        name={{ ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }}
        tintColor={colors.textOnMedia}
        size={9}
      />
      <Text style={styles.videoTagText}>视频</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  missing: { ...typography.callout, color: colors.textSecondary },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  headerButton: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: layout.minTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundGrouped,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  editButton: {
    height: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundGrouped,
  },
  editButtonText: { ...typography.footnote, color: colors.textPrimary, fontWeight: '600' },
  kicker: {
    ...typography.caption2,
    color: colors.textTertiary,
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  title: { ...editorialTypography.storyTitle, color: colors.textPrimary },
  placeLine: {
    ...typography.footnote,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  userText: {
    ...editorialTypography.body,
    color: colors.textPrimary,
    marginTop: spacing.lg,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginVertical: spacing.xl,
  },
  flow: { gap: spacing.sm },
  fullBlock: { alignSelf: 'center', marginBottom: spacing.sm, position: 'relative' },
  fullImage: { width: '100%', height: '100%', borderRadius: radius.media },
  // flex-start：让每个格子高度等于图片自身高度。默认 stretch 会把矮图那一格拉高，
  // 结果「视频 / 精选」角标贴在空白区底部而不是图片底部。
  pairRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  pairItem: { position: 'relative' },
  videoTag: {
    position: 'absolute',
    left: spacing.xs,
    bottom: spacing.xs + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.videoBadge,
  },
  videoTagText: { ...typography.caption2, fontSize: 9, color: colors.textOnMedia },
  highlightTag: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs + 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceTranslucent,
  },
  highlightTagText: { ...typography.caption2, fontSize: 9, color: colors.textPrimary },
  footer: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: spacing.xxl,
    textAlign: 'center',
  },
});

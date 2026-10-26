import { useMemo, useState } from 'react';
import {
  Dimensions,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { resolveMediaSource } from '@/src/data';
import type { MediaAsset, Place, Visit } from '@/src/domain/types';
import { colors, layout, radius, spacing, typography } from '@/src/theme';
import {
  formatClock,
  formatClockLiteral,
  formatDay,
  formatDayKey,
  partOfDay,
  partOfDayLiteral,
} from '@/src/utils/datetime';

/**
 * 地点到访卡片堆叠（规格 §5.4）。
 * 一张卡 = 一次到访，不是一张照片。当前选中的在最前面，
 * 后面的卡片只露出一点点边，暗示"这里还有别的到访"。
 */
interface Props {
  place: Place;
  visits: Visit[];
  media: MediaAsset[];
  onOpenVisit: (visitId: string) => void;
}

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_WIDTH = SCREEN_WIDTH - layout.screenPadding * 2 - 12;
const CARD_HEIGHT = Math.round(CARD_WIDTH * 1.24);
const STACK_GAP = 40;

export function VisitCardStack({ place, visits, media, onOpenVisit }: Props) {
  const [active, setActive] = useState(0);
  const mediaIndex = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderRelease: (_e, g) => {
          if (g.dx < -44) setActive((a) => Math.min(visits.length - 1, a + 1));
          else if (g.dx > 44) setActive((a) => Math.max(0, a - 1));
        },
      }),
    [visits.length],
  );

  if (visits.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>这里还没有到访记录。</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height: CARD_HEIGHT + STACK_GAP }]} {...pan.panHandlers}>
      {visits.map((visit, index) => {
        const depth = index - active;
        if (depth < 0 || depth > 3) {
          // 只渲染当前及后面 3 张，避免堆太深
          return null;
        }
        const cover = mediaIndex.get(visit.coverMediaId);
        const source = cover ? resolveMediaSource(cover.uri) : undefined;
        const videoCount = visit.mediaIds.filter(
          (id) => mediaIndex.get(id)?.kind === 'video',
        ).length;
        const isActive = depth === 0;
        // 导入的到访带 dateKey：日期、时段、时刻都按拍摄地口径显示，不看设备时区
        const dayLabel = visit.dateKey ? formatDayKey(visit.dateKey) : formatDay(visit.startAt);
        const partLabel = visit.dateKey
          ? partOfDayLiteral(visit.startAt)
          : partOfDay(visit.startAt);
        const clockOf = visit.dateKey ? formatClockLiteral : formatClock;

        return (
          <Pressable
            key={visit.id}
            onPress={() => {
              if (isActive) onOpenVisit(visit.id);
              else setActive(index);
            }}
            style={[
              styles.card,
              {
                zIndex: 100 - depth,
                transform: [
                  { translateY: depth * 14 },
                  { scale: 1 - depth * 0.035 },
                ],
                opacity: 1 - depth * 0.12,
              },
            ]}>
            {source ? (
              <Image source={source} style={styles.cardImage} resizeMode="cover" />
            ) : (
              <View style={styles.cardImageFallback} />
            )}

            <View style={styles.cardScrim} pointerEvents="none" />

            {isActive ? (
              <View style={styles.cardContent} pointerEvents="none">
                <Text style={styles.cardPlace} numberOfLines={1}>
                  {place.name}
                </Text>
                <Text style={styles.cardDate}>
                  {dayLabel} {partLabel}
                </Text>
                <Text style={styles.cardMeta}>
                  {clockOf(visit.startAt)} – {clockOf(visit.endAt)} ·{' '}
                  {visit.mediaIds.length} 张
                  {videoCount > 0 ? ` · ${videoCount} 段视频` : ''}
                </Text>
              </View>
            ) : null}

            {isActive ? (
              <View style={styles.openHint} pointerEvents="none">
                <Text style={styles.openHintText}>轻点进入图库</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}

      {visits.length > 1 ? (
        <View style={styles.pagerHint} pointerEvents="none">
          <Text style={styles.pagerHintText}>
            {active + 1} / {visits.length} 次到访 · 左右滑动切换
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  card: {
    position: 'absolute',
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.mediaPlaceholder,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  cardImage: { width: '100%', height: '100%' },
  cardImageFallback: { flex: 1, backgroundColor: colors.mediaPlaceholder },
  cardScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '45%',
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  cardContent: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
    gap: 2,
  },
  cardPlace: { ...typography.title2, color: colors.textOnMedia },
  cardDate: { ...typography.callout, color: 'rgba(255,255,255,0.92)' },
  cardMeta: { ...typography.footnote, color: 'rgba(255,255,255,0.78)' },
  openHint: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTranslucent,
  },
  openHintText: { ...typography.caption2, color: colors.textPrimary },
  pagerHint: {
    position: 'absolute',
    bottom: 0,
    alignItems: 'center',
  },
  pagerHintText: { ...typography.caption, color: colors.textTertiary },
  empty: { paddingVertical: spacing.huge, alignItems: 'center' },
  emptyText: { ...typography.callout, color: colors.textSecondary },
});

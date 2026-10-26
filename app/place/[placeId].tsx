import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VisitCardStack } from '@/src/components/place/VisitCardStack';
import { isVisitVisible } from '@/src/domain/visibility';
import {
  isVisitInRange,
  orderVisitsForPlace,
  selectPlaceById,
  selectVisibility,
  selectVisitsOfPlace,
} from '@/src/store/selectors';
import { useAppStore } from '@/src/store/appStore';
import { colors, layout, radius, spacing, typography } from '@/src/theme';
import {
  formatDayFull,
  formatDayKeyFull,
  formatWeekday,
  formatWeekdayKey,
  partOfDay,
  partOfDayLiteral,
} from '@/src/utils/datetime';

export default function PlaceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { placeId } = useLocalSearchParams<{ placeId: string }>();

  const places = useAppStore((s) => s.places);
  const allVisits = useAppStore((s) => s.visits);
  const media = useAppStore((s) => s.media);
  const stories = useAppStore((s) => s.stories);
  const timeRange = useAppStore((s) => s.timeRange);

  const place = selectPlaceById(places, placeId ?? null);
  const visibility = useMemo(() => selectVisibility(media, stories), [stories, media]);
  const visibleVisits = useMemo(
    () =>
      place
        ? selectVisitsOfPlace(allVisits, place.id).filter((visit) =>
            isVisitVisible(visit, visibility),
          )
        : [],
    [allVisits, place, visibility],
  );
  // 时间轴停在哪，哪次的卡片顶到最上面；窗口选不出区别时保持最新在前
  const visits = useMemo(
    () => orderVisitsForPlace(visibleVisits, timeRange),
    [visibleVisits, timeRange],
  );

  // 只有当分区真的把别的一次顶上来时才说「时间轴所选」，否则还是「最近一次」
  const top = visits[0];
  const pinnedByTimeline = top !== undefined && top !== visibleVisits[0];
  const topLabel = pinnedByTimeline ? '时间轴所选' : '最近一次';

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
          <Text style={styles.placeName} numberOfLines={1}>
            {place?.name ?? '地点'}
          </Text>
          <Text style={styles.placeMeta} numberOfLines={1}>
            {[
              // 未定位的照片没有坐标，不能显示一个假的经纬度
              place?.unlocated
                ? '这些照片没有定位信息'
                : place
                  ? `${place.coordinate.latitude.toFixed(3)}, ${place.coordinate.longitude.toFixed(3)}`
                  : null,
              place?.city,
              place?.category,
              visits.length > 0 ? `${visits.length} 次到访` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      </View>

      {top ? (
        <Text style={styles.latestLine}>
          {topLabel} ·{' '}
          {top.dateKey ? formatDayKeyFull(top.dateKey) : formatDayFull(top.startAt)}{' '}
          {top.dateKey ? formatWeekdayKey(top.dateKey) : formatWeekday(top.startAt)}{' '}
          {top.dateKey ? partOfDayLiteral(top.startAt) : partOfDay(top.startAt)}
        </Text>
      ) : null}

      {place ? (
        <VisitCardStack
          place={place}
          visits={visits}
          media={media}
          visibility={visibility}
          onOpenVisit={(visitId) =>
            router.push({ pathname: '/visit/[visitId]', params: { visitId } })
          }
        />
      ) : (
        <View style={styles.notFound}>
          <Text style={styles.notFoundText}>找不到这个地点。</Text>
        </View>
      )}

      <Text style={styles.footnote}>
        每张卡片是一次到访。故事相册里，它们各自成为一本。
      </Text>
    </ScrollView>
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
  placeName: { ...typography.title2, color: colors.textPrimary },
  placeMeta: { ...typography.footnote, color: colors.textTertiary },
  latestLine: {
    ...typography.caption,
    color: colors.textTertiary,
    paddingHorizontal: layout.screenPadding,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  footnote: {
    ...typography.caption,
    color: colors.textTertiary,
    textAlign: 'center',
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.lg,
  },
  notFound: { padding: spacing.huge, alignItems: 'center' },
  notFoundText: { ...typography.callout, color: colors.textSecondary },
});

import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import MapView, { type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ClusterMarker } from '@/src/components/map/ClusterMarker';
import { PlaceMarker } from '@/src/components/map/PlaceMarker';
import { PlacePickerSheet } from '@/src/components/map/PlacePickerSheet';
import { TimelineRail } from '@/src/components/timeline/TimelineRail';
import { resolveMediaSource } from '@/src/data';
import {
  clusterContainsPlace,
  clusterPlaceSummaries,
  type MapCluster,
  type MapRegion,
  planClusterPress,
  type Viewport,
} from '@/src/domain/clustering';
import { buildMonthTicks, monthKey } from '@/src/domain/timeline';
import type { PlaceSummary } from '@/src/domain/types';
import { useAppStore } from '@/src/store/appStore';
import { selectPlaceSummaries } from '@/src/store/selectors';
import { colors, layout, radius, spacing, typography } from '@/src/theme';
import { dayLabelOf, formatVisitRange, partOfDayOf } from '@/src/utils/datetime';

const FOCUS_DELTA = 0.06;

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const windowSize = useWindowDimensions();
  const mapRef = useRef<MapView | null>(null);

  const places = useAppStore((s) => s.places);
  const visits = useAppStore((s) => s.visits);
  const media = useAppStore((s) => s.media);
  const timeRange = useAppStore((s) => s.timeRange);
  const setSelectedTimeRange = useAppStore((s) => s.setSelectedTimeRange);
  const selectedPlaceId = useAppStore((s) => s.selectedPlaceId);
  const selectPlace = useAppStore((s) => s.selectPlace);

  const [mapReady, setMapReady] = useState(false);

  const summaries = useMemo(
    () =>
      // 未定位的照片收在一处，没有坐标，不能上地图——否则会被画到 (0,0)
      selectPlaceSummaries(places, visits, media, timeRange).filter(
        (summary) => !summary.place.unlocated,
      ),
    [places, visits, media, timeRange],
  );

  const ticks = useMemo(() => {
    const sorted = [...visits].sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );
    const first = sorted[0]?.startAt ?? '2025-01-01T00:00:00+08:00';
    const last = sorted[sorted.length - 1]?.startAt ?? '2026-12-01T00:00:00+08:00';
    return buildMonthTicks(first, last);
  }, [visits]);

  const activeIndex = useMemo(() => {
    const key = monthKey(timeRange.startAt);
    const index = ticks.findIndex((t) => t.key === key);
    return index >= 0 ? index : ticks.length - 1;
  }, [ticks, timeRange.startAt]);

  const initialRegion = useMemo<MapRegion>(() => {
    const newest = [...visits]
      .filter((visit) => !places.find((p) => p.id === visit.placeId)?.unlocated)
      .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime())[0];
    const place =
      places.find((p) => p.id === newest?.placeId) ??
      places.find((p) => !p.unlocated) ??
      places[0];
    return {
      latitude: place?.coordinate.latitude ?? 22.5431,
      longitude: place?.coordinate.longitude ?? 114.0579,
      latitudeDelta: FOCUS_DELTA * 2.4,
      longitudeDelta: FOCUS_DELTA * 2.4,
    };
  }, [places, visits]);

  /**
   * 地图可视区域与像素尺寸。聚合判据是"屏幕上两个标记的距离"，
   * 所以这两个值必须一起进来，任何一个变化都要重新分组。
   *
   * viewport 先用窗口尺寸顶住，onLayout 拿到地图真实高度后替换
   * （底部 tab 占掉的那部分不能算进来，否则标记位置会整体偏移）。
   */
  const [viewport, setViewport] = useState<Viewport>({
    width: windowSize.width,
    height: windowSize.height,
  });
  /** 当前地图区域。用户平移/缩放结束、以及自身 animateToRegion 结束后更新 */
  const [region, setRegion] = useState<MapRegion>(initialRegion);
  /** 分不开的聚合，用来弹地点列表 */
  const [pickerCluster, setPickerCluster] = useState<MapCluster | null>(null);

  const clusters = useMemo(
    () => clusterPlaceSummaries(summaries, region, viewport),
    [summaries, region, viewport],
  );

  // 下面几个 ref 让地图交互回调用空依赖保持引用稳定，
  // 否则每次区域变化都会打破标记的 memo，整层标记跟着重渲染。
  const regionRef = useRef<MapRegion>(region);
  regionRef.current = region;
  const viewportRef = useRef<Viewport>(viewport);
  viewportRef.current = viewport;
  const summariesRef = useRef(summaries);
  summariesRef.current = summaries;
  const clustersRef = useRef(clusters);
  clustersRef.current = clusters;
  const selectedIdRef = useRef<string | null>(selectedPlaceId);
  selectedIdRef.current = selectedPlaceId;

  const isVisible = useCallback((summary: PlaceSummary) => {
    const r = regionRef.current;
    const { latitude, longitude } = summary.place.coordinate;
    return (
      Math.abs(latitude - r.latitude) < r.latitudeDelta / 2 &&
      Math.abs(longitude - r.longitude) < r.longitudeDelta / 2
    );
  }, []);

  /** 智能跟随：目标在视野内就不动，出视野才平滑移动（规格 §5.2） */
  const followPlace = useCallback(
    (summary: PlaceSummary) => {
      if (!mapReady || isVisible(summary)) return;
      mapRef.current?.animateToRegion(
        {
          latitude: summary.place.coordinate.latitude,
          longitude: summary.place.coordinate.longitude,
          latitudeDelta: FOCUS_DELTA * 2,
          longitudeDelta: FOCUS_DELTA * 2,
        },
        520,
      );
    },
    [isVisible, mapReady],
  );
  const followRef = useRef(followPlace);
  followRef.current = followPlace;

  /**
   * 导入后归位一次。
   *
   * 需求来源：导入的照片可能和示例数据不在同一个城市，导完在地图上找不到新地点，
   * 会以为导入失败了。store 里放一个带自增 token 的请求，这里消费一次就清掉——
   * 不用「上次导入坐标」这种状态，避免每次回到地图都再飞一次。
   */
  const mapFocus = useAppStore((s) => s.mapFocus);
  const clearMapFocus = useAppStore((s) => s.clearMapFocus);
  const focusedToken = useRef<number | null>(null);
  useEffect(() => {
    if (!mapFocus || !mapReady) return;
    if (focusedToken.current === mapFocus.token) return;
    focusedToken.current = mapFocus.token;
    mapRef.current?.animateToRegion(
      {
        latitude: mapFocus.latitude,
        longitude: mapFocus.longitude,
        latitudeDelta: FOCUS_DELTA * 2.4,
        longitudeDelta: FOCUS_DELTA * 2.4,
      },
      560,
    );
    clearMapFocus();
  }, [clearMapFocus, mapFocus, mapReady]);

  /** 点单个地点：第一次点出底部卡片，再点进入访（规格 §5.3） */
  const handlePlacePress = useCallback(
    (placeId: string) => {
      if (selectedIdRef.current === placeId) {
        router.push({ pathname: '/place/[placeId]', params: { placeId } });
        return;
      }
      selectPlace(placeId);
      const summary = summariesRef.current.find((s) => s.place.id === placeId);
      if (summary) followRef.current(summary);
    },
    [router, selectPlace],
  );

  /**
   * 点聚合：能放大就放大到看清成员；放大也分不开就弹地点列表（规格 §5.3）。
   * 判断逻辑全在 planClusterPress 里，这里只负责执行。
   */
  const handleClusterPress = useCallback((clusterId: string) => {
    const cluster = clustersRef.current.find((c) => c.id === clusterId);
    if (!cluster) return;
    const plan = planClusterPress(cluster, regionRef.current, viewportRef.current);
    if (plan.kind === 'zoom') {
      mapRef.current?.animateToRegion(plan.region, 420);
      return;
    }
    setPickerCluster(cluster);
  }, []);

  const handlePickPlace = useCallback(
    (placeId: string) => {
      setPickerCluster(null);
      selectPlace(placeId);
      const summary = summariesRef.current.find((s) => s.place.id === placeId);
      if (summary) followRef.current(summary);
    },
    [selectPlace],
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport((prev) =>
      Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
        ? prev
        : { width, height },
    );
  }, []);

  const handleRegionChange = useCallback((next: Region) => {
    setRegion({
      latitude: next.latitude,
      longitude: next.longitude,
      latitudeDelta: next.latitudeDelta,
      longitudeDelta: next.longitudeDelta,
    });
  }, []);

  const handleTimelineChange = useCallback(
    (index: number) => {
      const tick = ticks[index];
      if (!tick) return;
      // 同一时段被重复通知时不写 store，避免拖动时无谓的全局重算
      if (tick.range.startAt === timeRange.startAt) return;
      setSelectedTimeRange(tick.range);
    },
    [setSelectedTimeRange, ticks, timeRange.startAt],
  );

  /**
   * 松手后把地图带到"这个时段最有回忆的地方"。
   *
   * 这里不用组件里的 summaries：松手回调可能抢在本次时段变更引发的重新渲染之前到达，
   * 那时 summaries 还是上一个时段的派生结果，会把地图带去"当前时段其实没有照片"的地点。
   * 按 tick 自己的范围重算一次最稳妥；排序让结果稳定（次数多的优先，再看谁更近）。
   */
  const handleTimelineRelease = useCallback(
    (index: number) => {
      const tick = ticks[index];
      if (!tick) return;
      const fresh = selectPlaceSummaries(places, visits, media, tick.range)
        .filter((s) => s.visitCountInRange > 0 && !s.place.unlocated)
        .sort(
          (a, b) =>
            b.visitCountInRange - a.visitCountInRange ||
            new Date(b.latestVisit!.startAt).getTime() -
              new Date(a.latestVisit!.startAt).getTime(),
        );
      if (fresh[0]) followRef.current(fresh[0]);
    },
    [media, places, ticks, visits],
  );

  const selectedSummary = summaries.find((s) => s.place.id === selectedPlaceId);

  return (
    <View style={styles.root} onLayout={handleLayout}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        onMapReady={() => setMapReady(true)}
        onRegionChangeComplete={handleRegionChange}
        showsUserLocation={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}>
        {clusters.map((cluster) => {
          // 只有一个成员时不套聚合壳，直接是地点照片标记
          if (cluster.placeCount === 1) {
            const summary = cluster.members[0];
            return (
              <PlaceMarker
                key={cluster.id}
                placeId={summary.place.id}
                latitude={summary.place.coordinate.latitude}
                longitude={summary.place.coordinate.longitude}
                coverUri={summary.coverMedia?.uri}
                visitCount={summary.visitCountInRange}
                dimmed={summary.visitCountInRange === 0}
                selected={selectedPlaceId === summary.place.id}
                onPress={handlePlacePress}
              />
            );
          }
          return (
            <ClusterMarker
              key={cluster.id}
              clusterId={cluster.id}
              latitude={cluster.coordinate.latitude}
              longitude={cluster.coordinate.longitude}
              placeCount={cluster.placeCount}
              dimState={cluster.dimState}
              hasSelected={clusterContainsPlace(cluster, selectedPlaceId)}
              onPress={handleClusterPress}
            />
          );
        })}
      </MapView>

      <TimelineRail
        ticks={ticks}
        activeIndex={activeIndex}
        onIndexChange={handleTimelineChange}
        onRelease={handleTimelineRelease}
      />

      <Pressable
        onPress={() => router.push('/settings')}
        style={[styles.settingsButton, { top: insets.top + spacing.sm }]}
        hitSlop={8}
        accessibilityLabel="设置">
        <SymbolView
          name={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }}
          tintColor={colors.textPrimary}
          size={20}
        />
      </Pressable>

      {selectedSummary ? (
        <Pressable
          style={[styles.placeCard, { bottom: spacing.sm }]}
          onPress={() =>
            router.push({
              pathname: '/place/[placeId]',
              params: { placeId: selectedSummary.place.id },
            })
          }>
          <Image
            source={
              selectedSummary.coverMedia
                ? resolveMediaSource(selectedSummary.coverMedia.uri)
                : undefined
            }
            style={styles.placeCardImage}
          />
          <View style={styles.placeCardBody}>
            <Text style={styles.placeCardTitle} numberOfLines={1}>
              {selectedSummary.place.name}
            </Text>
            <Text style={styles.placeCardMeta} numberOfLines={1}>
              {selectedSummary.latestVisit
                ? `${dayLabelOf(selectedSummary.latestVisit)} ${partOfDayOf(
                    selectedSummary.latestVisit,
                  )} · ${formatVisitRange(
                    selectedSummary.latestVisit.startAt,
                    selectedSummary.latestVisit.endAt,
                  )}`
                : '暂无到访记录'}
            </Text>
            <Text style={styles.placeCardHint}>
              {selectedSummary.visitCountInRange > 0
                ? `当前时段 ${selectedSummary.visitCountInRange} 次到访 · 点开看到访`
                : '当前时段没有照片 · 点开看历史到访'}
            </Text>
          </View>
        </Pressable>
      ) : null}

      {/*
        底部提示和地点卡片占同一个位置：一次只出现一个。
        这里不叠加 insets.bottom —— 底部 tab bar 已经吃掉安全区，
        再加一次会让卡片凭空浮高，也正是卡片会压住时间轴下段的原因。
      */}
      {selectedSummary ? null : (
        <View style={[styles.legend, { bottom: spacing.sm }]}>
          <Text style={styles.legendText}>缩小看合并 · 拖动右侧时间轴浏览回忆</Text>
        </View>
      )}

      <PlacePickerSheet
        cluster={pickerCluster}
        onSelect={handlePickPlace}
        onClose={() => setPickerCluster(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  settingsButton: {
    position: 'absolute',
    right: spacing.lg,
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: layout.minTouchTarget / 2,
    backgroundColor: colors.surfaceTranslucent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  placeCard: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  placeCardImage: {
    width: 54,
    height: 54,
    borderRadius: radius.media,
    backgroundColor: colors.mediaPlaceholder,
  },
  placeCardBody: { flex: 1, gap: 2 },
  placeCardTitle: { ...typography.headline, color: colors.textPrimary },
  placeCardMeta: { ...typography.footnote, color: colors.textSecondary },
  placeCardHint: { ...typography.caption, color: colors.textTertiary },
  legend: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  legendText: { ...typography.caption, color: colors.textTertiary },
});

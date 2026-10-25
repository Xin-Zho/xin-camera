import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';

import { resolveMediaSource } from '@/src/data';
import { colors, radius, typography } from '@/src/theme';

export const PLACE_MARKER_SIZE = 52;
const ENTRY_MS = 180;
/** 动效播完再关重绘，否则标记会被定格在缩小状态 */
const SETTLE_MS = ENTRY_MS + 120;

interface Props {
  placeId: string;
  latitude: number;
  longitude: number;
  coverUri?: string;
  /** 当前时段的到访数，>1 时显示角标 */
  visitCount: number;
  dimmed: boolean;
  selected: boolean;
  onPress: (placeId: string) => void;
}

/**
 * 单个地点的照片标记。三个性能要点，都针对「拖时间轴/平移地图时整块标记树重渲染」：
 *
 * 1. `memo` + 基本类型 props：只有「变淡状态」真的变了的标记才重渲染。
 * 2. `tracksViewChanges` 在首帧后关掉。开着它时 react-native-maps 会持续把自定义视图
 *    重新栅格化成图片，标记一多就掉帧；关掉后视图不再重绘。变淡改用 Marker 原生
 *    `opacity`（iOS 侧映射到 alpha），不依赖视图重绘，所以不冲突。
 * 3. 入场动效只在挂载时跑一次：平移地图、切换时间轴都不会重新挂载，所以不会重播。
 */
export const PlaceMarker = memo(function PlaceMarker({
  placeId,
  latitude,
  longitude,
  coverUri,
  visitCount,
  dimmed,
  selected,
  onPress,
}: Props) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entry = useRef(new Animated.Value(0)).current;
  const [entering, setEntering] = useState(true);

  useEffect(() => {
    Animated.timing(entry, {
      toValue: 1,
      duration: ENTRY_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    // 到点无条件切回静态样式。react-native-maps 是把标记视图栅格化成图片来显示的，
    // 原生位移动画有可能不被捕获；这条兜底保证标记最终一定停在正常大小和不透明度。
    const t = setTimeout(() => setEntering(false), ENTRY_MS + 40);
    return () => clearTimeout(t);
  }, [entry]);

  const scheduleSettle = useCallback((delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    // 不管图片什么时候加载完，都要等入场动效结束再关，否则栅格化会截到缩小中的那一帧
    timer.current = setTimeout(() => setTracksViewChanges(false), Math.max(delay, SETTLE_MS));
  }, []);

  // 兜底：图片异常时也不能一直开着重绘
  useEffect(() => {
    scheduleSettle(900);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [scheduleSettle]);

  const source = coverUri ? resolveMediaSource(coverUri) : undefined;

  return (
    <Marker
      coordinate={{ latitude, longitude }}
      onPress={() => onPress(placeId)}
      opacity={dimmed ? 0.42 : 1}
      tracksViewChanges={tracksViewChanges}
      zIndex={dimmed ? 1 : selected ? 10 : 5}>
      <Animated.View
        style={
          entering
            ? {
                opacity: entry,
                transform: [
                  { scale: entry.interpolate({ inputRange: [0, 1], outputRange: [0.84, 1] }) },
                ],
              }
            : null
        }>
        <View style={[styles.marker, selected && styles.markerSelected]}>
          {source ? (
            <Image
              source={source}
              style={styles.image}
              onLoadEnd={() => scheduleSettle(140)}
              onError={() => scheduleSettle(140)}
            />
          ) : (
            <View style={styles.fallback} />
          )}
          {visitCount > 1 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{visitCount}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.pointer} />
      </Animated.View>
    </Marker>
  );
});

const styles = StyleSheet.create({
  marker: {
    width: PLACE_MARKER_SIZE,
    height: PLACE_MARKER_SIZE,
    borderRadius: PLACE_MARKER_SIZE / 2,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.mediaPlaceholder,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  markerSelected: { borderColor: colors.accent, borderWidth: 3 },
  image: { width: '100%', height: '100%' },
  fallback: { flex: 1, backgroundColor: colors.mediaPlaceholder },
  pointer: {
    alignSelf: 'center',
    width: 2,
    height: 8,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  badge: {
    position: 'absolute',
    right: 0,
    top: 0,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { ...typography.caption2, color: colors.textOnMedia },
});

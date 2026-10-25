import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';

import type { ClusterDimState } from '@/src/domain/clustering';
import { colors, typography } from '@/src/theme';

const SIZE = 58;

/** 入场动效时长。刻意很短：地图上出现新标记时给一个"落地"感就够了，不要让人等 */
const ENTRY_MS = 200;
/** 得等动效播完再关闭重绘，否则标记会被定格在缩小状态 */
export const MARKER_SETTLE_MS = ENTRY_MS + 110;

interface Props {
  clusterId: string;
  latitude: number;
  longitude: number;
  /** 聚合内的地点数 */
  placeCount: number;
  dimState: ClusterDimState;
  /** 聚合里是否包含当前选中的地点 */
  hasSelected: boolean;
  onPress: (clusterId: string) => void;
}

/**
 * 聚合标记：一个圆里写地点数量。
 *
 * 三种状态的区分方式（规格 §5.3 + 时间轴联动）：
 *  - active  全部有照片 → 实心深色
 *  - partial 部分有照片 → 描边强调色
 *  - none    全都没有   → 灰色描边 + 整体变淡
 * 变淡用 Marker 原生 opacity，不依赖视图重绘，所以拖时间轴时不会掉帧。
 */
export const ClusterMarker = memo(function ClusterMarker({
  clusterId,
  latitude,
  longitude,
  placeCount,
  dimState,
  hasSelected,
  onPress,
}: Props) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 入场：只在挂载时跑一次。key 由成员构成决定，所以平移地图、切换时间轴都不会重播，
  // 只有"聚合真的变了"（缩放导致拆开/合并）才会重新挂载。
  const entry = useRef(new Animated.Value(0)).current;
  const [entering, setEntering] = useState(true);

  useEffect(() => {
    Animated.timing(entry, {
      toValue: 1,
      duration: ENTRY_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    // 到点后无条件切回静态样式：标记最终一定停在正常大小，
    // 不会因为原生侧没渲染动画而永久停在半透明状态。
    const t = setTimeout(() => setEntering(false), ENTRY_MS + 40);
    return () => clearTimeout(t);
  }, [entry]);

  // 视觉状态变化（例如从 active 变成 partial）需要重新栅格化一次，
  // 否则 tracksViewChanges=false 会把旧样子定格住。
  useEffect(() => {
    setTracksViewChanges(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTracksViewChanges(false), MARKER_SETTLE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [dimState, placeCount, hasSelected]);

  return (
    <Marker
      coordinate={{ latitude, longitude }}
      onPress={() => onPress(clusterId)}
      opacity={dimState === 'none' ? 0.42 : 1}
      tracksViewChanges={tracksViewChanges}
      zIndex={dimState === 'none' ? 2 : hasSelected ? 12 : 8}>
      <Animated.View
        style={[
          styles.wrap,
          entering
            ? {
                opacity: entry,
                transform: [
                  { scale: entry.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) },
                ],
              }
            : null,
        ]}>
        <View
          style={[
            styles.circle,
            dimState === 'active' && styles.circleActive,
            dimState === 'partial' && styles.circlePartial,
            dimState === 'none' && styles.circleNone,
            hasSelected && styles.circleSelected,
          ]}>
          <Text
            style={[
              styles.count,
              dimState === 'active' && styles.countActive,
              dimState === 'partial' && styles.countPartial,
              dimState === 'none' && styles.countNone,
            ]}>
            {placeCount}
          </Text>
          <Text
            style={[
              styles.unit,
              dimState === 'active' && styles.countActive,
              dimState === 'partial' && styles.countPartial,
              dimState === 'none' && styles.countNone,
            ]}>
            处
          </Text>
        </View>
      </Animated.View>
    </Marker>
  );
});

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  circleActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  circlePartial: { backgroundColor: colors.surface, borderColor: colors.accent },
  circleNone: { backgroundColor: colors.surface, borderColor: colors.separatorStrong },
  circleSelected: { borderColor: colors.accent, borderWidth: 3 },

  count: { ...typography.headline, fontSize: 20, lineHeight: 22, fontWeight: '700' },
  countActive: { color: colors.textOnMedia },
  countPartial: { color: colors.accent },
  countNone: { color: colors.textTertiary },
  unit: { ...typography.caption2, fontSize: 9, lineHeight: 11, marginTop: 0 },
});

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { TimelineTick } from '@/src/domain/timeline';
import { colors, layout, radius, spacing, typography } from '@/src/theme';

const THUMB = 26;

/**
 * 地图右侧的半透明竖向时间轴（规格 §9）。
 *
 * 手势跑在 UI 线程：`Gesture.Pan` 的回调是 worklet，直接改 shared value 驱动滑块位移，
 * 不再每帧回 JS 改 `bottom` 百分比（那是每帧一次布局计算）。
 * 只有索引真的跨过刻度时才 `runOnJS` 通知上层，避免拖动时每帧一次跨线程 + store 写入。
 *
 * 刻意不用 Slider：竖向拖动 + 刻度吸附必须自己算。
 */
interface Props {
  ticks: TimelineTick[];
  activeIndex: number;
  /** 拖动中索引变化时通知上层（用于标记变淡） */
  onIndexChange: (index: number) => void;
  /** 松手后才触发地图跟随 */
  onRelease: (index: number) => void;
}

/**
 * 把触摸点到顶部的距离换算成滑轨进度和索引。
 * 顶部 = 最新，底部 = 最早。
 */
function applyTouchY(
  y: number,
  railHeight: number,
  count: number,
  progress: SharedValue<number>,
  lastIndex: SharedValue<number>,
  notify: (index: number) => void,
) {
  'worklet';
  if (railHeight <= 0 || count <= 0) return;
  const ratioFromTop = Math.min(1, Math.max(0, y / railHeight));
  progress.value = 1 - ratioFromTop;
  const next = Math.round((1 - ratioFromTop) * (count - 1));
  if (next !== lastIndex.value) {
    lastIndex.value = next;
    runOnJS(notify)(next);
  }
}

export function TimelineRail({ ticks, activeIndex, onIndexChange, onRelease }: Props) {
  const count = ticks.length;

  const railHeight = useSharedValue(0);
  const progress = useSharedValue(0);
  const lastIndex = useSharedValue(activeIndex);
  const dragging = useSharedValue(false);

  // 回调放 ref：拖动时上层每次索引变化都会生成新函数，
  // 若直接进 gesture 依赖会导致手势中途被重建、手势丢失。
  const callbacks = useRef({ onIndexChange, onRelease });
  callbacks.current = { onIndexChange, onRelease };
  const notify = useCallback((index: number) => callbacks.current.onIndexChange(index), []);
  const release = useCallback((index: number) => callbacks.current.onRelease(index), []);

  // 外部改时间（store 变更）时滑块跟上；拖动中不抢手势
  useEffect(() => {
    if (count <= 0) return;
    lastIndex.value = activeIndex;
    if (dragging.value) return;
    const target = count > 1 ? activeIndex / (count - 1) : 0;
    if (Math.abs(progress.value - target) < 0.001) return;
    progress.value = withTiming(target, { duration: 180 });
  }, [activeIndex, count, dragging, lastIndex, progress]);

  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      railHeight.value = e.nativeEvent.layout.height;
    },
    [railHeight],
  );

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((e) => {
          dragging.value = true;
          applyTouchY(e.y, railHeight.value, count, progress, lastIndex, notify);
        })
        .onUpdate((e) => {
          applyTouchY(e.y, railHeight.value, count, progress, lastIndex, notify);
        })
        .onEnd(() => {
          // 吸附到最近的刻度：拖动中滑块跟手指连续移动，松手才对齐
          const target = count > 1 ? lastIndex.value / (count - 1) : 0;
          progress.value = withTiming(target, { duration: 140 });
          runOnJS(release)(lastIndex.value);
        })
        .onFinalize((_e, success) => {
          dragging.value = false;
          if (success) return;
          const target = count > 1 ? lastIndex.value / (count - 1) : 0;
          progress.value = withTiming(target, { duration: 140 });
          runOnJS(release)(lastIndex.value);
        }),
    [count, dragging, lastIndex, notify, progress, railHeight, release],
  );

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -progress.value * railHeight.value }],
  }));

  const activeTick = ticks[activeIndex];

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <GestureDetector gesture={gesture}>
        <View style={styles.track} onLayout={handleLayout}>
          <View style={styles.trackLine} />
          {ticks.map((tick, index) => {
            const ratio = count > 1 ? index / (count - 1) : 0;
            const isActive = index === activeIndex;
            return (
              <View
                key={tick.key}
                style={[
                  styles.tickMark,
                  { bottom: `${ratio * 100}%` },
                  tick.isYearStart && styles.tickMarkYear,
                  isActive && styles.tickMarkActive,
                ]}
              />
            );
          })}
          <Animated.View style={[styles.thumb, thumbStyle]}>
            <Text style={styles.thumbLabel} numberOfLines={1}>
              {activeTick?.label ?? ''}
            </Text>
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    right: spacing.lg,
    top: 120,
    /**
     * 底部留 112：地图底部的地点卡片大约 86 高、贴着底部 8 摆放，
     * 滑轨必须整体在卡片上方，否则卡片会盖住滑轨下段——
     * 而滑轨下段正是最早的时段，等于选中地点后就拖不到最早。
     */
    bottom: 112,
    width: layout.timelineWidth + 22,
    alignItems: 'flex-end',
  },
  track: {
    flex: 1,
    width: layout.timelineWidth,
    marginRight: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTranslucent,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  trackLine: {
    position: 'absolute',
    top: spacing.lg,
    bottom: spacing.lg,
    width: 1,
    backgroundColor: colors.separator,
  },
  tickMark: {
    position: 'absolute',
    width: 8,
    height: 1,
    backgroundColor: colors.separatorStrong,
  },
  tickMarkYear: {
    width: 14,
    height: 2,
    backgroundColor: colors.textTertiary,
  },
  tickMarkActive: {
    width: 16,
    height: 3,
    backgroundColor: colors.accent,
  },
  thumb: {
    position: 'absolute',
    bottom: 0,
    // 按日展示时刻度标签是「10月12日」，固定 26 的圆放不下，
    // 改成可横向撑开的胶囊；短标签（2026 / 10月）仍然是最小圆形宽度
    minWidth: THUMB,
    height: THUMB,
    paddingHorizontal: 6,
    marginBottom: -THUMB / 2,
    borderRadius: radius.pill,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbLabel: {
    ...typography.caption2,
    color: colors.textOnMedia,
  },
});

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { TimelineTick } from '@/src/domain/timeline';
import { colors, layout, radius, spacing, typography } from '@/src/theme';

import {
  RAIL_INSET,
  THUMB_SIZE,
  TICK_SLOT,
  indexForRatio,
  ratioForIndex,
  ratioForTouchY,
  thumbTranslateY,
  tickBottom,
} from './railGeometry';

/**
 * 地图右侧的半透明竖向时间轴（规格 §9）。
 *
 * 手势跑在 UI 线程：`Gesture.Pan` 的回调是 worklet，直接改 shared value 驱动滑块位移，
 * 不再每帧回 JS 改 `bottom` 百分比（那是每帧一次布局计算）。
 * 只有索引真的跨过刻度时才 `runOnJS` 通知上层，避免拖动时每帧一次跨线程 + store 写入。
 *
 * 刻度、滑块、拖动共用 `railGeometry` 一套坐标（起点 / 终点 / 有效高度同一个来源），
 * 这里只负责把算好的像素值画出去。**不要再在样式里写百分比定位**——百分比在原生端按
 * 内容盒解析、在 Web 端按 padding 盒解析，那正是之前上下不一致的来源。
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
  const ratio = ratioForTouchY(y, railHeight, RAIL_INSET);
  progress.value = ratio;
  const next = indexForRatio(ratio, count);
  if (next !== lastIndex.value) {
    lastIndex.value = next;
    runOnJS(notify)(next);
  }
}

export function TimelineRail({ ticks, activeIndex, onIndexChange, onRelease }: Props) {
  const count = ticks.length;
  const insets = useSafeAreaInsets();

  /**
   * 顶部起点至少在设置按钮下方 8pt（按钮占 insets.top + 8 起、44 高），
   * 同时不低于 120：正常 iPhone 上两者结果一致，只为更大顶部安全区的设备兜底。
   * 底部 112 是避让地点卡片的既定值，不动（见 v6 文档）。
   */
  const wrapperTop = Math.max(insets.top + 60, 120);

  const railHeight = useSharedValue(0);
  /**
   * 同一个 onLayout 喂两处：shared value 给 UI 线程的滑块与拖动，
   * state 给刻度的像素排版。**必须同源**，否则又变成各算一套高度。
   */
  const [layoutHeight, setLayoutHeight] = useState(0);
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
    const target = ratioForIndex(activeIndex, count);
    if (Math.abs(progress.value - target) < 0.001) return;
    progress.value = withTiming(target, { duration: 180 });
  }, [activeIndex, count, dragging, lastIndex, progress]);

  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const height = e.nativeEvent.layout.height;
      railHeight.value = height;
      setLayoutHeight((prev) => (prev === height ? prev : height));
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
          progress.value = withTiming(ratioForIndex(lastIndex.value, count), { duration: 140 });
          runOnJS(release)(lastIndex.value);
        })
        .onFinalize((_e, success) => {
          dragging.value = false;
          if (success) return;
          progress.value = withTiming(ratioForIndex(lastIndex.value, count), { duration: 140 });
          runOnJS(release)(lastIndex.value);
        }),
    [count, dragging, lastIndex, notify, progress, railHeight, release],
  );

  // 刻意写成单一表达式、不 early-return：animated style 返回形状恒定最稳。
  // 轨道没量出来时 opacity 0，位移是多少都看不见。
  const thumbStyle = useAnimatedStyle(() => ({
    opacity: railHeight.value > 0 ? 1 : 0,
    transform: [
      { translateY: thumbTranslateY(progress.value, railHeight.value, RAIL_INSET, THUMB_SIZE) },
      // 拖动中滑块微微放大：手势即时反馈（HIG Gestures），松手即回
      { scale: dragging.value ? 1.08 : 1 },
    ],
  }));

  /** 拖动时轨道背板增白一档：控件对操作"有回应"，且不动任何手势/几何逻辑 */
  const trackBackdropStyle = useAnimatedStyle(() => ({
    opacity: dragging.value ? 0.35 : 0,
  }));

  const activeTick = ticks[activeIndex];

  return (
    <View style={[styles.wrapper, { top: wrapperTop }]} pointerEvents="box-none">
      <GestureDetector gesture={gesture}>
        <Animated.View style={styles.track} onLayout={handleLayout}>
          {/* 拖动反馈背板：垫在竖线/刻度/滑块之下，只改自己的透明度 */}
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.trackBackdrop, trackBackdropStyle]}
          />
          <View style={styles.trackLine} />
          {/* 刻度要按像素排，得先知道轨道高度；量到之前空着，一帧都不到 */}
          {layoutHeight > 0
            ? ticks.map((tick, index) => (
                <View
                  key={tick.key}
                  style={[
                    styles.tickSlot,
                    { bottom: tickBottom(ratioForIndex(index, count), layoutHeight, RAIL_INSET, TICK_SLOT) },
                  ]}>
                  <View
                    style={[
                      styles.tickMark,
                      tick.isYearStart && styles.tickMarkYear,
                      index === activeIndex && styles.tickMarkActive,
                    ]}
                  />
                </View>
              ))
            : null}
          <Animated.View style={[styles.thumb, thumbStyle]}>
            <Text style={styles.thumbLabel} numberOfLines={1}>
              {activeTick?.label ?? ''}
            </Text>
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    right: spacing.lg,
    // top 由运行时按安全区计算（insets.top + 60 与 120 取大者）
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
    // 右缘与设置按钮对齐（按钮 right: spacing.lg），右侧两个悬浮控件共享一条边
    marginRight: 0,
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceTranslucent,
    // 白色半透明胶囊浮在浅色地图上，靠这根 hairline 把边缘定形
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    paddingVertical: RAIL_INSET,
    alignItems: 'center',
    justifyContent: 'center',
    // 圆角裁掉背板与内容的边角；内容都在轨道盒内，裁切无副作用
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  /** 拖动反馈：白色增量层，rest 时不渲染任何可见变化 */
  trackBackdrop: {
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  /** 竖线的两端就是刻度的起点与终点，与 RAIL_INSET 同一个内缩 */
  trackLine: {
    position: 'absolute',
    top: RAIL_INSET,
    bottom: RAIL_INSET,
    width: 1,
    // 结构线比刻度安静一档；separatorStrong 在白底上只有约 1.3:1，几乎隐形
    backgroundColor: colors.textTertiary,
  },
  /**
   * 刻度槽：固定 TICK_SLOT 高、居中放真正的那一小条。
   * 这样「槽的中心 = 刻度位置」对粗细三种刻度都成立，
   * 不必给每个变体各算一次半高偏移。
   */
  tickSlot: {
    position: 'absolute',
    width: 16,
    height: TICK_SLOT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickMark: {
    width: 8,
    height: 1,
    // HIG Accessibility：非文本图形 ≥3:1——textTertiary 只有约 2.7:1，再深一档
    backgroundColor: colors.textSecondary,
  },
  tickMarkYear: {
    width: 14,
    height: 2,
    // 年份刻度是刻度里的最高层级
    backgroundColor: colors.textPrimary,
  },
  tickMarkActive: {
    width: 16,
    height: 3,
    backgroundColor: colors.accent,
  },
  thumb: {
    position: 'absolute',
    // 布局从轨道顶部起算，纵向位置全部由 transform 表达（中心点差在 railGeometry 里扣）
    top: 0,
    // 按日展示时刻度标签是「10月12日」，固定 26 的圆放不下，
    // 改成可横向撑开的胶囊；短标签（2026 / 10月）仍然是最小圆形宽度
    minWidth: THUMB_SIZE,
    height: THUMB_SIZE,
    paddingHorizontal: 6,
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

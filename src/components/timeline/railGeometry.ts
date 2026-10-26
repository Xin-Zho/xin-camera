/**
 * 时间轴的几何唯一定义（纯函数，无 import，可脱离真机断言）。
 *
 * 之前的实际状况是**三套坐标系**：
 *
 * 1. `trackLine`（那根竖线）用 `top/bottom: inset`，px 定位，跨度 = [inset, H - inset]；
 * 2. 刻度用 `bottom: ratio * 100%`，百分比 + `paddingVertical: inset`；
 * 3. 滑动块与拖动用 `onLayout` 拿到的**整个**轨道高度 H 做 translateY。
 *
 * 第 3 条与第 1 条本身就不一致（H vs H - 2·inset），第 2 条还要看百分比的
 * 解析盒是谁：
 * - 原生端 RN 的 `layoutTree` 用 `YGErrataAll` 配置 Yoga
 *   （见 react-native/ReactCommon/react/renderer/components/view/YogaLayoutableShadowNode.cpp
 *   里 `configureYogaTree(..., YGErrataAll /*defaultErrata*\/, ...)`），
 *   其中 `AbsolutePercentAgainstInnerSize` 让百分比按**内容盒** H - 2·inset 解析；
 * - Web 端 CSS 的 `bottom: %` 按 **padding 盒** H 解析。
 *
 * 于是原生端刻度的行程是 H - 2·inset，滑块的行程是 H，两者都锚在轨道底边：
 * ratio 0 时重合，ratio 1 时相差 2·inset（inset = 16 → 32px）。
 * 这正是「底部基本重合、越往顶部偏移越明显」，而且 Web 与原生还不一样。
 *
 * 现在刻度、滑动块、拖动三者只认这里：起点 / 终点 / 有效高度一个来源，
 * 一律像素，不再出现任何百分比定位。
 *
 * 所有函数都标了 `'worklet'`：其中几个要在手势回调和 animated style 里跑，
 * 少标一个就会在 UI 线程上崩；在 Node 里 `'worklet'` 只是普通字符串，不影响断言。
 */

/** 轨道上下内缩。刻度的起点与终点、滑动块的行程都以它为准，改这里就够了 */
export const RAIL_INSET = 16;

/** 滑动块直径 */
export const THUMB_SIZE = 26;

/** 刻度槽高度 = 最粗的选中刻度高度，槽内居中排布，这样中心点即刻度位置 */
export const TICK_SLOT = 3;

/** 有效轨道高度：两端各让出 inset */
export function railSize(height: number, inset: number = RAIL_INSET): number {
  'worklet';
  if (!Number.isFinite(height) || !Number.isFinite(inset)) return 0;
  return Math.max(0, height - inset * 2);
}

/** ratio 归一到 [0, 1]；NaN 当 0（宁可不动也别乱跳），±Infinity 夹到对应端点 */
export function clampRatio(ratio: number): number {
  'worklet';
  if (Number.isNaN(ratio)) return 0;
  if (ratio <= 0) return 0;
  if (ratio >= 1) return 1;
  return ratio;
}

/** 索引 → ratio。只有一个刻度时恒为 0（停在底部） */
export function ratioForIndex(index: number, count: number): number {
  'worklet';
  if (!(count > 1)) return 0;
  return clampRatio(index / (count - 1));
}

/** ratio → 索引。与 ratioForIndex 互为逆映射 */
export function indexForRatio(ratio: number, count: number): number {
  'worklet';
  if (!(count > 1)) return 0;
  const index = Math.round(clampRatio(ratio) * (count - 1));
  return Math.min(count - 1, Math.max(0, index));
}

/** 刻度 / 滑动块**中心**到轨道底边的距离（px）。ratio 0 = 最早 = 底部 */
export function centerFromBottom(
  ratio: number,
  height: number,
  inset: number = RAIL_INSET,
): number {
  'worklet';
  return inset + clampRatio(ratio) * railSize(height, inset);
}

/** 刻度槽的 `bottom` 值：把槽（TICK_SLOT 高）的中心对到刻度线上 */
export function tickBottom(
  ratio: number,
  height: number,
  inset: number = RAIL_INSET,
  slot: number = TICK_SLOT,
): number {
  'worklet';
  return centerFromBottom(ratio, height, inset) - slot / 2;
}

/** 触摸点（距轨道顶部）→ ratio。超出两端按边界夹住，不越界也不吸到另一端 */
export function ratioForTouchY(
  y: number,
  height: number,
  inset: number = RAIL_INSET,
): number {
  'worklet';
  const size = railSize(height, inset);
  // 轨道还没量出来（或高度不足两端内缩）时不响应，别把索引甩到 0
  if (!(size > 0) || !Number.isFinite(y)) return 0;
  return clampRatio((height - inset - y) / size);
}

/** ratio → 触摸点（距轨道顶部）。ratioForTouchY 的逆映射，用于断言正反一致 */
export function touchYForRatio(
  ratio: number,
  height: number,
  inset: number = RAIL_INSET,
): number {
  'worklet';
  return height - inset - clampRatio(ratio) * railSize(height, inset);
}

/** 滑动块中心距轨道顶部的距离 */
export function thumbCenterY(
  ratio: number,
  height: number,
  inset: number = RAIL_INSET,
): number {
  'worklet';
  return height - centerFromBottom(ratio, height, inset);
}

/**
 * 滑动块的 `transform.translateY`。
 *
 * 滑块布局上是 `top: 0`，中心在 `size / 2` 处，所以要让**中心**落在刻度线上，
 * 位移是 `中心 y - size / 2`。这一项就是「中心点 vs 边缘定位」的差：
 * 之前用 `bottom: 0` + `marginBottom: -size / 2` 把中心摆到轨道底边，
 * 再减去 ratio × 整个轨道高度——两个半圆各自算了一次，叠起来就错了。
 */
export function thumbTranslateY(
  ratio: number,
  height: number,
  inset: number = RAIL_INSET,
  size: number = THUMB_SIZE,
): number {
  'worklet';
  return thumbCenterY(ratio, height, inset) - size / 2;
}

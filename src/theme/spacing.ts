/**
 * 间距与圆角。统一克制：不是所有东西都做成大圆角卡片（规格 §10）。
 */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 44,
} as const;

export const radius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 18,
  /** 图片常用 */
  media: 10,
  pill: 999,
} as const;

export const layout = {
  /** iOS 建议最小可触控尺寸 */
  minTouchTarget: 44,
  /** 页面左右安全留白 */
  screenPadding: 20,
  /** 时间轴宽度 */
  timelineWidth: 52,
} as const;

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
  /** 照片墙网格专用：Ente/系统相册都用近无缝小圆角（参照 gallery_file_widget.dart 的 1px） */
  xxs: 2,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 18,
  /** FluxTie/MD3 卡片档位：20 + hairline 描边代替阴影 */
  card: 20,
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

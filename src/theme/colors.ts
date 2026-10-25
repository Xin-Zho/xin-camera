/**
 * 苹果原生简约风基础色板（规格 §10）。
 * 只放语义色，不要在页面里写裸十六进制。
 */
export const colors = {
  /** 页面底色，接近白 */
  background: '#FFFFFF',
  /** 次级页面底色，用于分组留白 */
  backgroundGrouped: '#F7F7F8',
  /** 卡片 / 浮层表面 */
  surface: '#FFFFFF',
  /** 浮层遮罩（半透明时间轴、卡片堆叠背板） */
  surfaceTranslucent: 'rgba(255, 255, 255, 0.82)',
  surfaceTranslucentDark: 'rgba(24, 24, 26, 0.62)',

  textPrimary: '#111113',
  textSecondary: '#6B6B72',
  textTertiary: '#9C9CA4',
  textOnMedia: '#FFFFFF',

  separator: '#E7E7EA',
  separatorStrong: '#D6D6DA',

  accent: '#0A84FF',
  accentMuted: 'rgba(10, 132, 255, 0.12)',

  /** 照片占位 / 骨架屏 */
  mediaPlaceholder: '#EFEFF2',
  /** 视频角标 */
  videoBadge: 'rgba(0, 0, 0, 0.62)',

  danger: '#D93A3A',
  dangerMuted: 'rgba(217, 58, 58, 0.10)',
  /** 提醒态：存档损坏、限量授权这类"能用但要知情"的状态 */
  warning: '#A05A00',
  warningMuted: 'rgba(200, 140, 30, 0.14)',

  /** 叠在照片上的文字需要渐变遮罩 */
  mediaScrimTop: 'rgba(0, 0, 0, 0)',
  mediaScrimBottom: 'rgba(0, 0, 0, 0.46)',
} as const;

export type ColorToken = keyof typeof colors;

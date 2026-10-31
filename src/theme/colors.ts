/**
 * FluxTie 风格色板 —— Material Design 3 tonal 映射。
 * 生成方式：material-color-utilities themeFromSourceColor，
 * 种子色 #2196F3（与 FluxTie 默认一致），TonalSpot 调和。
 * 只放语义色，不要在页面里写裸十六进制。
 */
export const colors = {
  /** 页面底色：MD3 surface = neutral tone 96，浅灰蓝，让白卡片靠色差浮起 */
  background: '#F4F3F7',
  /** 次级页面底色：neutral tone 95 */
  backgroundGrouped: '#F1F0F4',
  /** 卡片 / 浮层表面：MD3 卡片永远是白底 + hairline 描边，不靠阴影 */
  surface: '#FFFFFF',
  /** 浮层遮罩（悬浮 Dock、地图胶囊）：偏白的高不透明度，模拟毛玻璃 */
  surfaceTranslucent: 'rgba(250, 249, 252, 0.88)',
  surfaceTranslucentDark: 'rgba(30, 30, 34, 0.62)',

  /** onSurface = neutral tone 10 */
  textPrimary: '#1A1C1E',
  /** onSurfaceVariant 取 neutral tone 30，浅底上 ≈8:1，小字安全 */
  textSecondary: '#45474A',
  /** 仅占位/禁用态：neutralVariant tone 40 */
  textTertiary: '#5A5F66',
  textOnMedia: '#FFFFFF',

  /** outlineVariant = neutralVariant tone 90，带一点蓝灰的 hairline */
  separator: '#DFE2EB',
  /** outline = neutralVariant tone 80 */
  separatorStrong: '#C3C7CF',

  /** MD3 primary tone 40（亮色主题主色） */
  accent: '#0061A4',
  accentMuted: 'rgba(0, 97, 164, 0.12)',
  /** primaryContainer = primary tone 90：选中态胶囊、chip 的底色 */
  accentContainer: '#D1E4FF',
  /** onPrimaryContainer = primary tone 10 */
  onAccentContainer: '#001D36',

  /** 照片占位 / 骨架屏：MD3 surfaceContainerHigh */
  mediaPlaceholder: '#E4E3EA',
  /** 阅读页纸底：旅行手账的米黄纸色，只给故事阅读页用，别处仍是中性灰蓝 */
  paper: '#F3EDDF',
  /** 手账拍立得相纸：比纸底更亮的暖白，托照片用 */
  paperCard: '#FDFBF4',
  /** 手账墨色：暖棕灰，写在米纸上的正文/标题 */
  paperInk: '#46403A',
  /** 手账淡墨：日期、脚注这类贴图小字 */
  paperInkSoft: '#8C8377',
  /** 和纸胶带：半透明米色，贴角固定照片 */
  tape: 'rgba(197, 180, 150, 0.62)',
  /** 印泥红：日期章、封面邮戳，全篇唯一的强色，克制使用 */
  stamp: '#B5502F',
  /** 相角：牛皮纸色的三角相片角，比胶带更"藏着"的固定方式 */
  cornerMount: '#C6B696',
  /** 手账 hairline：米纸上的分隔线，比 separator 更暖更淡 */
  paperLine: 'rgba(140, 131, 119, 0.32)',
  /** 手账照片占位：暖灰。冷灰 mediaPlaceholder 放在米纸上像一块破洞 */
  paperPlaceholder: '#E6DDCB',
  /** 纸面上的暖色浮层：返回/编辑按钮的底色 */
  paperTranslucent: 'rgba(253, 251, 244, 0.82)',
  /** 视频角标 */
  videoBadge: 'rgba(0, 0, 0, 0.62)',

  /** MD3 error tone 40 */
  danger: '#BA1A1A',
  dangerMuted: 'rgba(186, 26, 26, 0.10)',
  /** 提醒态：存档损坏、限量授权这类"能用但要知情"的状态 */
  warning: '#A05A00',
  warningMuted: 'rgba(200, 140, 30, 0.14)',

  /** 叠在照片上的文字需要渐变遮罩 */
  mediaScrimTop: 'rgba(0, 0, 0, 0)',
  mediaScrimBottom: 'rgba(0, 0, 0, 0.46)',
} as const;

export type ColorToken = keyof typeof colors;

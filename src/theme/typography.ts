import type { TextStyle } from 'react-native';

/**
 * 字体阶梯 —— 优先使用 iOS 系统字体（SF Pro），
 * 因此不设置 fontFamily，交给系统默认即可。
 */
export const typography: Record<
  'largeTitle' | 'title' | 'title2' | 'headline' | 'body' | 'callout' | 'footnote' | 'caption' | 'caption2',
  TextStyle
> = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: 0.2 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: 0.1 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400' },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: '400' },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  caption2: { fontSize: 11, lineHeight: 13, fontWeight: '500', letterSpacing: 0.4 },
};

/** 杂志排版用的衬线/标题感，仅故事阅读页使用 */
export const editorialTypography: Record<'storyTitle' | 'sectionTitle' | 'body', TextStyle> = {
  // 故事标题的宋体（iOS 内置 Songti SC）由阅读页在渲染处用 Platform.select 注入：
  // 这里是纯数据模块，不能引入 react-native 的运行时导出，
  // 否则 m13 这类纯函数断言链会把 react-native 整个拖进来。
  storyTitle: { fontSize: 30, lineHeight: 40, fontWeight: '700', letterSpacing: 0.5 },
  sectionTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600', letterSpacing: 1.2 },
  body: { fontSize: 16, lineHeight: 25, fontWeight: '400' },
};

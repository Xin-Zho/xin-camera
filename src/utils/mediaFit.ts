/**
 * 图片尺寸计算（纯函数，可单独测试）。
 *
 * 规格要求：阅读页里的任何一张图都必须完整落在屏幕内，不允许出现
 * "图片有一部分在手机之外"。做法是给图片一个宽高都受限的盒子，
 * 按 contain 语义等比缩进盒子里——宁可缩小、留白，也不裁切、不溢出。
 */

export interface MediaSize {
  width: number;
  height: number;
}

/**
 * 把 source 等比缩放到完全放进 maxWidth × maxHeight 内。
 * - 返回的宽高一定 <= 盒子；
 * - 不放大超过盒子（box 小于原图时缩小，box 大于原图时也不放大到超出 box）；
 * - 宽高取整，避免半像素导致的 1px 溢出。
 */
export function fitWithin(source: MediaSize, maxWidth: number, maxHeight: number): MediaSize {
  const srcW = Math.max(1, source.width || 1);
  const srcH = Math.max(1, source.height || 1);
  const boxW = Math.max(1, maxWidth);
  const boxH = Math.max(1, maxHeight);

  const scale = Math.min(boxW / srcW, boxH / srcH);

  return {
    width: Math.min(boxW, Math.max(1, Math.round(srcW * scale))),
    height: Math.min(boxH, Math.max(1, Math.round(srcH * scale))),
  };
}

/**
 * 阅读页里单张大图允许占用的最大高度。
 *
 * 注意这是**原型默认值**，不是一个可以反复调试的魔法系数。
 * 取屏幕可视高度的 52%，是为了让「一张图 + 上方返回栏 / 日期 / 标题」大致落在同一屏内，
 * 从而实现"一屏看全一张图"的阅读偏好——不是因为原实现有溢出 bug：
 * 页面本来就能滚，滚动本来就能分段看完长图，只是没法同时看见整张。
 *
 * 52% 并不保证一定放得下：标题行数、有无正文都会改变上方占用。
 * 如果真机上仍出现遮挡，正确做法是测量图片上方的实际占用（onLayout 拿真实剩余高度），
 * 用可用高度算盒子，而不是把这个比例调来调去。
 *
 * 下限 220 是为了极矮的窗口（分屏、横屏）下图片别被压成一条线。
 */
export function maxReaderMediaHeight(windowHeight: number): number {
  return Math.max(220, Math.round(windowHeight * 0.52));
}

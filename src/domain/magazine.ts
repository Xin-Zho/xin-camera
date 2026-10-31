/**
 * 留白摄影杂志 —— 排版规划层（纯函数，可单独测试）。
 *
 * 职责边界：只决定「哪张照片进哪种版式块」，不决定像素尺寸、颜色、字体。
 * 渲染层（阅读页）拿着块序列自己去算宽高——这样规划层可以在 Node 里
 * 用真实数据反复断言，而不用拉起整个 App。
 *
 * 硬规则（每一都能单独验收）：
 *  1. 封面单独计算（pickVisibleCover 口径），不混进正文序列；
 *  2. 每张正文照片恰好出现一次；
 *  3. 用户调整的顺序原样保留（块内的先后 = 传入的先后）；
 *  4. 同一份输入永远产出同一份布局——没有任何随机、没有时间、没有哈希抖动；
 *  5. 重点照片（星标）优先独幅重点；
 *  6. 照片少就精简，不为凑版式重复展示照片；
 *  7. 规划层不产出一句话文案——没有备注就没有文字区，不自动编造。
 */
import type { MediaAsset, Story } from './types';
import { pickVisibleCover, type MediaVisibility } from './visibility';

/** 版式块。日期、备注这类贴图文字由渲染层从 item 自己取，这里只有媒体引用 */
export type MagazineBlock =
  /**
   * 错位双图：主图大、次图小且向下错开。
   * mirrored 交替翻转主次左右，避免连续多组双图长得一模一样。
   */
  | { kind: 'pair'; primary: MediaAsset; secondary: MediaAsset; mirrored: boolean }
  /**
   * 独幅：
   *  - hero = 星标重点，给整宽或大半屏；
   *  - medium = 节奏中的单张，约四分之三宽；
   *  - panorama = 宽高比 ≥2 的全景（不一定是星标），独占整宽但压低高度。
   */
  | { kind: 'solo'; item: MediaAsset; emphasis: 'hero' | 'medium' | 'panorama' }
  /** 收尾：居中偏小的照片 + 日期，给全篇一个明确的结束 */
  | { kind: 'closing'; item: MediaAsset };

export interface MagazinePlan {
  /** 封面照片（独立口径，不属于正文序列） */
  cover: MediaAsset | undefined;
  /** 正文块序列，用户的照片顺序原样保留 */
  blocks: MagazineBlock[];
}

/** 非重点照片连续成串时，从第 3 组双图起插一张单张「呼吸位」 */
const MEDIUM_BREATHE_CYCLE = 3;

/* ---- 横竖比例档位（只影响选哪种版式，不影响像素尺寸） ---- */
/** 宽高比 ≥2 视为全景：塞进任何并排小格都会变成一条，独占整宽 */
const PANORAMA_RATIO = 2;
/** 高宽比 ≥1.2 视为竖图 */
const PORTRAIT_RATIO = 1.2;
/** 宽高比 ≥1.5 视为宽图 */
const WIDE_RATIO = 1.5;

const aspectOf = (m: Pick<MediaAsset, 'width' | 'height'>) =>
  m.width / Math.max(1, m.height || 1);
const isPanorama = (m: Pick<MediaAsset, 'width' | 'height'>) => aspectOf(m) >= PANORAMA_RATIO;
const isPortrait = (m: Pick<MediaAsset, 'width' | 'height'>) =>
  (m.height || 1) / Math.max(1, m.width || 1) >= PORTRAIT_RATIO;
const isWide = (m: Pick<MediaAsset, 'width' | 'height'>) => aspectOf(m) >= WIDE_RATIO;

/**
 * 把一段非重点照片流切成块。
 * 只在 run 内部决定节奏；run 的切分点由外层的星标位置决定。
 */
function emitRun(
  run: MediaAsset[],
  out: MagazineBlock[],
  pairCount: number,
): number {
  let i = 0;
  while (i < run.length) {
    const remaining = run.length - i;
    // 竖图紧跟一张宽图时不凑双图：宽图在 0.32 的小格里会压成窄条，
    // 让竖图先独占一张 medium，宽图留给下一轮配对
    if (
      remaining >= 2 &&
      isPortrait(run[i]) &&
      isWide(run[i + 1]) &&
      !isPanorama(run[i + 1])
    ) {
      out.push({ kind: 'solo', item: run[i], emphasis: 'medium' });
      i += 1;
      continue;
    }
    if (remaining === 1) {
      out.push({ kind: 'solo', item: run[i], emphasis: 'medium' });
      i += 1;
      continue;
    }
    if (remaining === 3) {
      // 三张 = 一组双图带一张单张收，比三张全拼双图多一档大小对比
      out.push({
        kind: 'pair',
        primary: run[i],
        secondary: run[i + 1],
        mirrored: pairCount % 2 === 1,
      });
      pairCount += 1;
      out.push({ kind: 'solo', item: run[i + 2], emphasis: 'medium' });
      i += 3;
      continue;
    }
    if (remaining === 6) {
      // 六张刻意打断成 双图-单张-双图，避免三连双图的模板感
      out.push({
        kind: 'pair',
        primary: run[i],
        secondary: run[i + 1],
        mirrored: pairCount % 2 === 1,
      });
      pairCount += 1;
      out.push({ kind: 'solo', item: run[i + 2], emphasis: 'medium' });
      out.push({
        kind: 'pair',
        primary: run[i + 3],
        secondary: run[i + 4],
        mirrored: pairCount % 2 === 1,
      });
      pairCount += 1;
      i += 5;
      continue;
    }
    if (remaining >= 5 && pairCount % MEDIUM_BREATHE_CYCLE === 2) {
      // 连排双图超过两组时插一张单张透口气
      out.push({ kind: 'solo', item: run[i], emphasis: 'medium' });
      i += 1;
      continue;
    }
    // 其余情况成对配错位双图；镜像方向跟随已发出的双图数量交替
    out.push({
      kind: 'pair',
      primary: run[i],
      secondary: run[i + 1],
      mirrored: pairCount % 2 === 1,
    });
    pairCount += 1;
    i += 2;
  }
  return pairCount;
}

/**
 * 生成整本故事的杂志布局。
 *
 * 入参 `items` 必须已经是「可见 + 按用户顺序排好」的正文候选
 * （阅读页用 visibleMediaOf 得到的那份）。
 */
export function planMagazine(
  story: Pick<Story, 'mediaIds' | 'coverMediaId' | 'highlightedMediaIds'>,
  items: MediaAsset[],
  mediaIndex: Map<string, MediaAsset>,
  visibility: MediaVisibility,
): MagazinePlan {
  if (items.length === 0) {
    return { cover: undefined, blocks: [] };
  }

  // 封面单独走 pickVisibleCover 口径（与编辑页、列表封面完全一致），
  // 然后从正文序列里摘掉——封面不重复出现在正文里。
  const cover = pickVisibleCover(story.mediaIds, story.coverMediaId, mediaIndex, visibility);
  const body = cover ? items.filter((item) => item.id !== cover.id) : items.slice();

  const highlighted = new Set(story.highlightedMediaIds);
  const blocks: MagazineBlock[] = [];

  // 最后一张留作收尾（至少两张正文才留），收尾必须有照片，
  // 只有一张正文时直接用独幅，不为凑「收尾」这个形状硬拆。
  const reserveClosing = body.length >= 2;
  const closing = reserveClosing ? body[body.length - 1] : undefined;
  const middle = reserveClosing ? body.slice(0, -1) : body;

  // 星标把正文切成若干段；段内才是非重点照片的连续流
  let pairCount = 0;
  let run: MediaAsset[] = [];
  const flushRun = () => {
    pairCount = emitRun(run, blocks, pairCount);
    run = [];
  };

  middle.forEach((item) => {
    if (highlighted.has(item.id)) {
      flushRun();
      blocks.push({ kind: 'solo', item, emphasis: 'hero' });
    } else if (isPanorama(item)) {
      // 全景图独占整宽：这是横竖比例直接决定版式的地方
      flushRun();
      blocks.push({ kind: 'solo', item, emphasis: 'panorama' });
    } else {
      run.push(item);
    }
  });
  flushRun();

  if (closing) blocks.push({ kind: 'closing', item: closing });

  return { cover, blocks };
}

/**
 * 错位双图的两列宽度比例（占内容宽）。
 * 挂在规划层旁边是因为渲染层与断言都要引用同一组数，避免两处各写一份。
 */
export const PAIR_RATIOS = {
  // 手账感靠「一大一小贴在一起」，次图太小会退化成缩略图列表，
  // 所以两列合计 0.94，中间只留一点缝，让它们像叠着贴上去的
  primary: 0.56,
  secondary: 0.38,
} as const;

/** 单张呼吸位 / 收尾的宽度比例（占内容宽） */
export const SOLO_MEDIUM_RATIO = 0.75;
export const CLOSING_RATIO = 0.55;

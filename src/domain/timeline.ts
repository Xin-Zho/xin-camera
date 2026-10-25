import type { TimeGranularity, TimeRange } from './types';
import { toDate } from '@/src/utils/datetime';

/**
 * 时间轴与时间窗口的纯函数，不依赖 UI，也不依赖 store。
 * 规格 §9：图纸上时间轴是右侧竖向控件，拖动只改 TimeRange。
 */

const pad = (n: number) => `${n}`.padStart(2, '0');

export function isoAt(year: number, month: number, day: number, hour = 0, minute = 0): string {
  const d = new Date(year, month - 1, day, hour, minute, 0, 0);
  // 输出带 +08:00 的稳定 ISO，避免不同机型时区差异影响判断
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:00+08:00`;
}

export function makeDayRange(anchorISO: string): TimeRange {
  const d = toDate(anchorISO);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { startAt: start.toISOString(), endAt: end.toISOString(), granularity: 'day' };
}

export function makeMonthRange(anchorISO: string): TimeRange {
  const d = toDate(anchorISO);
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return { startAt: start.toISOString(), endAt: end.toISOString(), granularity: 'month' };
}

export function makeYearRange(anchorISO: string): TimeRange {
  const d = toDate(anchorISO);
  const start = new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999);
  return { startAt: start.toISOString(), endAt: end.toISOString(), granularity: 'year' };
}

export function makeRange(granularity: TimeGranularity, anchorISO: string): TimeRange {
  if (granularity === 'year') return makeYearRange(anchorISO);
  if (granularity === 'month') return makeMonthRange(anchorISO);
  return makeDayRange(anchorISO);
}

export function isWithinRange(iso: string, range: TimeRange): boolean {
  const t = toDate(iso).getTime();
  return t >= toDate(range.startAt).getTime() && t <= toDate(range.endAt).getTime();
}

/** 'YYYY-MM' 稳定键，用于时间轴刻度 */
export function monthKey(iso: string): string {
  const d = toDate(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function yearOf(iso: string): number {
  return toDate(iso).getFullYear();
}

export interface TimelineTick {
  key: string;
  /** 展示文案：年份分界显示 "2026"，普通月份显示 "10月" */
  label: string;
  isYearStart: boolean;
  range: TimeRange;
}

/**
 * 从最早到最晚的月份，生成连续刻度。
 * 连续（不是稀疏）才能让拖动时有"跨越时间"的手感（规格 §9）。
 */
export function buildMonthTicks(fromISO: string, toISO: string): TimelineTick[] {
  const from = toDate(fromISO);
  const to = toDate(toISO);
  let y = from.getFullYear();
  let m = from.getMonth();
  const endY = to.getFullYear();
  const endM = to.getMonth();
  const ticks: TimelineTick[] = [];
  let guard = 0;
  while ((y < endY || (y === endY && m <= endM)) && guard < 400) {
    guard += 1;
    const anchor = isoAt(y, m + 1, 15);
    const isYearStart = m === 0;
    ticks.push({
      key: `${y}-${pad(m + 1)}`,
      label: isYearStart ? `${y}` : `${m + 1}月`,
      isYearStart,
      range: makeMonthRange(anchor),
    });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return ticks;
}

/** 距离最近的刻度索引，用于拖动吸附 */
export function closestTickIndex(ticks: TimelineTick[], iso: string): number {
  const target = toDate(iso).getTime();
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  ticks.forEach((tick, i) => {
    const mid =
      (toDate(tick.range.startAt).getTime() + toDate(tick.range.endAt).getTime()) / 2;
    const dist = Math.abs(mid - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  return best;
}

/** 时间窗口的中位时间，用于"智能跟随"判断地图是否需要移动 */
export function rangeCenterISO(range: TimeRange): string {
  const s = toDate(range.startAt).getTime();
  const e = toDate(range.endAt).getTime();
  return new Date((s + e) / 2).toISOString();
}

export function describeRange(range: TimeRange): string {
  const s = toDate(range.startAt);
  const e = toDate(range.endAt);
  if (range.granularity === 'year') return `${s.getFullYear()}年`;
  if (range.granularity === 'month') return `${s.getFullYear()}年${s.getMonth() + 1}月`;
  return `${s.getMonth() + 1}月${s.getDate()}日`;
}

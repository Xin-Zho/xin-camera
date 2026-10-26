import type { TimeGranularity, TimeRange } from './types';
import { dayKeyOf, localDayKeyOfISO, parseDateKey, toDate } from '@/src/utils/datetime';

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

/* ------------------------------------------------------------------ *
 * 时间轴范围：跟随「当前还有哪些有效照片」动态变化
 *
 * 之前刻度范围是从到访里取最早/最晚，再用示例数据的跨度撑出 9 月–10 月。
 * 一旦照片被移除或故事被删，刻度却还停在那里，用户拖动时有一半位置是空的。
 * 现在刻度范围只由**有效照片的归属日**决定，数据一变就重算。
 *
 * 另外，刻度粒度也跟着跨度走：只有几天照片时按日，跨度大了按月、再大按年。
 * 固定按月的话，一天的回忆会占满整条滑轨，手感完全失真。
 * ------------------------------------------------------------------ */

/** 这一档最多按日展示多少天（含首尾）。31 ≈ 一个月，再多日刻度就密到点不中 */
export const DAY_GRANULARITY_MAX_DAYS = 31;

/** 超过这个月数就退到按年展示。24 个月以内的月刻度仍可点选 */
export const MONTH_GRANULARITY_MAX_MONTHS = 24;

/**
 * 本地年月日 → 锚点时刻。
 *
 * 用「本地构造 + UTC 序列化」，不用 `isoAt` 那套手拼 +08:00：
 * 手拼在非 +08:00 的设备上会整体错一天（本地 10-12 12:00 被写成 +08:00 的 10-12 12:00，
 * 在 UTC-8 上解析回来是本地 10-11）。正午锚点保证任何偏移都不会跨到隔壁日。
 */
function localAnchorISO(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour, 0, 0, 0).toISOString();
}

/** 归属日键 → 天序号。用 UTC 构造，避免夏令时把两天差算成 23 或 25 小时 */
function dayIndexOf(dayKey: string): number | null {
  const parts = parseDateKey(dayKey);
  if (!parts) return null;
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

/** 天序号 → 归属日键 */
function dayKeyOfIndex(index: number): string {
  const d = new Date(index * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 归属日键 → 连续月序号（年 × 12 + 月），方便算跨度 */
function monthIndexOf(dayKey: string): number | null {
  const parts = parseDateKey(dayKey);
  if (!parts) return null;
  return parts.year * 12 + (parts.month - 1);
}

/**
 * 有效照片覆盖的时间跨度。
 * `granularity` 是「这个跨度该用哪种刻度」的结论，不是用户选出来的。
 */
export interface MediaSpan {
  firstKey: string;
  lastKey: string;
  /** 覆盖的自然日数（含首尾），只有一天时为 1 */
  dayCount: number;
  /** 覆盖的自然月数（含首尾） */
  monthCount: number;
  yearCount: number;
  granularity: TimeGranularity;
}

/** 任意带归属日的数据（照片 / 到访 / 故事）都能算跨度 */
export interface DatedKeyLike {
  capturedAt?: string;
  startAt?: string;
  dateKey?: string;
}

function keyOfDated(item: DatedKeyLike): string | null {
  const iso = item.capturedAt ?? item.startAt;
  if (!iso) return null;
  const key = dayKeyOf(iso, item.dateKey);
  return parseDateKey(key) ? key : null;
}

/**
 * 由一组数据算出时间轴该覆盖的范围。
 * 空数组返回 null——调用方据此显示空状态，而不是硬撑出一段没有照片的跨度。
 */
export function computeMediaSpan(items: DatedKeyLike[]): MediaSpan | null {
  let firstDay = Number.POSITIVE_INFINITY;
  let lastDay = Number.NEGATIVE_INFINITY;
  let firstMonth = Number.POSITIVE_INFINITY;
  let lastMonth = Number.NEGATIVE_INFINITY;

  items.forEach((item) => {
    const key = keyOfDated(item);
    if (!key) return;
    const day = dayIndexOf(key);
    const month = monthIndexOf(key);
    if (day === null || month === null) return;
    if (day < firstDay) firstDay = day;
    if (day > lastDay) lastDay = day;
    if (month < firstMonth) firstMonth = month;
    if (month > lastMonth) lastMonth = month;
  });

  if (!Number.isFinite(firstDay) || !Number.isFinite(lastDay)) return null;

  const dayCount = lastDay - firstDay + 1;
  const monthCount = lastMonth - firstMonth + 1;
  const yearCount = Math.floor(lastMonth / 12) - Math.floor(firstMonth / 12) + 1;

  const granularity: TimeGranularity =
    dayCount <= DAY_GRANULARITY_MAX_DAYS
      ? 'day'
      : monthCount <= MONTH_GRANULARITY_MAX_MONTHS
        ? 'month'
        : 'year';

  return {
    firstKey: dayKeyOfIndex(firstDay),
    lastKey: dayKeyOfIndex(lastDay),
    dayCount,
    monthCount,
    yearCount,
    granularity,
  };
}

function dayTickLabel(dayKey: string): string {
  const parts = parseDateKey(dayKey);
  if (!parts) return dayKey;
  return `${parts.month}月${parts.day}日`;
}

/**
 * 按跨度生成连续刻度。
 * 连续（不是只在有照片的那几天打点）才有"拖过一段时间"的手感，与旧月刻度一致。
 */
export function buildTimelineTicks(span: MediaSpan): TimelineTick[] {
  const firstDay = dayIndexOf(span.firstKey);
  const lastDay = dayIndexOf(span.lastKey);
  if (firstDay === null || lastDay === null) return [];
  const ticks: TimelineTick[] = [];

  if (span.granularity === 'day') {
    for (let day = firstDay; day <= lastDay && ticks.length < 400; day += 1) {
      const key = dayKeyOfIndex(day);
      const parts = parseDateKey(key);
      if (!parts) continue;
      ticks.push({
        key,
        label: dayTickLabel(key),
        isYearStart: parts.month === 1 && parts.day === 1,
        range: makeDayRange(localAnchorISO(parts.year, parts.month, parts.day)),
      });
    }
    return ticks;
  }

  if (span.granularity === 'month') {
    const first = monthIndexOf(span.firstKey);
    const last = monthIndexOf(span.lastKey);
    if (first === null || last === null) return [];
    for (let month = first; month <= last && ticks.length < 400; month += 1) {
      const year = Math.floor(month / 12);
      const monthInYear = (month % 12) + 1;
      const isYearStart = monthInYear === 1;
      ticks.push({
        key: `${year}-${pad(monthInYear)}`,
        label: isYearStart ? `${year}` : `${monthInYear}月`,
        isYearStart,
        range: makeMonthRange(localAnchorISO(year, monthInYear, 15)),
      });
    }
    return ticks;
  }

  const firstYear = Number(span.firstKey.slice(0, 4));
  const lastYear = Number(span.lastKey.slice(0, 4));
  for (let year = firstYear; year <= lastYear && ticks.length < 400; year += 1) {
    ticks.push({
      key: `${year}`,
      label: `${year}`,
      isYearStart: true,
      range: makeYearRange(localAnchorISO(year, 6, 15)),
    });
  }
  return ticks;
}

/**
 * TimeRange 自带的粒度键：日 → `YYYY-MM-DD`，月 → `YYYY-MM`，年 → `YYYY`。
 * 用 `startAt` 按**设备时区**推——range 本来就是按本地日/月边界造出来的。
 */
export function rangeKeyOf(range: TimeRange): string {
  const key = localDayKeyOfISO(range.startAt);
  if (range.granularity === 'day') return key;
  if (range.granularity === 'month') return key.slice(0, 7);
  return key.slice(0, 4);
}

/**
 * 归属日是否落在时间窗口里。
 *
 * 刻意用**离散日键比较**而不是时刻区间求交：一张照片的归属日是「10-12」，
 * 它就只属于 10-12 这一格。用区间求交会让跨午夜的到访同时出现在两格里，
 * 时间轴上的计数和地图上的标记数就对不上了。
 */
export function isDayKeyInRange(dayKey: string, range: TimeRange): boolean {
  const key = rangeKeyOf(range);
  if (range.granularity === 'day') return dayKey === key;
  if (range.granularity === 'month') return dayKey.slice(0, 7) === key;
  return dayKey.slice(0, 4) === key;
}

/**
 * 把当前选中的时间拉回有效范围。
 *
 * 数据一变就调用它：删掉最新一堆照片后，滑块不能还停在已经不存在的月份上。
 * 落点是「离原选中位置最近的刻度」——删除最早那批时用户停在原处不动，
 * 删除最新那批时自然退到新的最晚一格，两种情况都不需要额外规则。
 */
export function reconcileRangeToSpan(range: TimeRange, span: MediaSpan): TimeRange {
  const ticks = buildTimelineTicks(span);
  if (ticks.length === 0) return range;

  // 已经落在某个刻度上就原样返回：引用不变，订阅者不会被白通知一次
  const key = rangeKeyOf(range);
  if (range.granularity === span.granularity) {
    const hit = ticks.find((tick) => tick.key === key);
    if (hit) return range;
  }

  return ticks[closestTickIndex(ticks, rangeCenterISO(range))].range;
}


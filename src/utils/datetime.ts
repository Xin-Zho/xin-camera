/**
 * 日期时间格式化与描述。所有展示文案集中在这里，避免各页面各写一套。
 * mock 时间统一使用 +08:00 时区，保证真机与开发机解析一致。
 */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function toDate(iso: string): Date {
  return new Date(iso);
}

export function formatDay(iso: string): string {
  const d = toDate(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatDayFull(iso: string): string {
  const d = toDate(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatWeekday(iso: string): string {
  return WEEKDAYS[toDate(iso).getDay()] ?? '';
}

export function formatClock(iso: string): string {
  const d = toDate(iso);
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatYearMonth(iso: string): string {
  const d = toDate(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

export function formatYear(iso: string): string {
  return `${toDate(iso).getFullYear()}`;
}

/** 到访时段的粗略描述，用于默认标题区分同日多次 */
export function partOfDay(iso: string): string {
  const h = toDate(iso).getHours();
  if (h < 5) return '凌晨';
  if (h < 8) return '清晨';
  if (h < 11) return '上午';
  if (h < 13) return '中午';
  if (h < 16) return '下午';
  if (h < 19) return '傍晚';
  if (h < 22) return '晚上';
  return '深夜';
}

/** 到访时间范围，同一天只显示时分 */
export function formatVisitRange(startAt: string, endAt: string): string {
  const sameDay = isSameDay(startAt, endAt);
  if (sameDay) return `${formatClock(startAt)} – ${formatClock(endAt)}`;
  return `${formatDay(startAt)} – ${formatDay(endAt)}`;
}

export function isSameDay(a: string, b: string): boolean {
  const da = toDate(a);
  const db = toDate(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/**
 * 故事默认标题：`地点名 · 到访日期`（规格 §7.2 第 4 条）。
 * 同一天同一地点有多本时由调用方传入序号或时段后缀。
 */
export function defaultStoryTitle(placeName: string, startAt: string, suffix?: string): string {
  const base = `${placeName} · ${formatDay(startAt)}`;
  return suffix ? `${base} ${suffix}` : base;
}

/** 列表分组标题：今天 / 昨天 / 10月12日 周一 / 2025年 */
export function formatGroupHeader(iso: string, now: Date = new Date()): string {
  const d = toDate(iso);
  const sameYear = d.getFullYear() === now.getFullYear();
  if (sameYear && isSameDay(iso, now.toISOString())) return '今天';
  const yesterday = new Date(now.getTime() - 86400000);
  if (sameYear && isSameDay(iso, yesterday.toISOString())) return '昨天';
  if (sameYear) return `${formatDay(iso)} ${formatWeekday(iso)}`;
  return formatYearMonth(iso);
}

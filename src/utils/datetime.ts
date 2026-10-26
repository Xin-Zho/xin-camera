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
  return partOfDayFromHour(toDate(iso).getHours());
}

export function partOfDayFromHour(h: number): string {
  if (h < 5) return '凌晨';
  if (h < 8) return '清晨';
  if (h < 11) return '上午';
  if (h < 13) return '中午';
  if (h < 16) return '下午';
  if (h < 19) return '傍晚';
  if (h < 22) return '晚上';
  return '深夜';
}

/**
 * 直接读 ISO 字面量里的时分 / 小时。
 *
 * 为什么需要：导入的 `startAt` 带着**拍摄地偏移**（例如 `…T21:30:00+09:00`），
 * 而 `getHours()` 一律按设备时区解读，会把 21:30 显示成 20:30。
 * 「哪一天」已经由 dateKey 钉住了，「几点」也不该再被设备时区改写。
 * 只对带 dateKey 的导入数据用这两个函数，示例数据保持原行为（避免改掉既有观感）。
 */
export function formatClockLiteral(iso: string): string {
  const match = iso.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : formatClock(iso);
}

export function partOfDayLiteral(iso: string): string {
  const match = iso.match(/T(\d{2}):/);
  return partOfDayFromHour(match ? Number(match[1]) : toDate(iso).getHours());
}

/** 到访时间范围，同一天只显示时分 */
export function formatVisitRange(startAt: string, endAt: string): string {
  // 只有一张照片的到访起止是同一时刻，写成「14:08 – 14:08」会看起来像 bug
  if (toDate(startAt).getTime() === toDate(endAt).getTime()) return formatClock(startAt);
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

/**
 * ---- 归属日（YYYY-MM-DD）路径 ----
 *
 * 下面的函数只吃日期键，不经过 `new Date(iso)` 再做本地时区解读。
 * 为什么必须分开一套：真实相册导入的归属日是在导入时**固定**下来的，
 * 如果展示层又用设备时区重新解读一次，换时区就会把那天整个挪走，
 * 「固定」这件事等于白做。所以凡是带 dateKey 的数据，显示一律走这里。
 */

export interface DateKeyParts {
  year: number;
  month: number;
  day: number;
}

export function parseDateKey(dateKey: string | undefined | null): DateKeyParts | null {
  if (!dateKey) return null;
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** `10月24日`，与 formatDay 同风格但不看时区 */
export function formatDayKey(dateKey: string): string {
  const parts = parseDateKey(dateKey);
  if (!parts) return dateKey;
  return `${parts.month}月${parts.day}日`;
}

export function formatDayKeyFull(dateKey: string): string {
  const parts = parseDateKey(dateKey);
  if (!parts) return dateKey;
  return `${parts.year}年${parts.month}月${parts.day}日`;
}

/** 星期几。用 Date.UTC 构造，避免本地时区把日期挪一天 */
export function formatWeekdayKey(dateKey: string): string {
  const parts = parseDateKey(dateKey);
  if (!parts) return '';
  return WEEKDAYS[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()] ?? '';
}

function localDayKeyOf(now: Date): string {
  const mm = `${now.getMonth() + 1}`.padStart(2, '0');
  const dd = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

/** 列表分组标题的日期键版本：今天 / 昨天 / 10月12日 周一 / 2025年10月 */
export function formatGroupHeaderKey(dateKey: string, now: Date = new Date()): string {
  const parts = parseDateKey(dateKey);
  if (!parts) return dateKey;
  const sameYear = parts.year === now.getFullYear();
  if (sameYear && dateKey === localDayKeyOf(now)) return '今天';
  if (sameYear && dateKey === localDayKeyOf(new Date(now.getTime() - 86400000))) return '昨天';
  if (sameYear) return `${formatDayKey(dateKey)} ${formatWeekdayKey(dateKey)}`;
  return `${parts.year}年${parts.month}月`;
}

/** 把 ISO 时刻按设备时区解读成日期键，仅用于「没有固定 dateKey」的数据 */
export function localDayKeyOfISO(iso: string): string {
  return localDayKeyOf(toDate(iso));
}

/**
 * 一条数据（故事 / 到访）的日期键：优先用导入时固定的 dateKey，
 * 没有才回退到 startAt 的设备时区解读（示例数据走这条）。
 */
export function dayKeyOf(iso: string, dateKey?: string): string {
  return dateKey ?? localDayKeyOfISO(iso);
}

/**
 * 带「固定归属日」的数据用的显示函数族。
 *
 * 页面里到处写 `item.dateKey ? 按日期键 : 按设备时区` 这种三元会很快失控，
 * 而且容易漏掉一处——漏掉的那处就是换时区后唯一会跳的地方。
 * 这里把判断收在四个函数里，调用方只管传对象。
 */
export interface DatedLike {
  startAt: string;
  endAt?: string;
  dateKey?: string;
}

export function dayLabelOf(item: DatedLike, which: 'start' | 'end' = 'start'): string {
  if (item.dateKey) return formatDayKey(item.dateKey);
  return formatDay(which === 'end' ? item.endAt ?? item.startAt : item.startAt);
}

export function dayLabelFullOf(item: DatedLike): string {
  if (item.dateKey) return formatDayKeyFull(item.dateKey);
  return formatDayFull(item.startAt);
}

export function weekdayLabelOf(item: DatedLike): string {
  if (item.dateKey) return formatWeekdayKey(item.dateKey);
  return formatWeekday(item.startAt);
}

export function partOfDayOf(item: DatedLike): string {
  if (item.dateKey) return partOfDayLiteral(item.startAt);
  return partOfDay(item.startAt);
}

export function clockLabelOf(item: DatedLike, which: 'start' | 'end' = 'start'): string {
  const iso = which === 'end' ? item.endAt ?? item.startAt : item.startAt;
  return item.dateKey ? formatClockLiteral(iso) : formatClock(iso);
}

/** 同一天就不写区间；跨日写成 `10月24日 – 10月25日` */
export function dayRangeLabelOf(item: DatedLike): string {
  const start = dayLabelOf(item, 'start');
  const end = dayLabelOf(item, 'end');
  return start === end ? start : `${start} – ${end}`;
}


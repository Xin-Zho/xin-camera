/**
 * 日期归属规则（第三轮：口径验证）。
 *
 * 目标只有一句：**旅行照片回到国内后，仍然归在拍摄当地那一天。**
 *
 * 为什么需要单独一层：
 *   系统给的是「绝对时刻」（creationTime 是 Unix 时间戳），但产品要的是「日历日」。
 *   从绝对时刻到日历日必须选一个 UTC 偏移，而相册 API **没有**拍摄地时区这个字段。
 *   所以偏移只能从三个地方拿，可靠性依次下降：
 *
 *   1. EXIF `OffsetTimeOriginal` / `OffsetTime` / `OffsetTimeDigitized` —— 显式偏移，最可信；
 *   2. EXIF `DateTimeOriginal` —— 相机写的**当地墙上时间**，日期部分本身就是拍摄地日期。
 *      它没有偏移，但可以和 creationTime 相减**反推出**偏移（见 impliedOffsetMinutes），
 *      反推结果是不是整数时区、是否等于设备偏移，本身就是证据；
 *   3. 都没有 → 回退设备时区，并把「这是回退」这件事记在 source 上，不假装准确。
 *
 * 三条刻意的约束：
 *   - 不猜。拿不到就 source='device-tz'，不编一个「大概是 +09:00」；
 *   - 任何一个来源的可用性都记进 evidence，界面上逐条能看见判定依据；
 *   - 坏值（全零、1970、偏移超过 ±14h）当缺失处理，不参与判定。
 */

import { extractExifTimeFields } from './exif';
import type { LibraryMediaType } from './types';

/** 日期来源。UI 和汇总都按这个枚举分组，不允许出现隐式的第四种。 */
export type DateSource =
  /** EXIF DateTimeOriginal 的日期部分（拍摄地墙上时间，最直接的证据） */
  | 'exif-datetime-original'
  /** creationTime + EXIF 显式偏移 */
  | 'exif-offset'
  /** 回退设备时区（旧行为，会错） */
  | 'device-tz'
  /** 连绝对时刻都没有 */
  | 'none';

/** EXIF 墙上时间。没有时区含义，只在「拍摄地当地」这一坐标系里有意义。 */
export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 原始字符串，界面上直接显示，免得我解析错还看不出来 */
  raw: string;
}

/** 从 EXIF 里抽出来的时间证据 */
export interface ExifTimeEvidence {
  dateTimeOriginal: WallClock | null;
  /** 显式偏移（分钟，东为正）。来自 OffsetTimeOriginal 优先，其次 OffsetTime */
  offsetMinutes: number | null;
  /** 这个偏移是从哪个字段来的，界面显示用 */
  offsetSource: string | null;
  /** 所有命中的时间相关字段原文，按路径排序 */
  fields: { path: string; key: string; value: string }[];
  /** EXIF 里一个时间字段都没有（截图、社交软件保存的图常见） */
  noTimeFields: boolean;
}

const MAX_PLAUSIBLE_OFFSET_MINUTES = 14 * 60;

function pad2(n: number): string {
  return `${n}`.padStart(2, '0');
}

function lastSegment(path: string): string {
  const index = path.lastIndexOf('.');
  return index >= 0 ? path.slice(index + 1) : path;
}

/**
 * 解析 EXIF 日期字符串。
 * 相机写的是 `2026:09:28 06:44:12`（冒号分隔日期，不是 ISO），但有些写入方用横线，
 * 所以两种都收；带 `T` 的也收。解析不了或数值越界就返回 null，不做宽松兜底——
 * 把 `0000:00:00 00:00:00` 兜成 1900 年会让时间轴多出一段空白历史。
 */
export function parseExifWallClock(value: unknown): WallClock | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  // 2026:09:28 06:44:12 / 2026-09-28T06:44:12.123 / 2026:09:28 06:44
  const match = raw.match(
    /^(\d{4})[-:](\d{2})[-:](\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);

  if (!Number.isFinite(year + month + day + hour + minute + second)) return null;
  if (year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 60) return null;

  return { year, month, day, hour, minute, second, raw };
}

/** EXIF 偏移写法不统一，这里把见过的四种都收掉：+08:00 / +0800 / +8 / 28800 */
export function parseExifOffset(value: unknown): number | null {
  if (typeof value === 'number') return normalizeOffsetNumber(value);
  if (typeof value !== 'string') return null;

  const raw = value.trim();
  if (!raw) return null;

  const colon = raw.match(/^([+-])(\d{1,2}):(\d{2})$/);
  if (colon) {
    const sign = colon[1] === '-' ? -1 : 1;
    const minutes = sign * (Number(colon[2]) * 60 + Number(colon[3]));
    return isPlausibleOffset(minutes) ? minutes : null;
  }

  const compact = raw.match(/^([+-])(\d{1,2})(\d{2})$/);
  if (compact) {
    const sign = compact[1] === '-' ? -1 : 1;
    const minutes = sign * (Number(compact[2]) * 60 + Number(compact[3]));
    return isPlausibleOffset(minutes) ? minutes : null;
  }

  const hours = raw.match(/^([+-])(\d{1,2})(?:\.5)?$/);
  if (hours) {
    const sign = hours[1] === '-' ? -1 : 1;
    // `+05.5` 这种半小时写法真的存在（印度、尼泊尔相机）
    const fraction = raw.includes('.5') ? 30 : 0;
    const minutes = sign * (Number(hours[2]) * 60 + fraction);
    return isPlausibleOffset(minutes) ? minutes : null;
  }

  const numeric = raw.match(/^([+-]?\d+(?:\.\d+)?)$/);
  if (numeric) return normalizeOffsetNumber(Number(numeric[1]));

  return null;
}

/** 裸数字可能是「小时」（GPS TimeZoneOffset）也可能是「秒」（部分写入方），按量级区分 */
function normalizeOffsetNumber(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  if (Math.abs(value) <= 14) {
    const minutes = Math.round(value * 60);
    return isPlausibleOffset(minutes) ? minutes : null;
  }
  if (Math.abs(value) <= MAX_PLAUSIBLE_OFFSET_MINUTES * 60) {
    const minutes = Math.round(value / 60);
    return isPlausibleOffset(minutes) ? minutes : null;
  }
  return null;
}

/** 时区偏移的现实范围。超过这个值的 EXIF 字段是坏数据，不能拿它算日期。 */
export function isPlausibleOffset(minutes: number): boolean {
  return Number.isFinite(minutes) && Math.abs(minutes) <= MAX_PLAUSIBLE_OFFSET_MINUTES;
}

/**
 * 把一次 `Asset.getExif()` 的返回压成判定需要的证据。
 * 只认时间/时区相关字段，其余不管——EXIF 里花里胡哨的东西和日期口径无关。
 */
export function collectExifTimeEvidence(exif: unknown): ExifTimeEvidence {
  const fields = extractExifTimeFields(exif).map((field) => ({
    path: field.path,
    key: lastSegment(field.path).toLowerCase(),
    value: field.value,
  }));

  let dateTimeOriginal: WallClock | null = null;
  for (const field of fields) {
    if (field.key === 'datetimeoriginal') {
      dateTimeOriginal = parseExifWallClock(field.value);
      if (dateTimeOriginal) break;
    }
  }

  // 偏移优先取 Original 那一档：DateTime 那一档可能是导出软件改写的
  const offsetPriority = ['offsettimeoriginal', 'offsettimedigitized', 'offsettime', 'timezoneoffset'];
  let offsetMinutes: number | null = null;
  let offsetSource: string | null = null;
  for (const key of offsetPriority) {
    const hit = fields.find((field) => field.key === key);
    if (!hit) continue;
    const parsed = parseExifOffset(hit.value);
    if (parsed !== null) {
      offsetMinutes = parsed;
      offsetSource = hit.path;
      break;
    }
  }

  return {
    dateTimeOriginal,
    offsetMinutes,
    offsetSource,
    fields,
    noTimeFields: fields.length === 0,
  };
}

/** 给定绝对时刻和偏移，算出那个时区里的日历日（YYYY-MM-DD） */
export function dateKeyFrom(ms: number, offsetMinutes: number): string {
  const shifted = new Date(ms + offsetMinutes * 60_000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(
    shifted.getUTCDate(),
  )}`;
}

/** 墙上时间直接取日期部分，不需要任何偏移 */
export function dateKeyOfWallClock(wall: WallClock): string {
  return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}`;
}

/** 墙上时间当成 UTC 看时的毫秒数。只用来和 creationTime 相减反推偏移，不代表真实时刻。 */
export function wallClockAsUtcMs(wall: WallClock): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

/** 距当地时间午夜还有多少小时（0–12）。用于判断「换一个时区会不会就跨日了」。 */
export function hoursFromMidnight(ms: number, offsetMinutes: number): number {
  const dayMs = 86_400_000;
  const shifted = ms + offsetMinutes * 60_000;
  const msOfDay = ((shifted % dayMs) + dayMs) % dayMs;
  const hours = msOfDay / 3_600_000;
  return Math.min(hours, 24 - hours);
}

export interface ResolveShootDateInput {
  /** creationTime 换算出来的绝对时刻 */
  epochMs: number | null;
  /** 设备在该时刻的 UTC 偏移（分钟）。调用方用 deviceOffsetMinutes(ms) 算，别传当前时刻的 */
  deviceOffsetMinutes: number | null;
  /** null = EXIF 还没读；读失败也用 null，但调用方要把 failed 记在别处 */
  exif: ExifTimeEvidence | null;
  hasLocation: boolean;
}

export interface ShootDateResolution {
  epochMs: number | null;
  /** 最终归属的日历日；null = 无法判定 */
  dateKey: string | null;
  source: DateSource;
  /** 生效的偏移（分钟）。device-tz 来源时是设备偏移 */
  offsetMinutes: number | null;
  deviceOffsetMinutes: number | null;
  /** 同一时刻按设备时区算出来的日期，用于显示「如果按旧规则会归到哪天」 */
  deviceDateKey: string | null;
  /** 两个口径落在不同的一天 */
  crossDay: boolean;
  /** EXIF 内部自相矛盾（DateTimeOriginal 推定的偏移 ≠ 声明偏移，或日期不一致） */
  conflict: boolean;
  /** DateTimeOriginal 与 creationTime 相减反推的偏移 */
  impliedOffsetMinutes: number | null;
  impliedOffsetPlausible: boolean;
  /** 反推偏移与设备偏移是否一致 */
  impliedMatchesDevice: boolean | null;
  /** EXIF 墙上时间与 creationTime 差得离谱（不像真实时区偏移），因此没被采用 */
  wallClockRejected: boolean;
  /** 生效偏移下距当地午夜的小时数 */
  hoursFromMidnight: number | null;
  /** 按生效偏移，是否落在午夜前后 3 小时内 */
  nearMidnight: boolean;
  /** 逐条判定依据，界面直接列出来 */
  evidence: string[];
  /** 一句话解释为什么用这个来源 */
  reason: string;
}

const HALF_DAY_HOURS = 12;

/**
 * 核心判定。顺序见文件头 1→2→3，命中的第一个来源就是结果，
 * 但**所有**候选来源的可用性都会写进 evidence，方便对照「如果当初用另一条会归到哪天」。
 */
export function resolveShootDate(input: ResolveShootDateInput): ShootDateResolution {
  const evidence: string[] = [];

  if (input.epochMs === null) {
    return {
      epochMs: null,
      dateKey: null,
      source: 'none',
      offsetMinutes: null,
      deviceOffsetMinutes: input.deviceOffsetMinutes,
      deviceDateKey: null,
      crossDay: false,
      conflict: false,
      impliedOffsetMinutes: null,
      impliedOffsetPlausible: false,
      impliedMatchesDevice: null,
      wallClockRejected: false,
      hoursFromMidnight: null,
      nearMidnight: false,
      evidence: ['系统没有给出可解析的拍摄时刻，无法归属到任何一天'],
      reason: '没有绝对时刻，日期无从谈起',
    };
  }

  const ms = input.epochMs;
  const deviceOffset = input.deviceOffsetMinutes;
  const deviceDateKey = deviceOffset === null ? null : dateKeyFrom(ms, deviceOffset);
  if (deviceOffset === null) {
    evidence.push('设备时区偏移未知，无法给出「按旧规则会归到哪天」');
  } else {
    evidence.push(`设备时区 ${formatOffset(deviceOffset)} → 归到 ${deviceDateKey}`);
  }

  const exif = input.exif;
  const impliedOffsetMinutes =
    exif?.dateTimeOriginal != null
      ? Math.round((wallClockAsUtcMs(exif.dateTimeOriginal) - ms) / 60_000)
      : null;
  const impliedOffsetPlausible =
    impliedOffsetMinutes !== null && isPlausibleOffset(impliedOffsetMinutes);
  const impliedMatchesDevice =
    impliedOffsetMinutes !== null && deviceOffset !== null
      ? Math.abs(impliedOffsetMinutes - deviceOffset) <= 1
      : null;

  if (exif === null) {
    evidence.push('EXIF 未读取，只能按设备时区归日');
  } else if (exif.noTimeFields) {
    evidence.push('EXIF 已读，但没有任何时间/时区字段（截图、社交软件保存的图常见）');
  }

  if (exif?.dateTimeOriginal) {
    evidence.push(
      `DateTimeOriginal「${exif.dateTimeOriginal.raw}」= 拍摄地墙上时间，日期部分 ${dateKeyOfWallClock(
        exif.dateTimeOriginal,
      )}`,
    );
    if (impliedOffsetMinutes !== null) {
      evidence.push(
        impliedOffsetPlausible
          ? `它与 creationTime 相差 ${formatOffset(impliedOffsetMinutes)}，正好是现实时区偏移${
              impliedMatchesDevice ? '（等于设备偏移）' : '（不等于设备偏移）'
            }`
          : `它与 creationTime 相差 ${impliedOffsetMinutes} 分钟，不像真实时区偏移，不作为依据`,
      );
    }
  }

  if (exif?.offsetMinutes != null) {
    evidence.push(`EXIF 声明偏移 ${formatOffset(exif.offsetMinutes)}（${exif.offsetSource}）`);
  }

  let dateKey: string;
  let source: DateSource;
  let offsetMinutes: number;
  let conflict = false;
  let wallClockRejected = false;

  const wallClockUsable =
    exif?.dateTimeOriginal != null && (impliedOffsetPlausible || impliedOffsetMinutes === null);

  if (exif?.offsetMinutes != null) {
    offsetMinutes = exif.offsetMinutes;
    dateKey = dateKeyFrom(ms, offsetMinutes);
    source = 'exif-offset';
    if (exif.dateTimeOriginal) {
      const wallDate = dateKeyOfWallClock(exif.dateTimeOriginal);
      if (wallDate !== dateKey) {
        conflict = true;
        evidence.push(
          `两条 EXIF 证据不一致：声明偏移算出 ${dateKey}，墙上时间是 ${wallDate}，按声明偏移取`,
        );
      }
    }
  } else if (wallClockUsable && exif?.dateTimeOriginal) {
    dateKey = dateKeyOfWallClock(exif.dateTimeOriginal);
    source = 'exif-datetime-original';
    // 没有偏移字段时，用反推值当等效偏移；只用于算「离午夜多远」和显示
    offsetMinutes = impliedOffsetPlausible ? (impliedOffsetMinutes as number) : (deviceOffset ?? 0);
  } else {
    if (exif?.dateTimeOriginal) {
      // 墙上时间和 creationTime 差得不像任何真实时区：无法判断谁错，退回绝对时刻（更可靠的一侧）
      wallClockRejected = true;
      evidence.push('EXIF 墙上时间与 creationTime 对不上任何真实时区偏移，不采用，改按绝对时刻归日');
    }
    dateKey = deviceDateKey ?? dateKeyFrom(ms, 0);
    source = 'device-tz';
    offsetMinutes = deviceOffset ?? 0;
    if (!exif?.dateTimeOriginal) {
      evidence.push('没有可用的 EXIF 时间证据 → 回退设备时区（**这一条在海外拍摄时会错一天**）');
    }
  }

  const crossDay = deviceDateKey !== null && deviceDateKey !== dateKey;
  if (crossDay) {
    evidence.push(`口径差异：设备时区归到 ${deviceDateKey}，本次判定归到 ${dateKey}`);
  }

  const midnightHours = hoursFromMidnight(ms, offsetMinutes);
  const nearMidnight = midnightHours <= 3;

  const reason = (() => {
    switch (source) {
      case 'exif-offset':
        return `按 EXIF 声明的 ${formatOffset(offsetMinutes)} 归到 ${dateKey}`;
      case 'exif-datetime-original':
        return `按 EXIF 拍摄地墙上时间归到 ${dateKey}`;
      case 'device-tz':
        return wallClockRejected
          ? `EXIF 时间不可信，回退设备时区归到 ${dateKey}`
          : `没有 EXIF 时间证据，回退设备时区归到 ${dateKey}`;
      default:
        return '无法判定';
    }
  })();

  return {
    epochMs: ms,
    dateKey,
    source,
    offsetMinutes,
    deviceOffsetMinutes: deviceOffset,
    deviceDateKey,
    crossDay,
    conflict,
    impliedOffsetMinutes,
    impliedOffsetPlausible,
    impliedMatchesDevice,
    wallClockRejected,
    hoursFromMidnight: midnightHours,
    nearMidnight,
    evidence,
    reason,
  };
}

export function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** 来源的中文名，界面和汇总共用，不各写一份 */
export function describeDateSource(source: DateSource): string {
  switch (source) {
    case 'exif-offset':
      return 'EXIF 偏移';
    case 'exif-datetime-original':
      return 'EXIF 拍摄时间';
    case 'device-tz':
      return '设备时区';
    default:
      return '无法判定';
  }
}

export type ExifState = 'unread' | 'reading' | 'read' | 'failed';

export interface DateRuleSample {
  id: string;
  filename: string | null;
  mediaType: LibraryMediaType;
  /** PHAssetMediaSubtype 含 screenshot */
  isScreenshot: boolean;
  hasLocation: boolean;
  exifState: ExifState;
  resolution: ShootDateResolution;
}

export interface DateRuleSummary {
  total: number;
  exifRead: number;
  exifUnread: number;
  exifFailed: number;
  bySource: Record<DateSource, number>;
  /** 两个口径落在不同天：这些就是「旧规则会错」的样本 */
  crossDay: number;
  conflict: number;
  /** 已读 EXIF 仍无证据、但有定位 → 候选坐标反查的样本 */
  fallbackWithLocation: number;
  /** 上面这些里，落在设备时区午夜前后 3 小时的 → 反查真正能救回的 */
  fallbackNearMidnightWithLocation: number;
  /** 有反推偏移的样本里，反推值等于设备偏移的数量 */
  impliedMatchesDevice: number;
  impliedTotal: number;
  /** 自动结论 */
  verdict: string;
  verdictLevel: 'need-data' | 'no-need' | 'low' | 'worth' | 'unclear';
}

/**
 * 汇总。这里是「坐标反查时区是否值得加入」的判定依据：
 * 只有「已读 EXIF 仍拿不到证据 + 有坐标 + 落在午夜前后」这三个条件同时成立，
 * 反查才真的能救回一天；否则加一套离线时区边界数据只是增加包体和维护成本。
 */
export function summarizeDateRule(samples: DateRuleSample[]): DateRuleSummary {
  const bySource: Record<DateSource, number> = {
    'exif-datetime-original': 0,
    'exif-offset': 0,
    'device-tz': 0,
    none: 0,
  };

  let crossDay = 0;
  let conflict = 0;
  let exifRead = 0;
  let exifFailed = 0;
  let fallbackWithLocation = 0;
  let fallbackNearMidnightWithLocation = 0;
  let impliedMatchesDevice = 0;
  let impliedTotal = 0;

  for (const sample of samples) {
    const { resolution } = sample;
    bySource[resolution.source] += 1;
    if (sample.exifState === 'read') exifRead += 1;
    if (sample.exifState === 'failed') exifFailed += 1;
    if (resolution.crossDay) crossDay += 1;
    if (resolution.conflict) conflict += 1;
    if (resolution.impliedOffsetMinutes !== null) {
      impliedTotal += 1;
      if (resolution.impliedMatchesDevice) impliedMatchesDevice += 1;
    }
    if (sample.exifState === 'read' && resolution.source === 'device-tz' && sample.hasLocation) {
      fallbackWithLocation += 1;
      if (resolution.nearMidnight) fallbackNearMidnightWithLocation += 1;
    }
  }

  const exifUnread = samples.length - exifRead - exifFailed;

  let verdict: string;
  let verdictLevel: DateRuleSummary['verdictLevel'];

  if (exifRead === 0) {
    verdictLevel = 'need-data';
    verdict = '还没有读到任何一张的 EXIF。现在下结论等于猜——先给样本读一次 EXIF。';
  } else if (fallbackWithLocation === 0) {
    verdictLevel = 'no-need';
    verdict = `已读 ${exifRead} 张，需要靠设备时区兜底的样本为 0。坐标反查时区现在不值得做：能读到证据的都有证据，读不到的也没有坐标可反查。`;
  } else if (fallbackNearMidnightWithLocation === 0) {
    verdictLevel = 'low';
    verdict = `有 ${fallbackWithLocation} 张只能回退设备时区、但都有坐标，只是都不在午夜前后。日粒度分组基本不受影响，坐标反查优先级低——等真出现海外午夜的样本再说。`;
  } else {
    verdictLevel = 'worth';
    verdict = `有 ${fallbackNearMidnightWithLocation} 张同时满足「无 EXIF 证据 + 有坐标 + 落在午夜前后」，这部分是真会错一天的。建议只对这类样本做坐标反查，而不是全量接入离线时区边界数据。`;
  }

  return {
    total: samples.length,
    exifRead,
    exifUnread,
    exifFailed,
    bySource,
    crossDay,
    conflict,
    fallbackWithLocation,
    fallbackNearMidnightWithLocation,
    impliedMatchesDevice,
    impliedTotal,
    verdict,
    verdictLevel,
  };
}

/** 按文件名猜来源。**不是系统事实**，只用来帮人找样本，界面上必须带这个前提。 */
export function guessOriginFromFilename(filename: string | null): string | null {
  if (!filename) return null;
  const lower = filename.toLowerCase();
  if (lower.startsWith('mmexport') || lower.startsWith('wx_camera')) return '文件名像微信导出';
  if (lower.startsWith('screenshot') || lower.startsWith('rpreplay')) {
    return '文件名像截图/录屏';
  }
  if (lower.startsWith('img_') && /\.(heic|jpg|jpeg)$/.test(lower)) return null; // 相机原图，没线索
  if (/^[a-f0-9]{16,}/.test(lower)) return '文件名像第三方 App 生成';
  return null;
}

/** 分享/记录用的紧凑文本。样本证据要能拿出去对照，比截图可靠。 */
export function buildSampleReport(samples: DateRuleSample[], summary: DateRuleSummary): string {
  const lines: string[] = [];
  lines.push('# 日期口径验证记录');
  lines.push(`设备时区偏移：${formatOffset(-new Date().getTimezoneOffset())}`);
  lines.push(
    `样本 ${summary.total} · EXIF 已读 ${summary.exifRead} · 未读 ${summary.exifUnread} · 失败 ${summary.exifFailed}`,
  );
  lines.push(
    `来源：EXIF拍摄时间 ${summary.bySource['exif-datetime-original']} / EXIF偏移 ${summary.bySource['exif-offset']} / 设备时区 ${summary.bySource['device-tz']} / 无法判定 ${summary.bySource.none}`,
  );
  lines.push(
    `与设备时区跨日 ${summary.crossDay} · 证据冲突 ${summary.conflict} · 需兜底且有坐标 ${summary.fallbackWithLocation}（其中午夜前后 ${summary.fallbackNearMidnightWithLocation}）`,
  );
  lines.push('');
  for (const sample of samples) {
    const r = sample.resolution;
    lines.push(`- ${sample.id}`);
    lines.push(
      `  ${sample.mediaType}${sample.isScreenshot ? '/截图' : ''} · ${sample.filename ?? '无文件名'} · 定位${
        sample.hasLocation ? '有' : '无'
      } · EXIF ${sample.exifState}`,
    );
    lines.push(
      `  归到 ${r.dateKey ?? '—'}（${describeDateSource(r.source)}）· 设备时区口径 ${
        r.deviceDateKey ?? '—'
      }${r.crossDay ? ' ← 跨日' : ''}`,
    );
    if (r.epochMs !== null) {
      lines.push(`  UTC ${new Date(r.epochMs).toISOString()} · 推定偏移 ${r.offsetMinutes === null ? '—' : formatOffset(r.offsetMinutes)}`);
    }
    if (r.impliedOffsetMinutes !== null) {
      lines.push(
        `  反推偏移 ${formatOffset(r.impliedOffsetMinutes)}${
          r.impliedOffsetPlausible ? '' : '（不合理）'
        }${r.impliedMatchesDevice ? ' = 设备偏移' : ''}`,
      );
    }
    for (const line of r.evidence) lines.push(`  · ${line}`);
  }
  lines.push('');
  lines.push(`结论：${summary.verdict}`);
  return lines.join('\n');
}

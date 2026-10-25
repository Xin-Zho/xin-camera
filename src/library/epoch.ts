import type { EpochUnit, RawEpoch } from './types';

/**
 * 时间戳单位判定。
 *
 * 为什么不直接按注释当毫秒用：expo-media-library 58 的 `getCreationTime()` 文档说返回「秒」，
 * 但 iOS 实现 `AssetMapper.mapCreationTime` → `Date.millisecondsSince1970` 实际是毫秒。
 * 两边矛盾，所以这里只按数值量级判定，并把判定结果记在 `RawEpoch.unit` 上，
 * 界面把原始值和判定结果一起显示，单位错了能当场看出来，而不是悄悄显示成 1970 年。
 *
 * 量级依据：
 *   - 毫秒：1973-03 起就是 1e11 量级，现代照片在 1.7e12 左右
 *   - 秒    ：1973-03 起是 1e8 量级，现代照片在 1.7e9 左右
 *   - [1e9, 1e11) 按秒处理：这段毫秒只对应 1970-01 ~ 1973-03，不可能是照片
 */

/** 判定为毫秒的下界：1e11 ms ≈ 1973-03 */
export const MS_LOWER_BOUND = 1e11;
/** 判定为秒的下界：1e8 s ≈ 1973-03 */
export const S_LOWER_BOUND = 1e8;

export function classifyEpochUnit(raw: number | null | undefined): EpochUnit {
  if (raw === null || raw === undefined) return 'none';
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 'unknown';
  // 0 和负数在相册里只可能是占位值，不当成 1970 年
  if (raw <= 0) return 'unknown';
  if (raw >= MS_LOWER_BOUND) return 'ms';
  if (raw >= S_LOWER_BOUND) return 's';
  return 'unknown';
}

/** 把原始值换成毫秒；单位不明时不猜，返回 null 交给上层显示「无法解析」 */
export function toEpochMs(value: RawEpoch): number | null {
  if (value.raw === null) return null;
  switch (value.unit) {
    case 'ms':
      return value.raw;
    case 's':
      return value.raw * 1000;
    default:
      return null;
  }
}

/** 构造 RawEpoch：判定和原值一起存，避免下游各自再判一次判出不同结论 */
export function makeRawEpoch(raw: number | null | undefined): RawEpoch {
  const normalized = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  return { raw: normalized, unit: classifyEpochUnit(normalized) };
}

function pad(n: number, width = 2): string {
  return `${n}`.padStart(width, '0');
}

/** 设备时区相对 UTC 的偏移（分钟，东八区为 +480）。注意这是**设备**的，不是拍摄地的。 */
export function deviceOffsetMinutes(ms: number): number {
  return -new Date(ms).getTimezoneOffset();
}

export function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function isoFromMs(ms: number, offsetMinutes?: number): string {
  const d = new Date(ms);
  if (offsetMinutes === undefined) {
    // UTC
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(
      d.getUTCHours(),
    )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
  }
  // 用算术平移，避免依赖运行环境的本地时区设置
  const shifted = new Date(ms + offsetMinutes * 60_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate(),
  )}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(
    shifted.getUTCSeconds(),
  )}${formatOffset(offsetMinutes)}`;
}

export interface EpochDebugInfo {
  /** 原生返回值 */
  raw: number | null;
  unit: EpochUnit;
  /** 单位判定后能拿到毫秒才为 true */
  resolvable: boolean;
  utcISO: string | null;
  /** 按**设备**时区换算出来的时间，不是拍摄地时间 */
  deviceLocalISO: string | null;
  deviceOffsetMinutes: number | null;
}

/**
 * 原始时间值的完整展开，给「原始值」检查页用。
 * 刻意同时给出 UTC 和设备本地两个版本，因为原生 API 没有拍摄地时区这个概念，
 * 设备本地那份只是"此刻这台手机的解释"，不代表拍摄当时当地的时间。
 */
export function describeEpoch(value: RawEpoch, deviceOffset?: number): EpochDebugInfo {
  const ms = toEpochMs(value);
  if (ms === null) {
    return {
      raw: value.raw,
      unit: value.unit,
      resolvable: false,
      utcISO: null,
      deviceLocalISO: null,
      deviceOffsetMinutes: null,
    };
  }
  const offset = deviceOffset ?? deviceOffsetMinutes(ms);
  return {
    raw: value.raw,
    unit: value.unit,
    resolvable: true,
    utcISO: isoFromMs(ms),
    deviceLocalISO: isoFromMs(ms, offset),
    deviceOffsetMinutes: offset,
  };
}

/** 网格用的短时间：设备本地 `MM-DD HH:mm`；拿不到就明确写缺失，不填空串 */
export function formatShortTime(value: RawEpoch): string {
  const ms = toEpochMs(value);
  if (ms === null) {
    return value.unit === 'none' ? '无拍摄时间' : '时间无法解析';
  }
  const offset = deviceOffsetMinutes(ms);
  const shifted = new Date(ms + offset * 60_000);
  return `${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(
    shifted.getUTCHours(),
  )}:${pad(shifted.getUTCMinutes())}`;
}

/** 单位的中文解释，界面上跟着原始值一起显示 */
export function describeUnit(unit: EpochUnit): string {
  switch (unit) {
    case 'ms':
      return '按毫秒解释';
    case 's':
      return '按秒解释';
    case 'none':
      return '系统未提供';
    default:
      return '单位无法判定';
  }
}

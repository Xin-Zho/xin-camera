/**
 * 从 EXIF 里挑出所有和时间、时区相关的字段。
 *
 * 为什么单独做这一步：原生 API 没有「拍摄地时区」这种一等公民字段，
 * 唯一可能带时区信息的地方是原图 EXIF 里的 `OffsetTimeOriginal` 之类的 tag。
 * 这些 tag 是**可能**有，不是一定有（截图、微信保存的图、编辑过的图常常没有）。
 * 所以这里只做「有就列出来」，列不出来就是没有，不推断。
 */

/** 只关心这几个前缀，其他 EXIF 字段对日期口径没有帮助 */
const TIME_KEY_PATTERN =
  /^(DateTime|DateTimeOriginal|DateTimeDigitized|OffsetTime|OffsetTimeOriginal|OffsetTimeDigitized|GPSDateStamp|GPSTimeStamp|TimeZone|TimeZoneOffset)$/i;

export interface ExifTimeField {
  /** 嵌套路径，例如 `Exif.OffsetTimeOriginal` */
  path: string;
  value: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 深度优先收集时间相关字段。深度上限 4，够覆盖 EXIF 的 `{Exif:{...}} / {TIFF:{...}} / {GPS:{...}}` 结构，
 * 也避免某些相机写入的诡异嵌套把递归拖长。
 */
export function extractExifTimeFields(exif: unknown, maxDepth = 4): ExifTimeField[] {
  const out: ExifTimeField[] = [];
  const walk = (node: unknown, path: string, depth: number) => {
    if (depth > maxDepth || !isPlainObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (isPlainObject(value)) {
        walk(value, nextPath, depth + 1);
        continue;
      }
      if (Array.isArray(value)) {
        if (value.length > 0 && value.every((v) => typeof v === 'number' || typeof v === 'string')) {
          if (TIME_KEY_PATTERN.test(key)) out.push({ path: nextPath, value: value.join(', ') });
        }
        continue;
      }
      if (TIME_KEY_PATTERN.test(key) && (typeof value === 'string' || typeof value === 'number')) {
        out.push({ path: nextPath, value: `${value}` });
      }
    }
  };
  walk(exif, '', 0);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** EXIF 顶层有哪些分组，用于判断"读到了但没内容"和"根本没读到" */
export function exifTopLevelKeys(exif: unknown): string[] {
  return isPlainObject(exif) ? Object.keys(exif) : [];
}

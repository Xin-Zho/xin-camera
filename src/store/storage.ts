import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 存档健康状态与「隔离存档」。
 *
 * 两个不同的失败要分开表达，因为用户能做的事不一样：
 *  - 存储本身不可用（原生模块缺失、宿主限制）→ 写不进去，本次运行的修改不会保留；
 *  - 存档能读到但读不懂（JSON 坏了、结构对不上）→ 能写进去，但**不能**直接把旧的盖掉，
 *    否则用户攒了很久的标题、合并、删除记录就一次性没了。
 *
 * 所以坏存档一律先原样抄一份到隔离区（`xin-camera-store__quarantine`），再让本次运行用示例数据。
 * 隔离区只留最近一份，避免长期累积把 storage 塞满。
 */

export const QUARANTINE_KEY = 'xin-camera-store__quarantine';

export type StorageIssue =
  | { kind: 'none' }
  /** 存不了：本次运行的修改只在内存里 */
  | { kind: 'unavailable'; detail: string }
  /** 存档 JSON 解析不了，已备份原样文本 */
  | { kind: 'archive-invalid'; detail: string; bytes: number }
  /** JSON 是好的但结构对不上（一条可用故事都没有），已备份 */
  | { kind: 'archive-empty'; detail: string; bytes: number };

export interface QuarantineRecord {
  /** 备份时间 */
  capturedAt: string;
  /** 为什么备份 */
  reason: string;
  /** 从哪个 key 抄出来的 */
  sourceKey: string;
  bytes: number;
  /** 原始文本，不做任何改写 */
  payload: string;
}

export function describeStorageIssue(issue: StorageIssue): {
  title: string;
  body: string;
  tone: 'none' | 'warning' | 'danger';
} | null {
  switch (issue.kind) {
    case 'none':
      return null;
    case 'unavailable':
      return {
        title: '本地存储不可用，当前修改仅在本次运行有效',
        body: `退出或重载 App 后会回到示例数据。原因：${issue.detail}`,
        tone: 'danger',
      };
    case 'archive-invalid':
      return {
        title: '上次的存档读不出来，已原样备份',
        body: `存档不是合法 JSON（${issue.bytes} 字节）。这次先用示例数据打开，原始内容已备份到隔离区，可以进去看或导出。`,
        tone: 'warning',
      };
    case 'archive-empty':
      return {
        title: '上次的存档结构对不上，已原样备份',
        body: `存档能解析，但里面没有一条可用的故事记录（${issue.bytes} 字节）。这次先用示例数据打开，原始内容已备份到隔离区。`,
        tone: 'warning',
      };
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : JSON.stringify(error);
}

/**
 * 把读不懂的存档抄一份。返回写入的字节数；失败返回 null（调用方据此降级成"存不了"）。
 */
export async function writeQuarantine(
  payload: string,
  sourceKey: string,
  reason: string,
): Promise<number | null> {
  const record: QuarantineRecord = {
    capturedAt: new Date().toISOString(),
    reason,
    sourceKey,
    bytes: payload.length,
    payload,
  };
  try {
    await AsyncStorage.setItem(QUARANTINE_KEY, JSON.stringify(record));
    return payload.length;
  } catch (error) {
    console.warn('[store] 备份隔离存档失败', messageOf(error));
    return null;
  }
}

export async function readQuarantine(): Promise<QuarantineRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(QUARANTINE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<QuarantineRecord>;
    if (typeof parsed.payload !== 'string') return null;
    return {
      capturedAt: parsed.capturedAt ?? '',
      reason: parsed.reason ?? '',
      sourceKey: parsed.sourceKey ?? '',
      bytes: typeof parsed.bytes === 'number' ? parsed.bytes : parsed.payload.length,
      payload: parsed.payload,
    };
  } catch (error) {
    console.warn('[store] 读取隔离存档失败', messageOf(error));
    return null;
  }
}

export async function clearQuarantine(): Promise<boolean> {
  try {
    await AsyncStorage.removeItem(QUARANTINE_KEY);
    return true;
  } catch (error) {
    console.warn('[store] 删除隔离存档失败', messageOf(error));
    return false;
  }
}

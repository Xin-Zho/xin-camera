import type { ImageSourcePropType } from 'react-native';

/**
 * 媒体资源解析层。
 *
 * 两种来源：
 *  1. 示例素材：`MediaAsset.uri` 是 `mock:<slug>` 键，require 只能写字面量，集中在这里维护；
 *  2. 真实相册导入：uri 是 `file://…`（`Asset.getUri()` 导出的临时副本），直接交给 Image。
 *
 * 真实文件走的是通用分支，不是"特例"：以后换成 App 沙盒内的持久路径也不用改这里。
 */
const SOURCES: Record<string, ImageSourcePropType> = {
  'mock:bay-a1': require('../../assets/mock/bay-a1.jpg'),
  'mock:bay-a2': require('../../assets/mock/bay-a2.jpg'),
  'mock:bay-a3': require('../../assets/mock/bay-a3.jpg'),
  'mock:bay-a4': require('../../assets/mock/bay-a4.jpg'),
  'mock:bay-b1': require('../../assets/mock/bay-b1.jpg'),
  'mock:bay-b2': require('../../assets/mock/bay-b2.jpg'),
  'mock:bay-b3': require('../../assets/mock/bay-b3.jpg'),
  'mock:bay-c1': require('../../assets/mock/bay-c1.jpg'),
  'mock:bay-c2': require('../../assets/mock/bay-c2.jpg'),
  'mock:bay-c3': require('../../assets/mock/bay-c3.jpg'),
  'mock:cafe-1': require('../../assets/mock/cafe-1.jpg'),
  'mock:cafe-2': require('../../assets/mock/cafe-2.jpg'),
  'mock:cafe-3': require('../../assets/mock/cafe-3.jpg'),
  'mock:bell-1': require('../../assets/mock/bell-1.jpg'),
  'mock:bell-2': require('../../assets/mock/bell-2.jpg'),
  'mock:museum-1': require('../../assets/mock/museum-1.jpg'),
  'mock:museum-2': require('../../assets/mock/museum-2.jpg'),
  'mock:hk-1': require('../../assets/mock/hk-1.jpg'),
  'mock:hk-2': require('../../assets/mock/hk-2.jpg'),
  'mock:hk-3': require('../../assets/mock/hk-3.jpg'),
  'mock:dapeng-1': require('../../assets/mock/dapeng-1.jpg'),
  'mock:dapeng-2': require('../../assets/mock/dapeng-2.jpg'),
  'mock:book-1': require('../../assets/mock/book-1.jpg'),
  'mock:book-2': require('../../assets/mock/book-2.jpg'),
};

export function resolveMediaSource(uri: string): ImageSourcePropType | undefined {
  const known = SOURCES[uri];
  if (known) return known;
  // 空 uri 表示"导入时没拿到文件"。返回 undefined 让调用方画占位，
  // 不要返回 { uri: '' } —— RN 会把它当成加载失败，日志里一片红但没有信息量
  if (!uri) return undefined;
  if (uri.startsWith('mock:')) return undefined; // 素材改名后失效的旧键，不当真实路径用
  return { uri };
}

/** 供数据自检使用 */
export function knownMediaKeys(): string[] {
  return Object.keys(SOURCES);
}

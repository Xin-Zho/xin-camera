import type { ImageSourcePropType } from 'react-native';

/**
 * 媒体资源解析层。
 *
 * 原型阶段 `MediaAsset.uri` 存的是 `mock:<slug>` 键，不是真实路径，
 * 这样：
 *  1. 类型保持 string，和将来接入真实照片库时一致；
 *  2. require 只能写字面量，集中在这里维护才不会散落各处；
 *  3. 换素材只改这一个文件。
 *
 * 第二阶段接入 iOS 照片库后，这里可以退化成直接返回 { uri }。
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
  return SOURCES[uri];
}

/** 供数据自检使用 */
export function knownMediaKeys(): string[] {
  return Object.keys(SOURCES);
}

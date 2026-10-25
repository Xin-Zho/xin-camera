import { mockMedia, mockMediaById } from './mockMedia';
import { mockPlaces, mockPlacesById } from './mockPlaces';
import { mockVisits, mockVisitsById } from './mockVisits';
import { mockStories, mockStoriesById } from './mockStories';
import { resolveMediaSource } from './mediaSource';

export { mockMedia, mockMediaById } from './mockMedia';
export { mockPlaces, mockPlacesById } from './mockPlaces';
export { mockVisits, mockVisitsById } from './mockVisits';
export { mockStories, mockStoriesById } from './mockStories';
export { resolveMediaSource } from './mediaSource';

/**
 * mock 数据自检。只在开发期调用（__DEV__），不阻塞生产。
 * 返回问题列表，空数组表示所有 ID 互相对应、图片资源都存在。
 * 对应规格 §11 Agent 4 的交付要求。
 */
export function checkMockIntegrity(): string[] {
  const issues: string[] = [];

  mockMedia.forEach((m) => {
    if (!resolveMediaSource(m.uri)) issues.push(`媒体资源缺失: ${m.id} -> ${m.uri}`);
    if (m.visitId && !mockVisitsById.has(m.visitId)) {
      issues.push(`媒体指向不存在的到访: ${m.id} -> ${m.visitId}`);
    }
    if (m.placeId && !mockPlacesById.has(m.placeId)) {
      issues.push(`媒体指向不存在的地点: ${m.id} -> ${m.placeId}`);
    }
  });

  mockVisits.forEach((v) => {
    if (!mockPlacesById.has(v.placeId)) issues.push(`到访指向不存在的地点: ${v.id} -> ${v.placeId}`);
    if (!v.mediaIds.includes(v.coverMediaId)) {
      issues.push(`到访代表照片不在媒体列表中: ${v.id} -> ${v.coverMediaId}`);
    }
    v.mediaIds.forEach((mid) => {
      const media = mockMediaById.get(mid);
      if (!media) issues.push(`到访引用不存在的媒体: ${v.id} -> ${mid}`);
      else if (media.visitId !== v.id) {
        issues.push(`媒体归属不一致: ${mid} 属于 ${media.visitId ?? '(空)'}，被 ${v.id} 引用`);
      }
    });
  });

  mockPlaces.forEach((p) => {
    p.visitIds.forEach((vid) => {
      const visit = mockVisitsById.get(vid);
      if (!visit) issues.push(`地点引用不存在的到访: ${p.id} -> ${vid}`);
      else if (visit.placeId !== p.id) {
        issues.push(`到访归属不一致: ${vid} 属于 ${visit.placeId}，被 ${p.id} 引用`);
      }
    });
  });

  mockStories.forEach((s) => {
    s.mediaIds.forEach((mid) => {
      if (!mockMediaById.has(mid)) issues.push(`故事引用不存在的媒体: ${s.id} -> ${mid}`);
    });
    s.visitIds.forEach((vid) => {
      if (!mockVisitsById.has(vid)) issues.push(`故事引用不存在的到访: ${s.id} -> ${vid}`);
    });
    s.placeIds.forEach((pid) => {
      if (!mockPlacesById.has(pid)) issues.push(`故事引用不存在的地点: ${s.id} -> ${pid}`);
    });
    if (!s.mediaIds.includes(s.coverMediaId)) {
      issues.push(`故事封面不在媒体列表中: ${s.id} -> ${s.coverMediaId}`);
    }
    s.highlightedMediaIds.forEach((mid) => {
      if (!s.mediaIds.includes(mid)) issues.push(`重点照片不在故事媒体中: ${s.id} -> ${mid}`);
    });
    (s.mergedFromStoryIds ?? []).forEach((sid) => {
      if (!mockStoriesById.has(sid)) issues.push(`合并来源不存在: ${s.id} -> ${sid}`);
    });
  });

  // 规格 §7.2：自动生成的故事与 Visit 应为 1:1（合并产生的合集除外）
  mockStories.forEach((s) => {
    const isMerged = (s.mergedFromStoryIds?.length ?? 0) > 0;
    if (!isMerged && s.visitIds.length !== 1) {
      issues.push(`故事未合并却有 ${s.visitIds.length} 个到访: ${s.id}`);
    }
  });

  return issues;
}

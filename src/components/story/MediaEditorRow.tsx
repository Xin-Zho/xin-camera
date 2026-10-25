import { SymbolView } from 'expo-symbols';
import { memo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { resolveMediaSource } from '@/src/data';
import type { MediaAsset } from '@/src/domain/types';
import { colors, radius, spacing, typography } from '@/src/theme';
import { formatClock } from '@/src/utils/datetime';

/**
 * 编辑页的一张照片。
 * 三个操作都在行内，不再开二级菜单：
 *  - 点行进整行 → 设为封面
 *  - 星标 → 重点照片（阅读页可据此加重）
 *  - 上下箭头 → 调顺序
 */
interface Props {
  media: MediaAsset;
  index: number;
  total: number;
  isCover: boolean;
  isHighlighted: boolean;
  /**
   * 回调统一带 mediaId 参数，而不是在父级用内联箭头函数包住。
   * 这样父级可以把回调做成稳定引用，memo 才真的生效
   * （内联箭头函数每次渲染都是新引用，memo 等于没写）。
   */
  onSetCover: (mediaId: string) => void;
  onToggleHighlight: (mediaId: string) => void;
  onMove: (mediaId: string, direction: -1 | 1) => void;
}

export const MediaEditorRow = memo(function MediaEditorRow({
  media,
  index,
  total,
  isCover,
  isHighlighted,
  onSetCover,
  onToggleHighlight,
  onMove,
}: Props) {
  const canUp = index > 0;
  const canDown = index < total - 1;
  const source = resolveMediaSource(media.uri);

  return (
    <Pressable
      onPress={() => onSetCover(media.id)}
      style={[styles.row, isCover && styles.rowCover]}
      accessibilityLabel={`第 ${index + 1} 张，${isCover ? '当前封面' : '未设为封面'}，点按设为封面`}>
      <View style={styles.thumbWrap}>
        {source ? (
          <Image source={source} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback]} />
        )}
        {isCover ? (
          <View style={styles.coverBadge}>
            <Text style={styles.coverBadgeText} allowFontScaling={false}>
              封面
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.info}>
        <Text style={styles.line1} numberOfLines={1}>
          第 {index + 1} 张 · {formatClock(media.capturedAt)}
          {media.kind === 'video' ? ' · 视频' : ''}
        </Text>
        <Text style={[styles.line2, isCover && styles.line2Active]} numberOfLines={1}>
          {isCover ? '当前封面' : '点按设为封面'}
        </Text>
      </View>

      <Pressable
        onPress={() => onToggleHighlight(media.id)}
        hitSlop={8}
        style={styles.starButton}
        accessibilityLabel={isHighlighted ? '取消重点照片' : '设为重点照片'}>
        <SymbolView
          name={{
            ios: isHighlighted ? 'star.fill' : 'star',
            android: 'star',
            web: 'star',
          }}
          tintColor={isHighlighted ? colors.accent : colors.textTertiary}
          size={18}
        />
      </Pressable>

      <View style={styles.moveGroup}>
        <Pressable
          onPress={() => onMove(media.id, -1)}
          disabled={!canUp}
          hitSlop={6}
          style={[styles.moveButton, !canUp && styles.moveDisabled]}
          accessibilityLabel="上移">
          <SymbolView
            name={{ ios: 'chevron.up', android: 'expand_less', web: 'expand_less' }}
            tintColor={colors.textSecondary}
            size={13}
          />
        </Pressable>
        <Pressable
          onPress={() => onMove(media.id, 1)}
          disabled={!canDown}
          hitSlop={6}
          style={[styles.moveButton, !canDown && styles.moveDisabled]}
          accessibilityLabel="下移">
          <SymbolView
            name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }}
            tintColor={colors.textSecondary}
            size={13}
          />
        </Pressable>
      </View>
    </Pressable>
  );
});

const THUMB = 56;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
  },
  rowCover: { backgroundColor: colors.accentMuted },
  thumbWrap: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.media,
    overflow: 'hidden',
    backgroundColor: colors.mediaPlaceholder,
  },
  thumb: { width: '100%', height: '100%' },
  thumbFallback: { backgroundColor: colors.mediaPlaceholder },
  coverBadge: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    right: 0,
    paddingVertical: 1,
    alignItems: 'center',
    backgroundColor: colors.surfaceTranslucentDark,
  },
  coverBadgeText: { ...typography.caption2, fontSize: 9, color: colors.textOnMedia },
  info: { flex: 1, gap: 2 },
  line1: { ...typography.footnote, color: colors.textPrimary },
  line2: { ...typography.caption, color: colors.textTertiary },
  line2Active: { color: colors.accent },
  starButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveGroup: { gap: 2 },
  moveButton: {
    width: 28,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.backgroundGrouped,
  },
  moveDisabled: { opacity: 0.28 },
});

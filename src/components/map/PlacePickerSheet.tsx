import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveMediaSource } from '@/src/data';
import type { MapCluster } from '@/src/domain/clustering';
import type { PlaceSummary } from '@/src/domain/types';
import { colors, radius, spacing, typography } from '@/src/theme';
import { dayLabelOf, partOfDayOf } from '@/src/utils/datetime';

interface Props {
  /** 为 null 时关闭 */
  cluster: MapCluster | null;
  onSelect: (placeId: string) => void;
  onClose: () => void;
}

/**
 * 聚合后仍然分不开时的地点列表（规格 §5.3）。
 *
 * 什么时候会出现：两个地点坐标几乎重合（比如同一栋楼里的两家店），
 * 放大到最小范围也还是重叠。这时再放大没有意义，直接给列表。
 */
export function PlacePickerSheet({ cluster, onSelect, onClose }: Props) {
  const insets = useSafeAreaInsets();
  // 关闭时保留最后一次内容：否则淡出动画还没结束，列表就先空掉了。
  // 这里是 React 允许的「渲染期根据 props 调整 state」写法：条件收敛，不会死循环。
  const [shown, setShown] = useState<MapCluster | null>(cluster);
  if (cluster && cluster !== shown) setShown(cluster);

  const visible = cluster != null && cluster.placeCount > 1;
  const members = shown?.members ?? [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="关闭地点列表">
        {/* 阻止点击穿透到背景 */}
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}
          onPress={() => {}}>
          <View style={styles.grabber} />
          <Text style={styles.title}>
            {shown ? `这一带有 ${shown.placeCount} 个地点` : ''}
          </Text>
          <Text style={styles.subtitle}>它们几乎在同一个位置，选一个看那次到访</Text>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}>
            {members.map((summary) => (
              <PlaceRow
                key={summary.place.id}
                summary={summary}
                onPress={() => onSelect(summary.place.id)}
              />
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PlaceRow({ summary, onPress }: { summary: PlaceSummary; onPress: () => void }) {
  const source = summary.coverMedia ? resolveMediaSource(summary.coverMedia.uri) : undefined;
  const latest = summary.latestVisit;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityLabel={`打开 ${summary.place.name}`}>
      {source ? (
        <Image source={source} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]} />
      )}
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {summary.place.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {latest
            ? `${dayLabelOf(latest)} ${partOfDayOf(latest)}`
            : '暂无到访记录'}
          {summary.place.city ? ` · ${summary.place.city}` : ''}
        </Text>
        <Text style={styles.rowHint}>
          {summary.visitCountInRange > 0
            ? `当前时段 ${summary.visitCountInRange} 次到访`
            : '当前时段没有照片'}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.separator,
    marginBottom: spacing.md,
  },
  title: { ...typography.title2, color: colors.textPrimary },
  subtitle: {
    ...typography.footnote,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
    marginBottom: spacing.md,
  },
  list: { maxHeight: 320 },
  listContent: { paddingBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowPressed: { opacity: 0.6 },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radius.media,
    backgroundColor: colors.mediaPlaceholder,
  },
  thumbEmpty: { backgroundColor: colors.backgroundGrouped },
  rowBody: { flex: 1, gap: 1 },
  rowTitle: { ...typography.headline, color: colors.textPrimary },
  rowMeta: { ...typography.footnote, color: colors.textSecondary },
  rowHint: { ...typography.caption, color: colors.textTertiary },
  chevron: { ...typography.title2, color: colors.textTertiary, marginLeft: spacing.xs },
});

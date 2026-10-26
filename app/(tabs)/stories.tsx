import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StoryCoverCard } from '@/src/components/story/StoryCoverCard';
import { selectActiveStories, selectDeletedStories, groupStoriesByDay } from '@/src/store/selectors';
import { useAppStore } from '@/src/store/appStore';
import { colors, layout, radius, spacing, typography } from '@/src/theme';
import { dayLabelOf, formatGroupHeaderKey } from '@/src/utils/datetime';

export default function StoriesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const stories = useAppStore((s) => s.stories);
  const media = useAppStore((s) => s.media);
  const places = useAppStore((s) => s.places);
  const restoreStory = useAppStore((s) => s.restoreStory);
  const deleteStory = useAppStore((s) => s.deleteStory);
  const mergeStories = useAppStore((s) => s.mergeStories);

  const [showDeleted, setShowDeleted] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hint, setHint] = useState<string | null>(null);

  const active = useMemo(() => selectActiveStories(stories), [stories]);
  const deleted = useMemo(() => selectDeletedStories(stories), [stories]);
  const groups = useMemo(() => groupStoriesByDay(active), [active]);

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelectedIds([]);
    setHint(null);
  }, []);

  const enterSelection = useCallback((storyId?: string) => {
    setSelecting(true);
    setSelectedIds(storyId ? [storyId] : []);
    setHint(null);
  }, []);

  const toggleSelect = useCallback((storyId: string) => {
    setSelectedIds((prev) =>
      prev.includes(storyId) ? prev.filter((id) => id !== storyId) : [...prev, storyId],
    );
    setHint(null);
  }, []);

  const handleMerge = useCallback(() => {
    if (selectedIds.length < 2) return;
    // 标题留空：store 会按「地点 · 起止日期」自动生成，不打断用户输入
    const mergedId = mergeStories(selectedIds, '');
    if (!mergedId) {
      setHint('选中的故事里有已删除或已合并的，无法参与合并。');
      return;
    }
    exitSelection();
  }, [exitSelection, mergeStories, selectedIds]);

  const handleDelete = useCallback(() => {
    if (selectedIds.length === 0) return;
    selectedIds.forEach((id) => deleteStory(id));
    // 删完直接把「已删除」区展开：恢复入口要当场看得见，否则等于没做撤回
    setShowDeleted(true);
    exitSelection();
  }, [deleteStory, exitSelection, selectedIds]);

  const canMerge = selectedIds.length >= 2;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={{
          paddingTop: insets.top + spacing.lg,
          // 底部不再叠加 insets.bottom：底部 tab bar 已经占掉安全区，
          // 操作条（绝对定位在屏幕内容底部）也贴在它上面。
          paddingBottom: selecting ? 148 : spacing.huge,
          paddingHorizontal: layout.screenPadding,
        }}
        showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Text style={styles.screenTitle}>故事</Text>
          <View style={styles.headerActions}>
            {/* 真实相册的独立入口：和示例数据那条线完全分开，进去只读 */}
            {selecting ? null : (
              <Pressable
                onPress={() => router.push('/library')}
                hitSlop={8}
                style={styles.libraryPill}
                accessibilityLabel="打开真实相册（只读实验）">
                <SymbolView
                  name={{ ios: 'photo.on.rectangle', android: 'photo_library', web: 'photo_library' }}
                  tintColor={colors.textSecondary}
                  size={14}
                />
                <Text style={styles.libraryPillText}>相册</Text>
              </Pressable>
            )}
            {active.length > 0 || selecting ? (
              <Pressable
                onPress={() => (selecting ? exitSelection() : enterSelection())}
                hitSlop={10}>
                <Text style={styles.selectToggle}>{selecting ? '取消' : '选择'}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <Text style={styles.screenSub}>
          {selecting
            ? `已选 ${selectedIds.length} 本 · 长按也能多选`
            : `一次到访，一本 · 共 ${active.length} 本`}
        </Text>

        {groups.map((group) => (
          <View key={group.dayKey} style={styles.group}>
            <Text style={styles.groupHeader}>{formatGroupHeaderKey(group.dateKey)}</Text>
            {group.stories.map((story) => (
              <StoryCoverCard
                key={story.id}
                story={story}
                places={places}
                media={media}
                selectable={selecting}
                selected={selectedIds.includes(story.id)}
                onLongPress={() =>
                  selecting ? toggleSelect(story.id) : enterSelection(story.id)
                }
                onPress={() =>
                  selecting
                    ? toggleSelect(story.id)
                    : router.push({ pathname: '/story/[storyId]', params: { storyId: story.id } })
                }
              />
            ))}
          </View>
        ))}

        {active.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>还没有故事</Text>
            <Text style={styles.emptyText}>地图上点开一个地点，就会有一次到访的开始。</Text>
          </View>
        ) : null}

        {deleted.length > 0 ? (
          <View style={styles.deletedSection}>
            <Pressable onPress={() => setShowDeleted((v) => !v)} hitSlop={8}>
              <Text style={styles.deletedToggle}>
                已删除的故事 {deleted.length} 本 {showDeleted ? '收起' : '查看'}
              </Text>
            </Pressable>
            {showDeleted
              ? deleted.map((story) => (
                  <View key={story.id} style={styles.deletedRow}>
                    <View style={styles.deletedInfo}>
                      <Text style={styles.deletedTitle} numberOfLines={1}>
                        {story.title}
                      </Text>
                      <Text style={styles.deletedMeta}>
                        {dayLabelOf(story)} · 地点和照片都还在
                      </Text>
                    </View>
                    <Pressable onPress={() => restoreStory(story.id)} hitSlop={8}>
                      <Text style={styles.restoreText}>恢复</Text>
                    </Pressable>
                  </View>
                ))
              : null}
          </View>
        ) : null}
      </ScrollView>

      {selecting ? (
        <View style={[styles.actionBar, { paddingBottom: spacing.md }]}>
          <Text style={[styles.actionHint, hint ? styles.actionHintError : null]}>
            {hint ??
              (canMerge
                ? '合并后可以再拆分，原故事的标题和照片顺序都会保留'
                : '再选一本才能合并')}
          </Text>
          <View style={styles.actionRow}>
            <Pressable
              onPress={handleDelete}
              disabled={selectedIds.length === 0}
              style={[styles.secondaryButton, selectedIds.length === 0 && styles.buttonDisabled]}>
              <Text style={styles.deleteText}>
                删除{selectedIds.length > 0 ? ` ${selectedIds.length}` : ''}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleMerge}
              disabled={!canMerge}
              style={[styles.primaryButton, !canMerge && styles.buttonDisabled]}>
              <Text style={styles.primaryText}>合并为 1 本</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  screenTitle: { ...typography.largeTitle, color: colors.textPrimary },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  libraryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundGrouped,
  },
  libraryPillText: { ...typography.caption, color: colors.textSecondary },
  selectToggle: { ...typography.callout, color: colors.accent, fontWeight: '600' },
  screenSub: {
    ...typography.footnote,
    color: colors.textTertiary,
    marginTop: spacing.xs,
    marginBottom: spacing.xxl,
  },
  group: { marginBottom: spacing.sm },
  groupHeader: {
    ...typography.caption2,
    color: colors.textTertiary,
    letterSpacing: 0.8,
    marginBottom: spacing.md,
  },
  empty: { paddingVertical: spacing.huge, gap: spacing.sm },
  emptyTitle: { ...typography.title2, color: colors.textPrimary },
  emptyText: { ...typography.callout, color: colors.textSecondary },
  deletedSection: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    gap: spacing.md,
  },
  deletedToggle: { ...typography.footnote, color: colors.textTertiary },
  deletedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.backgroundGrouped,
  },
  deletedInfo: { flex: 1, gap: 2 },
  deletedTitle: { ...typography.callout, color: colors.textSecondary },
  deletedMeta: { ...typography.caption, color: colors.textTertiary },
  restoreText: { ...typography.callout, color: colors.accent },
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.md,
    paddingHorizontal: layout.screenPadding,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    backgroundColor: colors.surface,
  },
  actionHint: { ...typography.caption, color: colors.textTertiary, textAlign: 'center' },
  actionHintError: { color: colors.danger },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  secondaryButton: {
    height: layout.minTouchTarget,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundGrouped,
  },
  deleteText: { ...typography.callout, color: colors.danger, fontWeight: '600' },
  primaryButton: {
    flex: 1,
    height: layout.minTouchTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  primaryText: { ...typography.callout, color: colors.textOnMedia, fontWeight: '600' },
  buttonDisabled: { opacity: 0.38 },
});

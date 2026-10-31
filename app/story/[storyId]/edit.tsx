import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SegmentedControl } from '@/src/components/common/SegmentedControl';
import { MediaEditorRow } from '@/src/components/story/MediaEditorRow';
import type { CoverTitleMode, StoryLayout } from '@/src/domain/types';
import {
  describeHideReason,
  hideReasonOf,
  pickVisibleCover,
  visibleCount,
} from '@/src/domain/visibility';
import { useAppStore } from '@/src/store/appStore';
import { selectMediaByIds, selectVisibility } from '@/src/store/selectors';
import { colors, layout, radius, spacing, typography } from '@/src/theme';

const LAYOUT_OPTIONS: { value: StoryLayout; label: string }[] = [
  { value: 'editorial', label: '留白杂志' },
  { value: 'large-cover', label: '大图' },
  { value: 'grid', label: '网格' },
];

const COVER_TITLE_OPTIONS: { value: CoverTitleMode; label: string }[] = [
  { value: 'overlay', label: '叠在照片上' },
  { value: 'below', label: '放在照片下' },
];

const TITLE_MAX = 40;
const TEXT_MAX = 500;

/**
 * 文本字段的本地草稿 + 延迟提交。
 *
 * 为什么不每次按键都写 store：store 更新会让整个故事列表重渲染，
 * 打字时会掉帧。这里本地 state 保持输入跟手，停顿 260ms 后才提交。
 * 卸载和"完成"时都会 flush，最后几个字不会丢。
 */
function useDebouncedField(initial: string, commit: (value: string) => void, delay = 260) {
  const [draft, setDraft] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(initial);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    commitRef.current(draftRef.current);
  }, []);

  const change = useCallback(
    (value: string) => {
      draftRef.current = value;
      setDraft(value);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        commitRef.current(value);
      }, delay);
    },
    [delay],
  );

  /** 用于把输入框内容强行改回某个值（例如标题被清空时恢复原标题） */
  const restore = useCallback((value: string) => {
    // 同时清掉待提交的定时器，免得半秒后又把空值提交一次
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    draftRef.current = value;
    setDraft(value);
  }, []);

  // 卸载时补提交：用户输入完直接侧滑返回也不会丢改动
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        commitRef.current(draftRef.current);
      }
    },
    [],
  );

  return { draft, change, flush, restore };
}

export default function StoryEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { storyId } = useLocalSearchParams<{ storyId: string }>();
  const id = storyId ?? '';

  const story = useAppStore((s) => s.stories.find((x) => x.id === id));
  const media = useAppStore((s) => s.media);
  const stories = useAppStore((s) => s.stories);

  const setStoryTitle = useAppStore((s) => s.setStoryTitle);
  const setStoryText = useAppStore((s) => s.setStoryText);
  const setStoryCover = useAppStore((s) => s.setStoryCover);
  const setStoryLayout = useAppStore((s) => s.setStoryLayout);
  const setStoryCoverTitleMode = useAppStore((s) => s.setStoryCoverTitleMode);
  const moveStoryMedia = useAppStore((s) => s.moveStoryMedia);
  const toggleHighlightedMedia = useAppStore((s) => s.toggleHighlightedMedia);

  const commitTitle = useCallback((value: string) => setStoryTitle(id, value), [id, setStoryTitle]);
  const commitText = useCallback((value: string) => setStoryText(id, value), [id, setStoryText]);

  const title = useDebouncedField(story?.title ?? '', commitTitle);
  const note = useDebouncedField(story?.userText ?? '', commitText);

  const items = useMemo(
    () => (story ? selectMediaByIds(media, story.mediaIds) : []),
    [media, story],
  );

  const visibility = useMemo(() => selectVisibility(media, stories), [stories, media]);

  /**
   * 实际被当成封面的那张。
   * `story.coverMediaId` 可能指向一张已移除的照片——阅读页会回退到第一张可见的，
   * 编辑页的「封面」标记必须落在同一张上，否则两处会指着不同的照片。
   */
  const effectiveCoverId = useMemo(() => {
    if (!story) return undefined;
    const index = new Map(media.map((m) => [m.id, m]));
    return pickVisibleCover(story.mediaIds, story.coverMediaId, index, visibility)?.id;
  }, [media, story, visibility]);

  const hiddenCount = useMemo(
    () => (story ? story.mediaIds.length - visibleCount(story.mediaIds, visibility) : 0),
    [story, visibility],
  );

  // 稳定引用，才能让 MediaEditorRow 的 memo 真的生效（避免打字时照片行全部重渲染）
  const handleSetCover = useCallback(
    (mediaId: string) => setStoryCover(id, mediaId),
    [id, setStoryCover],
  );
  const handleToggleHighlight = useCallback(
    (mediaId: string) => toggleHighlightedMedia(id, mediaId),
    [id, toggleHighlightedMedia],
  );
  const handleMove = useCallback(
    (mediaId: string, direction: -1 | 1) => moveStoryMedia(id, mediaId, direction),
    [id, moveStoryMedia],
  );

  const handleDone = useCallback(() => {
    // 先把还没提交的草稿落库，再返回；否则刚敲的字会丢
    title.flush();
    note.flush();
    router.back();
  }, [note, router, title]);

  const handleTitleBlur = useCallback(() => {
    if (title.draft.trim().length === 0) {
      // 标题不允许为空，清空后回退到原标题，避免列表出现无标题卡片
      title.restore(story?.title ?? '');
      return;
    }
    title.flush();
  }, [story?.title, title]);

  if (!story) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.missing}>这本故事不在了。</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <Pressable
          onPress={handleDone}
          hitSlop={8}
          style={styles.headerSide}
          accessibilityLabel="返回">
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            tintColor={colors.textPrimary}
            size={20}
          />
        </Pressable>
        <Text style={styles.headerTitle}>编辑故事</Text>
        <Pressable
          onPress={handleDone}
          hitSlop={8}
          style={[styles.headerSide, styles.headerSideRight]}
          accessibilityLabel="完成编辑">
          <Text style={styles.doneText}>完成</Text>
        </Pressable>
      </View>

      {/* 顶部栏留在键盘避让之外，只有内容区跟着键盘上移，否则标题栏会被顶出屏幕 */}
      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.root}
          contentContainerStyle={{
            paddingTop: spacing.lg,
            paddingBottom: insets.bottom + spacing.huge,
            paddingHorizontal: layout.screenPadding,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}>
          <TextInput
            value={title.draft}
            onChangeText={title.change}
            onBlur={handleTitleBlur}
            placeholder="故事标题"
            placeholderTextColor={colors.textTertiary}
            maxLength={TITLE_MAX}
            style={styles.titleInput}
            returnKeyType="done"
            accessibilityLabel="故事标题"
          />

          <TextInput
            value={note.draft}
            onChangeText={note.change}
            placeholder="写点什么。只有你看得见。"
            placeholderTextColor={colors.textTertiary}
            maxLength={TEXT_MAX}
            multiline
            style={styles.noteInput}
            textAlignVertical="top"
            accessibilityLabel="故事正文"
          />

          <View style={styles.rule} />

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>版式</Text>
            <SegmentedControl
              options={LAYOUT_OPTIONS}
              value={story.layout}
              onChange={(next) => setStoryLayout(id, next)}
              groupLabel="排版版式"
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>封面标题</Text>
            <SegmentedControl
              options={COVER_TITLE_OPTIONS}
              value={story.coverTitleMode ?? 'below'}
              onChange={(next) => setStoryCoverTitleMode(id, next)}
              groupLabel="封面标题位置"
            />
          </View>

          <View style={styles.section}>
            <View style={styles.mediaHeader}>
              <Text style={styles.sectionLabel}>照片</Text>
              <Text style={styles.mediaCount}>
                {visibleCount(story.mediaIds, visibility)} 张
                {hiddenCount > 0 ? ` · ${hiddenCount} 张已隐藏` : ''}
              </Text>
            </View>
            <Text style={styles.hint}>点按设为封面 · 星标是重点照片 · 箭头调顺序</Text>
            {hiddenCount > 0 ? (
              <Text style={styles.hiddenHint}>
                变淡的照片不会出现在地图、图库和阅读页里。移除的可以在设置 →「已移除的照片」中恢复。
              </Text>
            ) : null}

            <View style={styles.mediaList}>
              {story.mediaIds.map((mediaId, index) => {
                const item = items.find((m) => m.id === mediaId);
                if (!item) return null;
                const reason = hideReasonOf(visibility, mediaId);
                return (
                  <MediaEditorRow
                    key={mediaId}
                    media={item}
                    index={index}
                    total={story.mediaIds.length}
                    isCover={effectiveCoverId === mediaId}
                    isHighlighted={story.highlightedMediaIds.includes(mediaId)}
                    hidden={reason !== null}
                    hiddenLabel={reason ? describeHideReason(reason) : undefined}
                    onSetCover={handleSetCover}
                    onToggleHighlight={handleToggleHighlight}
                    onMove={handleMove}
                  />
                );
              })}
            </View>
          </View>

          <Text style={styles.footer}>改动即时保存。</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  missing: { ...typography.callout, color: colors.textSecondary },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  headerSide: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSideRight: { alignItems: 'flex-end' },
  headerTitle: { ...typography.headline, color: colors.textPrimary, flex: 1, textAlign: 'center' },
  doneText: { ...typography.callout, color: colors.accent, fontWeight: '600' },

  titleInput: {
    ...typography.title2,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
    paddingHorizontal: 0,
  },
  noteInput: {
    ...typography.body,
    color: colors.textPrimary,
    minHeight: 76,
    paddingTop: spacing.sm,
    paddingHorizontal: 0,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginVertical: spacing.xl,
  },
  section: { marginBottom: spacing.xl },
  sectionLabel: {
    ...typography.caption2,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  mediaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mediaCount: { ...typography.caption, color: colors.textSecondary },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
  },
  hiddenHint: {
    ...typography.caption,
    color: colors.danger,
    marginBottom: spacing.sm,
    lineHeight: 17,
  },
  mediaList: { gap: spacing.xxs },
  footer: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});

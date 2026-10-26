import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Dimensions,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveMediaSource } from '@/src/data';
import type { MediaAsset } from '@/src/domain/types';
import { hideReasonOf } from '@/src/domain/visibility';
import {
  selectMediaOfVisit,
  selectPlaceById,
  selectVisibility,
  selectVisitById,
} from '@/src/store/selectors';
import { useAppStore } from '@/src/store/appStore';
import { colors, layout, radius, spacing, typography } from '@/src/theme';
import {
  clockLabelOf,
  dayLabelFullOf,
  partOfDayOf,
  weekdayLabelOf,
} from '@/src/utils/datetime';

const COLUMNS = 3;
const GAP = 3;
const SCREEN_WIDTH = Dimensions.get('window').width;
const TILE = Math.floor((SCREEN_WIDTH - layout.screenPadding * 2 - GAP * (COLUMNS - 1)) / COLUMNS);

export default function VisitGalleryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { visitId } = useLocalSearchParams<{ visitId: string }>();

  const visits = useAppStore((s) => s.visits);
  const places = useAppStore((s) => s.places);
  const media = useAppStore((s) => s.media);
  const stories = useAppStore((s) => s.stories);
  const removeMedia = useAppStore((s) => s.removeMedia);
  const restoreMedia = useAppStore((s) => s.restoreMedia);

  const visit = selectVisitById(visits, visitId ?? null);
  const place = visit ? selectPlaceById(places, visit.placeId) : undefined;

  /** 「哪些照片还该显示」的唯一判定。这里不再自己写 `mediaIds.filter(...)` */
  const visibility = useMemo(() => selectVisibility(media, stories), [stories, media]);

  /** 图库只列还有效的照片。被移除的另起一区，避免"移除了就再也找不回来" */
  const items = useMemo(
    () => (visit ? selectMediaOfVisit(media, visit, visibility) : []),
    [media, visit, visibility],
  );

  const removedItems = useMemo(() => {
    if (!visit) return [];
    const ids = new Set(visit.mediaIds);
    return media
      .filter((item) => ids.has(item.id) && hideReasonOf(visibility, item.id) === 'removed')
      .sort((a, b) => new Date(b.removedAt ?? 0).getTime() - new Date(a.removedAt ?? 0).getTime());
  }, [media, visit, visibility]);

  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showRemoved, setShowRemoved] = useState(false);

  /**
   * 这次到访对应的那本故事（规格 §7.2：一次到访一本）。
   * 到访若已被合并进合集，合集自己的 visitIds 里也有它，所以这里会直接落到合集上。
   */
  const linkedStory = useMemo(
    () =>
      stories.find(
        (s) => !s.isDeleted && !s.mergedIntoStoryId && s.visitIds.includes(visitId ?? ''),
      ),
    [stories, visitId],
  );

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelectedIds([]);
  }, []);

  const toggleSelect = useCallback((mediaId: string) => {
    setSelectedIds((prev) =>
      prev.includes(mediaId) ? prev.filter((id) => id !== mediaId) : [...prev, mediaId],
    );
  }, []);

  const enterSelection = useCallback((mediaId?: string) => {
    setSelecting(true);
    setSelectedIds(mediaId ? [mediaId] : []);
  }, []);

  const handleRemove = useCallback(() => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    Alert.alert(
      '从回忆相册移除',
      `这 ${count} 张会从地图、到访图库和时间轴隐藏。iPhone 系统相册里的原图不会被删除，之后随时可以恢复。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: `移除 ${count} 张`,
          style: 'destructive',
          onPress: () => {
            removeMedia(selectedIds);
            // 移除后展开回收区：恢复入口要当场看得见，否则等于没做撤回
            setShowRemoved(true);
            exitSelection();
          },
        },
      ],
    );
  }, [exitSelection, removeMedia, selectedIds]);

  const header = (
    <View style={styles.headerRow}>
      <Pressable
        onPress={() => (selecting ? exitSelection() : router.back())}
        style={styles.backButton}
        hitSlop={8}
        accessibilityLabel={selecting ? '退出选择' : '返回'}>
        <SymbolView
          name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
          tintColor={colors.textPrimary}
          size={20}
        />
      </Pressable>
      <View style={styles.headerText}>
        <Text style={styles.title} numberOfLines={1}>
          {visit ? `${dayLabelFullOf(visit)} ${partOfDayOf(visit)}` : '图库'}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {place?.name ?? ''}
          {visit ? ` · ${clockLabelOf(visit, 'start')} – ${clockLabelOf(visit, 'end')}` : ''}
          {visit ? ` · ${weekdayLabelOf(visit)}` : ''}
        </Text>
      </View>
      {items.length > 0 || selecting ? (
        <Pressable
          onPress={() => (selecting ? exitSelection() : enterSelection())}
          hitSlop={10}>
          <Text style={styles.selectToggle}>{selecting ? '取消' : '选择'}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      {removedItems.length > 0 ? (
        <View style={styles.removedSection}>
          <Pressable onPress={() => setShowRemoved((v) => !v)} hitSlop={8}>
            <Text style={styles.removedToggle}>
              已移除 {removedItems.length} 张 · {showRemoved ? '收起' : '查看'}
            </Text>
          </Pressable>
          <Text style={styles.removedHint}>只在本 App 内隐藏，iPhone 系统相册的原图还在。</Text>
          {showRemoved ? (
            <View style={styles.removedGrid}>
              {removedItems.map((item) => (
                <View key={item.id} style={[styles.tile, { width: TILE, height: TILE }]}>
                  <Image
                    source={resolveMediaSource(item.uri)}
                    style={[styles.tileImage, styles.removedImage]}
                    resizeMode="cover"
                  />
                  <Pressable
                    onPress={() => restoreMedia([item.id])}
                    style={styles.restorePill}
                    hitSlop={6}
                    accessibilityLabel="恢复这张照片">
                    <Text style={styles.restorePillText}>恢复</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const empty = (
    <View style={styles.emptyBox}>
      <Text style={styles.emptyTitle}>
        {removedItems.length > 0 ? '这次到访的照片都移除了' : '这次到访没有留下媒体'}
      </Text>
      <Text style={styles.emptyText}>
        {removedItems.length > 0
          ? '展开下面的「已移除」就能恢复。'
          : '故事也还在，只是这次没有可看的照片。'}
      </Text>
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      {header}

      {/* 把「到访 → 故事」这一环接上：不用切回故事 tab 再凭日期找 */}
      {linkedStory ? (
        <Pressable
          onPress={() =>
            router.push({
              pathname: '/story/[storyId]',
              params: { storyId: linkedStory.id },
            })
          }
          style={({ pressed }) => [styles.storyLink, pressed && styles.storyLinkPressed]}
          accessibilityLabel={`打开故事 ${linkedStory.title}`}>
          <SymbolView
            name={{ ios: 'book', android: 'menu_book', web: 'menu_book' }}
            tintColor={colors.accent}
            size={13}
          />
          <Text style={styles.storyLinkText} numberOfLines={1}>
            {linkedStory.title}
          </Text>
          <Text style={styles.storyLinkChevron}>›</Text>
        </Pressable>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={COLUMNS}
        columnWrapperStyle={{ gap: GAP }}
        extraData={`${selecting}|${selectedIds.join(',')}`}
        contentContainerStyle={{
          gap: GAP,
          paddingHorizontal: layout.screenPadding,
          paddingTop: spacing.md,
          // 选择模式下底部有操作条，列表底部要给它让出位置
          paddingBottom: insets.bottom + (selecting ? 128 : spacing.xxl),
        }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          items.length > 0 ? (
            <Text style={styles.sectionLabel}>
              这次到访 · {items.length} 张
              {items.some((m) => m.kind === 'video')
                ? ` · ${items.filter((m) => m.kind === 'video').length} 段视频`
                : ''}
              {selecting ? ` · 已选 ${selectedIds.length} 张` : ''}
            </Text>
          ) : undefined
        }
        renderItem={({ item }) => (
          <GalleryTile
            item={item}
            selectable={selecting}
            selected={selectedIds.includes(item.id)}
            onPress={() => (selecting ? toggleSelect(item.id) : undefined)}
            onLongPress={() => (selecting ? toggleSelect(item.id) : enterSelection(item.id))}
          />
        )}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
      />

      {selecting ? (
        <View style={[styles.actionBar, { paddingBottom: spacing.md }]}>
          <Text style={styles.actionHint}>
            {selectedIds.length === 0
              ? '选几张再从回忆相册移除'
              : '只会从本 App 隐藏，iPhone 系统相册的原图不动'}
          </Text>
          <Pressable
            onPress={handleRemove}
            disabled={selectedIds.length === 0}
            style={[styles.removeButton, selectedIds.length === 0 && styles.buttonDisabled]}>
            <Text style={styles.removeButtonText}>
              从回忆相册移除{selectedIds.length > 0 ? ` ${selectedIds.length} 张` : ''}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function GalleryTile({
  item,
  selectable,
  selected,
  onPress,
  onLongPress,
}: {
  item: MediaAsset;
  selectable: boolean;
  selected: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const source = resolveMediaSource(item.uri);
  const isPortrait = item.height > item.width;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={320}
      style={[styles.tile, { width: TILE, height: TILE }, selected && styles.tileSelected]}>
      {source ? (
        <Image source={source} style={styles.tileImage} resizeMode="cover" />
      ) : (
        <View style={styles.tileFallback} />
      )}
      {isPortrait ? <View style={styles.portraitHint} /> : null}
      {item.kind === 'video' ? (
        <View style={styles.videoBadge}>
          <SymbolView
            name={{ ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }}
            tintColor={colors.textOnMedia}
            size={10}
          />
          <Text style={styles.videoText}>视频</Text>
        </View>
      ) : null}
      {selectable ? (
        <View style={[styles.selectDot, selected && styles.selectDotOn]}>
          {selected ? (
            <SymbolView
              name={{ ios: 'checkmark', android: 'check', web: 'check' }}
              tintColor={colors.textOnMedia}
              size={11}
            />
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  backButton: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: layout.minTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundGrouped,
  },
  headerText: { flex: 1, gap: 1 },
  title: { ...typography.title2, color: colors.textPrimary },
  meta: { ...typography.footnote, color: colors.textTertiary },
  selectToggle: { ...typography.callout, color: colors.accent, fontWeight: '600' },
  sectionLabel: {
    ...typography.caption2,
    color: colors.textTertiary,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  storyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: layout.screenPadding,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accentMuted,
  },
  storyLinkPressed: { opacity: 0.6 },
  storyLinkText: { ...typography.footnote, color: colors.accent, flex: 1 },
  storyLinkChevron: { ...typography.callout, color: colors.accent },
  tile: {
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.mediaPlaceholder,
  },
  tileSelected: { borderWidth: 2, borderColor: colors.accent },
  tileImage: { width: '100%', height: '100%' },
  tileFallback: { flex: 1, backgroundColor: colors.mediaPlaceholder },
  portraitHint: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 8,
    height: 12,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  videoBadge: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.videoBadge,
  },
  videoText: { ...typography.caption2, fontSize: 9, color: colors.textOnMedia },
  selectDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.9)',
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectDotOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  emptyBox: { paddingVertical: spacing.xxl, gap: spacing.xs },
  emptyTitle: { ...typography.headline, color: colors.textPrimary },
  emptyText: { ...typography.callout, color: colors.textSecondary },
  footer: { marginTop: spacing.lg },
  removedSection: {
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    gap: spacing.sm,
  },
  removedToggle: { ...typography.footnote, color: colors.textTertiary },
  removedHint: { ...typography.caption2, color: colors.textTertiary },
  removedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, marginTop: spacing.xs },
  removedImage: { opacity: 0.45 },
  restorePill: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTranslucent,
  },
  restorePillText: { ...typography.caption2, color: colors.textPrimary },
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
  removeButton: {
    height: layout.minTouchTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
  },
  removeButtonText: { ...typography.callout, color: colors.textOnMedia, fontWeight: '600' },
  buttonDisabled: { opacity: 0.38 },
});

import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Image,
  ImageBackground,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveMediaSource } from '@/src/data';
import {
  CLOSING_RATIO,
  PAIR_RATIOS,
  SOLO_MEDIUM_RATIO,
  planMagazine,
  type MagazineBlock,
} from '@/src/domain/magazine';
import type { MediaAsset, Story } from '@/src/domain/types';
import { visibleMediaOf } from '@/src/domain/visibility';
import { selectStoryById, selectVisibility } from '@/src/store/selectors';
import { useAppStore } from '@/src/store/appStore';
import { colors, editorialTypography, layout, radius, spacing, typography } from '@/src/theme';
import {
  dayLabelFullOf,
  dayLabelOf,
  formatClock,
  formatClockLiteral,
  formatDayKeyFull,
  dayKeyOf,
  partOfDayOf,
  weekdayLabelOf,
} from '@/src/utils/datetime';
import { fitWithin, maxReaderMediaHeight } from '@/src/utils/mediaFit';
import PhotoViewer from '@/src/components/viewer/PhotoViewer';

/** 把故事媒体按版式切成"行"，每行是全宽图或两张并排（grid / large-cover 用） */
type MediaRow =
  | { kind: 'full'; item: MediaAsset }
  | { kind: 'pair'; items: MediaAsset[] };

function buildRows(story: Story, items: MediaAsset[]): MediaRow[] {
  if (items.length === 0) return [];
  const highlighted = new Set(story.highlightedMediaIds);

  if (story.layout === 'grid') {
    const rows: MediaRow[] = [];
    for (let i = 0; i < items.length; i += 2) {
      rows.push({ kind: 'pair', items: items.slice(i, i + 2) });
    }
    return rows;
  }

  // large-cover：每张独占一行
  return items.map((item) => ({ kind: 'full' as const, item }));
}

export default function StoryReaderScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { storyId } = useLocalSearchParams<{ storyId: string }>();

  // 用实时窗口尺寸，而不是模块级 Dimensions：横竖屏、分屏、不同机型都要算对。
  // 这张图能占多高完全由它决定，算错一截，图就会有一部分落在屏幕外。
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const contentWidth = Math.max(1, windowWidth - layout.screenPadding * 2);
  const halfWidth = Math.max(1, Math.floor((contentWidth - spacing.sm) / 2));
  const mediaBoxHeight = maxReaderMediaHeight(windowHeight);

  const stories = useAppStore((s) => s.stories);
  const media = useAppStore((s) => s.media);
  const places = useAppStore((s) => s.places);
  const splitStory = useAppStore((s) => s.splitStory);

  /**
   * 拆分后这本合集立刻从 store 里消失，但返回动画还要播三百毫秒。
   * 不留快照的话，整屏会在返回途中闪一下「这本故事不在了」。
   */
  const [leaving, setLeaving] = useState<Story | null>(null);
  const story = selectStoryById(stories, storyId ?? null) ?? leaving;

  const visibility = useMemo(() => selectVisibility(media, stories), [stories, media]);

  const items = useMemo(() => {
    if (!story) return [];
    const index = new Map(media.map((m) => [m.id, m]));
    // 已从回忆相册移除的照片不再出现在阅读页。这里不留占位——
    // 阅读页是"看回忆"的地方，留一排灰格子只会打断它
    return visibleMediaOf(story.mediaIds, index, visibility);
  }, [media, story, visibility]);

  const mediaIndex = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);

  /** 留白杂志规划：只在 editorial 版式下计算，grid / large-cover 走旧的行模型 */
  const magazinePlan = useMemo(() => {
    if (!story || story.layout !== 'editorial') return null;
    return planMagazine(story, items, mediaIndex, visibility);
  }, [mediaIndex, items, story, visibility]);

  const rows = useMemo(
    () => (story && story.layout !== 'editorial' ? buildRows(story, items) : []),
    [items, story],
  );
  const highlightedSet = useMemo(() => new Set(story?.highlightedMediaIds ?? []), [story]);

  /** 阅读页点图 → 全屏查看器。items 顺序与 blocks / rows 一致，id → items 下标 */
  const viewerIndexOf = useMemo(() => new Map(items.map((m, i) => [m.id, i])), [items]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const openViewer = useCallback(
    (mediaId: string) => setViewerIndex(viewerIndexOf.get(mediaId) ?? null),
    [viewerIndexOf],
  );

  const placeNames = useMemo(() => {
    if (!story) return '';
    return story.placeIds
      .map((id) => places.find((p) => p.id === id)?.name)
      .filter((n): n is string => Boolean(n))
      .join(' · ');
  }, [places, story]);

  if (!story) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.missing}>这本故事不在了。</Text>
      </View>
    );
  }

  const sameDay = dayLabelOf(story, 'start') === dayLabelOf(story, 'end');
  const mergedCount = story.mergedFromStoryIds?.length ?? 0;
  // 手账模板下，顶栏控件要落在米纸上，冷灰胶囊在暖纸上是块补丁
  const isPaper = story.layout === 'editorial';

  // 拆分会丢弃在合集上做的编辑（按快照还原源故事），所以必须确认一次
  const handleSplit = () => {
    Alert.alert(
      '拆开合集',
      `会还原成 ${mergedCount} 本独立故事，各自按合并前的标题、封面和照片顺序恢复。合并之后在这个合集里做的修改不会保留。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '拆分',
          style: 'destructive',
          onPress: () => {
            setLeaving(story);
            splitStory(story.id);
            router.back();
          },
        },
      ],
    );
  };

  return (
    <View
      style={[
        styles.root,
        story.layout === 'editorial' ? styles.rootPaper : styles.rootClassic,
      ]}>
      {/* 手账纸纹：128px 无缝平铺，让米纸不是一块死色 */}
      {story.layout === 'editorial' ? (
        <ImageBackground
          source={PAPER_TEXTURE}
          resizeMode="repeat"
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      ) : null}
      <ScrollView
        style={styles.root}
        contentContainerStyle={{
          paddingTop: insets.top + spacing.sm,
          paddingBottom: insets.bottom + spacing.huge,
          paddingHorizontal: layout.screenPadding,
        }}
        showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.headerButton, isPaper ? styles.paperControl : styles.coldControl]}
            hitSlop={8}
            accessibilityLabel="返回">
            <SymbolView
              name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
              tintColor={isPaper ? colors.paperInk : colors.textPrimary}
              size={20}
            />
          </Pressable>
          <View style={styles.headerActions}>
            {mergedCount > 0 ? (
              <Pressable
                onPress={handleSplit}
                style={[styles.editButton, isPaper ? styles.paperControl : styles.coldControl]}
                hitSlop={8}
                accessibilityLabel={`把这个合集拆回 ${mergedCount} 本`}>
                <Text style={[styles.editButtonText, isPaper ? styles.paperControlText : null]}>
                  拆分
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() =>
                router.push({ pathname: '/story/[storyId]/edit', params: { storyId: story.id } })
              }
              style={[styles.editButton, isPaper ? styles.paperControl : styles.coldControl]}
              hitSlop={8}
              accessibilityLabel="编辑这本故事">
              <Text style={[styles.editButtonText, isPaper ? styles.paperControlText : null]}>
                编辑
              </Text>
            </Pressable>
          </View>
        </View>

        {story.layout === 'editorial' ? (
          <MagazineFlow
            story={story}
            plan={magazinePlan!}
            items={items}
            contentWidth={contentWidth}
            windowHeight={windowHeight}
            highlightedSet={highlightedSet}
            placeNames={placeNames}
            mergedCount={mergedCount}
            onOpenViewer={openViewer}
          />
        ) : (
          <ClassicFlow
            story={story}
            rows={rows}
            items={items}
            contentWidth={contentWidth}
            mediaBoxHeight={mediaBoxHeight}
            halfWidth={halfWidth}
            highlightedSet={highlightedSet}
            placeNames={placeNames}
            sameDay={sameDay}
            onOpenViewer={openViewer}
          />
        )}
      </ScrollView>

      {viewerIndex !== null && items.length > 0 ? (
        <PhotoViewer
          items={items}
          initialIndex={Math.min(viewerIndex, items.length - 1)}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* 留白摄影杂志（editorial）                                            */
/* ------------------------------------------------------------------ */

interface MagazineFlowProps {
  story: Story;
  plan: NonNullable<ReturnType<typeof planMagazine>>;
  items: MediaAsset[];
  contentWidth: number;
  windowHeight: number;
  highlightedSet: Set<string>;
  placeNames: string;
  mergedCount: number;
  onOpenViewer: (mediaId: string) => void;
}

/**
 * 封面 + 四种版式块连成一篇。
 * 高度上限都取窗口高度的比例，不写死像素——小屏、分屏、横屏都能算对。
 */
function MagazineFlow({
  story,
  plan,
  items,
  contentWidth,
  windowHeight,
  highlightedSet,
  placeNames,
  mergedCount,
  onOpenViewer,
}: MagazineFlowProps) {
  const isOverlay = (story.coverTitleMode ?? 'below') === 'overlay';
  // 邮戳只压日期：手账里的日期章从不盖一长串，星期/时段/地点另起一行小字
  const stampText =
    dayLabelOf(story, 'start') === dayLabelOf(story, 'end')
      ? dayLabelOf(story, 'start')
      : `${dayLabelOf(story, 'start')} – ${dayLabelOf(story, 'end')}`;
  const metaLine = [weekdayLabelOf(story), partOfDayOf(story), placeNames]
    .filter((t) => Boolean(t))
    .join(' · ');

  const cover = plan.cover;
  const coverBox = cover
    ? fitWithin(cover, contentWidth - FRAME_PAD * 2, Math.round(windowHeight * 0.62))
    : null;
  const hasBody = plan.blocks.length > 0;

  // 手账的日期只写一次：新的一天在块上方起一条日期栏，相纸底部改标这一刻的时刻。
  // 两者都是真实数据，不编造任何文字。
  const captions = useMemo(
    () =>
      plan.blocks.map((block) => {
        const list = block.kind === 'pair' ? [block.primary, block.secondary] : [block.item];
        return list.map(clockOf);
      }),
    [plan.blocks],
  );

  const dividers = useMemo(() => {
    const seen = new Set<string>();
    if (plan.cover) seen.add(dayKeyOf(plan.cover.capturedAt, plan.cover.dateKey));
    return plan.blocks.map((block) => {
      const first = block.kind === 'pair' ? block.primary : block.item;
      const key = dayKeyOf(first.capturedAt, first.dateKey);
      if (seen.has(key)) return null;
      seen.add(key);
      return formatDayKeyFull(key);
    });
  }, [plan.blocks, plan.cover]);

  /**
   * 块间距跟着版式语义走，而不是「每三块拉一次」的机械节奏：
   * 换日、大图前后、收尾之前要真正喘一口气，其余贴紧。
   * 纯函数、只依赖块结构，重开同一篇的间距完全一致。
   */
  const gaps = useMemo(
    () =>
      plan.blocks.map((block, i) => {
        // 正文/标题区之后的第一块，比片内间距松一档，读起来才不挤
        if (i === 0) return spacing.xl;
        const prev = plan.blocks[i - 1]!;
        if (dividers[i]) return SECTION_GAP;
        if (block.kind === 'closing') return Math.round(SECTION_GAP * 1.3);
        if (block.kind === 'solo' && block.emphasis !== 'medium') return SECTION_GAP;
        if (prev.kind === 'solo' && prev.emphasis !== 'medium') return SECTION_GAP;
        return BLOCK_GAP;
      }),
    [plan.blocks, dividers],
  );

  return (
    <View>
      {/* ---- 封面：拍立得相纸 + 邮戳日期 + 宋体标题 ---- */}
      {cover && coverBox ? (
        <View>
          <Polaroid
            box={coverBox}
            rotate="0deg"
            tape="center"
            // 封面相纸上写时刻就够了：日期已经由下方那枚邮戳承担，不重复两遍
            caption={isOverlay ? undefined : clockOf(cover)}>
            <View style={{ width: coverBox.width, height: coverBox.height, position: 'relative' }}>
              <PhotoPress
                style={StyleSheet.absoluteFill}
                label="全屏查看封面照片"
                onPress={() => onOpenViewer(cover.id)}>
                <ReaderImage item={cover} paper style={styles.fillImage} />
                {cover.kind === 'video' ? <VideoTag paper /> : null}
              </PhotoPress>
              {isOverlay ? (
                <View style={styles.coverOverlay} pointerEvents="none">
                  <View style={styles.coverScrimSoft} />
                  <View style={styles.coverScrimStrong} />
                  <View style={styles.coverOverlayText}>
                    <Text style={styles.coverOverlayMeta} numberOfLines={1}>
                      {stampText}
                      {metaLine ? ` · ${metaLine}` : ''}
                    </Text>
                    <Text style={styles.coverOverlayTitle} numberOfLines={3}>
                      {story.title}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>
          </Polaroid>
          {!isOverlay ? (
            <View style={styles.coverBelow}>
              <Text style={styles.stampKicker}>{stampText}</Text>
              <Text style={styles.magazineTitle}>{story.title}</Text>
              {metaLine ? <Text style={styles.placeLine}>{metaLine}</Text> : null}
            </View>
          ) : null}
          {story.userText ? (
            // 中文正文首行缩进两个字：手账里这段话是写下来的，不是排出来的
            <Text style={styles.magazineBody}>{`　　${story.userText}`}</Text>
          ) : null}
        </View>
      ) : (
        // 没有可见照片：说明性空态，而不是一片留白
        <View style={styles.noMediaBox}>
          <Text style={styles.noMediaTitle}>
            {story.mediaIds.length > 0 ? '这本的照片都隐藏了' : '这本还没有照片'}
          </Text>
          <Text style={styles.noMediaText}>
            {story.mediaIds.length > 0
              ? '可能是从回忆相册移除了，也可能所在故事被删。设置里的「已移除的照片」可以恢复。'
              : '进入编辑可以换个版式，照片要等下一次到访。'}
          </Text>
        </View>
      )}

      {/* ---- 正文版式块 ---- */}
      {hasBody ? (
        <View style={styles.magazineBodyFlow}>
          {plan.blocks.map((block, index) => {
            const divider = dividers[index];
            // 满宽大图和左右贴边的中小图不参与水平错位，否则会顶出纸边
            const noOffset = block.kind === 'solo';
            return (
              <View
                key={`${block.kind}-${blockIndexOf(block, items)}-${index}`}
                // 手账的块不等间距：片内贴得紧甚至互相压边，换日/大图/收尾才留白
                style={{ marginTop: gaps[index] }}>
                {divider ? (
                  <View style={styles.dayDivider}>
                    <Text style={styles.dayDividerText}>{divider}</Text>
                    <View style={styles.dayDividerRule} />
                  </View>
                ) : null}
                <View
                  style={[
                    styles.magazineBlock,
                    { marginLeft: noOffset ? 0 : BLOCK_OFFSETS[index % BLOCK_OFFSETS.length] },
                  ]}>
                  <MagazineBlockView
                    block={block}
                    index={index}
                    contentWidth={contentWidth}
                    windowHeight={windowHeight}
                    highlightedSet={highlightedSet}
                    captions={captions[index]}
                    onOpenViewer={onOpenViewer}
                  />
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {mergedCount > 0 || story.highlightedMediaIds.length > 0 ? (
        <Text style={styles.magazineFooter}>
          {mergedCount > 0 ? `由 ${mergedCount} 本合并而成` : ''}
          {mergedCount > 0 && story.highlightedMediaIds.length > 0 ? ' · ' : ''}
          {story.highlightedMediaIds.length > 0
            ? `精选 ${items.filter((m) => highlightedSet.has(m.id)).length} 张`
            : ''}
        </Text>
      ) : null}
    </View>
  );
}

function blockIndexOf(block: MagazineBlock, items: MediaAsset[]): number {
  const id = block.kind === 'pair' ? block.primary.id : block.item.id;
  return items.findIndex((m) => m.id === id);
}

function MagazineBlockView({
  block,
  index,
  contentWidth,
  windowHeight,
  highlightedSet,
  captions,
  onOpenViewer,
}: {
  block: MagazineBlock;
  index: number;
  contentWidth: number;
  windowHeight: number;
  highlightedSet: Set<string>;
  /** 与块内媒体同序的日期标注；同一天只标一次，空串表示这张不写 */
  captions: string[];
  onOpenViewer: (mediaId: string) => void;
}) {
  if (block.kind === 'pair') {
    // 相纸自带左右留白，先从内容宽里扣掉两张相纸的边，再按比例分
    const pairAvail = contentWidth - (FRAME_PAD * 2 + FRAME_PAD * 2);
    const primaryW = Math.round(pairAvail * PAIR_RATIOS.primary);
    const secondaryW = Math.round(pairAvail * PAIR_RATIOS.secondary);
    const pairMaxH = Math.round(windowHeight * 0.44);
    const primaryBox = fitWithin(block.primary, primaryW, pairMaxH);
    const secondaryBox = fitWithin(block.secondary, secondaryW, pairMaxH);
    // 次图向下错开：跟随主图高度走，小屏上也不会错出屏幕外
    const stagger = Math.max(24, Math.round(primaryBox.height * 0.22));

    const primarySlot = (
      <Polaroid
        box={primaryBox}
        rotate={block.mirrored ? '1.2deg' : '-1.2deg'}
        tape={block.mirrored ? 'right' : 'left'}
        caption={captions[0]}>
        <PhotoPress
          box={primaryBox}
          label="全屏查看这张照片"
          onPress={() => onOpenViewer(block.primary.id)}>
          <ReaderImage item={block.primary} paper style={styles.fillImage} />
          {block.primary.kind === 'video' ? <VideoTag paper /> : null}
          {highlightedSet.has(block.primary.id) ? <HighlightTag paper /> : null}
        </PhotoPress>
      </Polaroid>
    );
    const secondarySlot = (
      <View style={{ marginTop: stagger }}>
        <Polaroid
          box={secondaryBox}
          rotate={block.mirrored ? '-1.4deg' : '1.4deg'}
          corners
          caption={captions[1]}>
          <PhotoPress
            box={secondaryBox}
            label="全屏查看这张照片"
            onPress={() => onOpenViewer(block.secondary.id)}>
            <ReaderImage item={block.secondary} preferThumb paper style={styles.fillImage} />
            {block.secondary.kind === 'video' ? <VideoTag paper /> : null}
            {highlightedSet.has(block.secondary.id) ? <HighlightTag paper /> : null}
          </PhotoPress>
        </Polaroid>
      </View>
    );

    return (
      // 两列之间剩下的空隙就是留白，不用再插 spacer
      <View style={styles.magazinePairRow}>
        {block.mirrored ? (
          <>
            {secondarySlot}
            {primarySlot}
          </>
        ) : (
          <>
            {primarySlot}
            {secondarySlot}
          </>
        )}
      </View>
    );
  }

  if (block.kind === 'solo') {
    // hero / panorama 占整宽；medium 约 3/4 宽。全景图额外压低高度上限，
    // 否则一张 2:1 的宽图横在半屏高上会把上下留白全吃掉。
    const isMedium = block.emphasis === 'medium';
    // hero 保持端正（大幅照片歪了反而假），中小尺寸的相纸才轻微歪一点
    const rotate =
      block.emphasis === 'hero' || block.emphasis === 'panorama'
        ? '0deg'
        : index % 2 === 0
          ? '1.2deg'
          : '-1.2deg';
    const soloW = isMedium
      ? Math.round((contentWidth - FRAME_PAD * 2) * SOLO_MEDIUM_RATIO)
      : contentWidth - FRAME_PAD * 2;
    const soloMaxH = Math.round(
      windowHeight *
        (block.emphasis === 'panorama' ? 0.45 : block.emphasis === 'hero' ? 0.58 : 0.48),
    );
    const box = fitWithin(block.item, soloW, soloMaxH);
    return (
      <Polaroid
        box={box}
        rotate={rotate}
        // 规则：大图用胶带贴、小图用相角塞——不在每张照片上重复同一种固定方式
        tape={isMedium ? undefined : 'center'}
        corners={isMedium}
        align={isMedium ? (index % 2 === 0 ? 'left' : 'right') : 'center'}
        caption={captions[0]}>
        <PhotoPress
          box={box}
          label="全屏查看这张照片"
          onPress={() => onOpenViewer(block.item.id)}>
          <ReaderImage item={block.item} preferThumb={isMedium} paper style={styles.fillImage} />
          {block.item.kind === 'video' ? <VideoTag paper /> : null}
          {highlightedSet.has(block.item.id) ? <HighlightTag paper /> : null}
        </PhotoPress>
      </Polaroid>
    );
  }

  // 收尾：居中偏小、歪得更明显，像随手贴上的最后一张，日期压底给全篇一个明确的结束
  const closingW = Math.round((contentWidth - FRAME_PAD * 2) * CLOSING_RATIO);
  const closingBox = fitWithin(block.item, closingW, Math.round(windowHeight * 0.4));
  return (
    <Polaroid
      box={closingBox}
      rotate="-2deg"
      corners
      caption={captions[0]}>
      <PhotoPress
        box={closingBox}
        label="全屏查看这张照片"
        onPress={() => onOpenViewer(block.item.id)}>
        <ReaderImage item={block.item} preferThumb paper style={styles.fillImage} />
        {block.item.kind === 'video' ? <VideoTag paper /> : null}
      </PhotoPress>
    </Polaroid>
  );
}

/**
 * 相纸上的照片按钮：按下去轻轻一缩，像把照片按了一下。
 * 缩放作用在早已旋转过的相纸内部，不会和倾斜打架。
 */
function PhotoPress({
  box,
  style,
  label,
  onPress,
  children,
}: {
  box?: { width: number; height: number };
  style?: StyleProp<ViewStyle>;
  label: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
      style={({ pressed }) => [
        box ? { width: box.width, height: box.height, position: 'relative' } : style,
        pressed ? styles.photoPressed : null,
      ]}>
      {children}
    </Pressable>
  );
}

/** 拍立得相纸：左右上留白，底部宽边写日期；可选一段和纸胶带贴角 */
function Polaroid({
  box,
  rotate,
  tape,
  corners = false,
  align = 'center',
  caption,
  children,
}: {
  box: { width: number; height: number };
  rotate: string;
  tape?: 'left' | 'right' | 'center';
  /** 相角固定：两个牛皮纸三角塞住上缘两角，比胶带更低调 */
  corners?: boolean;
  /** 手账里的小照片会贴向某一边，不是每张都端端正正居中 */
  align?: 'center' | 'left' | 'right';
  caption?: string;
  children: ReactNode;
}) {
  return (
    <View
      style={[
        styles.polaroid,
        { width: box.width + FRAME_PAD * 2, transform: [{ rotate }] },
        align === 'left' ? styles.polaroidLeft : align === 'right' ? styles.polaroidRight : null,
        // 不写日期的照片就是一张方方正正的相纸，不带底部空白——
        // 手账里本来就有写字的和纯照片的混着贴
        caption ? null : { paddingBottom: FRAME_PAD },
      ]}>
      {tape === 'left' ? (
        <View style={styles.tapeLeft} />
      ) : tape === 'right' ? (
        <View style={styles.tapeRight} />
      ) : tape === 'center' ? (
        <View style={styles.tapeCenter} />
      ) : null}
      {corners ? (
        <>
          <View style={[styles.photoCorner, styles.cornerTL]} />
          <View style={[styles.photoCorner, styles.cornerTR]} />
        </>
      ) : null}
      {children}
      {caption ? <Text style={styles.polaroidCaption}>{caption}</Text> : null}
    </View>
  );
}

/** 相纸底部的手写时刻：归属日已固定时按 literal 读，避免时区把时刻挪走 */
function clockOf(item: MediaAsset): string {
  return item.dateKey ? formatClockLiteral(item.capturedAt) : formatClock(item.capturedAt);
}

/* ------------------------------------------------------------------ */
/* grid / large-cover 原有渲染                                          */
/* ------------------------------------------------------------------ */

interface ClassicFlowProps {
  story: Story;
  rows: MediaRow[];
  items: MediaAsset[];
  contentWidth: number;
  mediaBoxHeight: number;
  halfWidth: number;
  highlightedSet: Set<string>;
  placeNames: string;
  sameDay: boolean;
  onOpenViewer: (mediaId: string) => void;
}

function ClassicFlow({
  story,
  rows,
  items,
  contentWidth,
  mediaBoxHeight,
  halfWidth,
  highlightedSet,
  placeNames,
  sameDay,
  onOpenViewer,
}: ClassicFlowProps) {
  return (
    <View>
      <Text style={styles.classicKicker}>
        {dayLabelFullOf(story)} {weekdayLabelOf(story)} {partOfDayOf(story)}
        {sameDay ? '' : ` – ${dayLabelOf(story, 'end')}`}
      </Text>
      <Text style={styles.classicTitle}>{story.title}</Text>
      {placeNames ? <Text style={styles.classicPlace}>{placeNames}</Text> : null}

      {story.userText ? <Text style={styles.classicBody}>{story.userText}</Text> : null}

      <View style={styles.rule} />

      <View style={styles.flow}>
        {rows.length === 0 ? (
          <View style={styles.noMediaBox}>
            <Text style={styles.noMediaTitle}>
              {story.mediaIds.length > 0 ? '这本的照片都隐藏了' : '这本还没有照片'}
            </Text>
            <Text style={styles.noMediaText}>
              {story.mediaIds.length > 0
                ? '可能是从回忆相册移除了，也可能所在故事被删。设置里的「已移除的照片」可以恢复。'
                : '进入编辑可以换个版式，照片要等下一次到访。'}
            </Text>
          </View>
        ) : null}
        {rows.map((row, index) => {
          if (row.kind === 'full') {
            // 等比缩进「整宽 × 半屏高」的盒子里。横图照旧铺满整宽，
            // 竖图缩到盒高以内、水平居中——宁可两边留白，也不让任何一边落在屏幕外。
            const box = fitWithin(row.item, contentWidth, mediaBoxHeight);
            return (
              <Pressable
                key={`full-${row.item.id}-${index}`}
                style={[styles.fullBlock, { width: box.width, height: box.height }]}
                onPress={() => onOpenViewer(row.item.id)}
                accessibilityRole="imagebutton"
                accessibilityLabel="全屏查看这张照片">
                <ReaderImage item={row.item} style={styles.fullImage} />
                {row.item.kind === 'video' ? <VideoTag /> : null}
                {highlightedSet.has(row.item.id) ? <HighlightTag /> : null}
              </Pressable>
            );
          }
          // 网格版式照片数为奇数时，最后一行只有一张：
          // 它占整宽，高度也必须按整宽算，不能再沿用半宽的比例——否则这张会被压成一条。
          const box =
            row.items.length === 1
              ? fitWithin(row.items[0], contentWidth, mediaBoxHeight)
              : null;
          return (
            <View key={`pair-${index}`} style={styles.classicPairRow}>
              {row.items.map((item) => {
                const isWide = item.width >= item.height;
                return (
                  <Pressable
                    key={item.id}
                    style={[styles.pairItem, { width: box ? box.width : halfWidth }]}
                    onPress={() => onOpenViewer(item.id)}
                    accessibilityRole="imagebutton"
                    accessibilityLabel="全屏查看这张照片">
                    <ReaderImage
                      item={item}
                      preferThumb
                      style={{
                        width: '100%',
                        // 半宽格子：矮图给一个不至于太扁的高度，高图按比例给到刚好不被裁
                        height: box
                          ? box.height
                          : isWide
                            ? halfWidth * 0.72
                            : halfWidth / (item.width / item.height),
                        borderRadius: radius.media,
                      }}
                    />
                    {item.kind === 'video' ? <VideoTag /> : null}
                    {highlightedSet.has(item.id) ? <HighlightTag /> : null}
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </View>

      <Text style={styles.footer}>
        版式 · {story.layout === 'large-cover' ? '大图封面' : '网格'}
      </Text>
    </View>
  );
}

/**
 * 阅读页图片。图源链优先级可调，失败逐级降级而不是留白：
 *  - 默认（整宽大图）：原图优先保清晰度，失败降级缩略图，再失败画占位；
 *  - preferThumb（小格）：缩略图优先，失败才回落原图——600px 对小格绰绰有余，
 *    先试原图只会让老存档的死 uri 白白拖慢一拍。
 * 导入照片的原稿 uri 曾走过临时目录，系统清理后就是死路径——
 * 用户不该面对一块无声的空白。
 */
function ReaderImage({
  item,
  preferThumb = false,
  paper = false,
  style,
}: {
  item: MediaAsset;
  preferThumb?: boolean;
  /** 手账模板：失败占位换成暖灰，冷灰在米纸上像块破洞 */
  paper?: boolean;
  style: StyleProp<ImageStyle>;
}) {
  const original = resolveMediaSource(item.uri);
  const thumb = item.thumbUri ? resolveMediaSource(item.thumbUri) : undefined;
  const [originalFailed, setOriginalFailed] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);

  const source = preferThumb
    ? thumb && !thumbFailed
      ? thumb
      : !originalFailed
        ? original
        : undefined
    : original && !originalFailed
      ? original
      : thumb && !thumbFailed
        ? thumb
        : undefined;

  // 占位要能解释自己：一块没有说明的空白会让人以为照片丢了
  if (!source) {
    return (
      <View style={[style, paper ? styles.readerFallbackPaper : styles.readerFallback]}>
        {paper ? (
          <Text style={styles.readerFallbackText} allowFontScaling={false}>
            照片已不在这台手机上
          </Text>
        ) : null}
      </View>
    );
  }
  return (
    <Image
      source={source}
      style={style}
      resizeMode="cover"
      onError={() => {
        if (source === original) setOriginalFailed(true);
        else setThumbFailed(true);
      }}
    />
  );
}

function HighlightTag({ paper = false }: { paper?: boolean }) {
  return (
    <View style={[styles.highlightTag, paper ? styles.tagOnPaper : null]}>
      <Text
        style={[styles.highlightTagText, paper ? styles.highlightTagTextOnPaper : null]}
        allowFontScaling={false}>
        精选
      </Text>
    </View>
  );
}

function VideoTag({ paper = false }: { paper?: boolean }) {
  return (
    <View style={[styles.videoTag, paper ? styles.tagInk : null]}>
      <SymbolView
        name={{ ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }}
        tintColor={colors.textOnMedia}
        size={9}
      />
      <Text style={styles.videoTagText}>视频</Text>
    </View>
  );
}

/** 版式块节奏：片内紧凑 / 章节拉开（手账要贴得近，间距整体比杂志版更小） */
const BLOCK_GAP = 14;
const SECTION_GAP = 34;

/** 拍立得相纸几何：左右上留白 10，底部 32 写日期，全册统一 */
const FRAME_PAD = 10;
const FRAME_BOTTOM = 32;

/** 手账纸纹贴图：128px 无缝平铺，见 assets/images/paper-texture.png */
const PAPER_TEXTURE = require('../../../assets/images/paper-texture.png');

/** 块的水平错位（内容宽内的确定偏移，不是随机数）：让整页不再是一条中轴排下来 */
const BLOCK_OFFSETS = [0, 8, -6, 5, -8, 0];

/**
 * 故事标题的衬线体：iOS 用内置宋体 Songti SC，Android 无内置衬线，
 * 留 undefined 落回系统黑体——不给用户额外装字体。
 * 导航与操作控件继续走系统字体，衬线只出现在故事标题这一层。
 */
const serifStoryTitle = {
  ...editorialTypography.storyTitle,
  fontFamily: Platform.select({ ios: 'Songti SC', default: undefined }),
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  // 手账米纸只给 editorial；grid / large-cover 保持中性灰蓝
  rootPaper: { backgroundColor: colors.paper },
  rootClassic: { backgroundColor: colors.backgroundGrouped },
  center: { alignItems: 'center', justifyContent: 'center' },
  missing: { ...typography.callout, color: colors.textSecondary },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  headerButton: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: layout.minTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  editButton: {
    height: 34,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  editButtonText: { ...typography.footnote, color: colors.textPrimary, fontWeight: '600' },
  // 经典模板沿用冷灰底控件
  coldControl: { backgroundColor: colors.backgroundGrouped },
  // 手账模板：暖白半透明 + 暖 hairline，像压在纸上的小标签，不是一块灰色补丁
  paperControl: {
    backgroundColor: colors.paperTranslucent,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.paperLine,
  },
  paperControlText: { color: colors.paperInk },

  /* 手账封面 */
  fillImage: { width: '100%', height: '100%' },
  coverOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'flex-end',
  },
  coverScrimSoft: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '42%',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  coverScrimStrong: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '24%',
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  coverOverlayText: { padding: spacing.lg, gap: spacing.xs },
  coverOverlayTitle: {
    ...serifStoryTitle,
    color: colors.textOnMedia,
  },
  coverOverlayMeta: { ...typography.footnote, color: 'rgba(255,255,255,0.88)' },
  coverBelow: { marginTop: spacing.xl, gap: spacing.sm, alignSelf: 'stretch' },
  // 封面日期邮戳：印泥红细描边小胶囊，全篇唯一的强色点缀。
  // 盖歪一点、墨色不实，才像真盖上去的章而不是画上去的框
  stampKicker: {
    ...typography.caption2,
    color: colors.stamp,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderRadius: 3,
    borderColor: colors.stamp,
    letterSpacing: 1.4,
    overflow: 'hidden',
    opacity: 0.9,
    transform: [{ rotate: '-2deg' }],
  },
  magazineTitle: {
    ...serifStoryTitle,
    color: colors.paperInk,
    marginTop: spacing.xs,
    paddingLeft: 2,
  },
  placeLine: {
    ...typography.footnote,
    color: colors.paperInkSoft,
    marginTop: 2,
    paddingLeft: 2,
    fontFamily: Platform.select({ ios: 'Kaiti SC', default: undefined }),
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: 0.4,
  },
  // 正文也走楷体：手账上的字是写上去的，这套字比系统黑体更像
  magazineBody: {
    ...editorialTypography.body,
    color: colors.paperInk,
    marginTop: spacing.lg,
    fontFamily: Platform.select({ ios: 'Kaiti SC', default: undefined }),
    fontSize: 17,
    lineHeight: 29,
    letterSpacing: 0.3,
  },
  magazineBodyFlow: { marginTop: spacing.xl },
  magazineBlock: {},
  /* 日期栏：像手账本里换日时随手划的一行 */
  dayDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  dayDividerText: {
    fontFamily: Platform.select({ ios: 'Kaiti SC', default: undefined }),
    fontSize: 18,
    lineHeight: 24,
    color: colors.paperInk,
    letterSpacing: 0.8,
  },
  dayDividerRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.paperLine,
  },
  magazineFooter: {
    ...typography.caption,
    color: colors.paperInkSoft,
    marginTop: spacing.xxl,
    textAlign: 'center',
    fontFamily: Platform.select({ ios: 'Kaiti SC', default: undefined }),
  },

  /* 拍立得相纸：暖白相纸托住照片，底部宽边写日期，微投影让它像贴上去的 */
  polaroid: {
    alignSelf: 'center',
    backgroundColor: colors.paperCard,
    paddingTop: FRAME_PAD,
    paddingHorizontal: FRAME_PAD,
    paddingBottom: FRAME_BOTTOM,
    borderRadius: 2,
    // 极淡的暖色描边：相纸从米纸上浮起一层，不靠加重阴影
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(140, 131, 119, 0.18)',
    shadowColor: '#5B4A33',
    shadowOpacity: 0.16,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  polaroidCaption: {
    ...typography.caption2,
    color: colors.paperInkSoft,
    textAlign: 'center',
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1,
    fontFamily: Platform.select({ ios: 'Kaiti SC', default: undefined }),
  },
  // 按下时把照片按下去一点。作用在旋转过的相纸内部，倾斜不会被打断
  photoPressed: { transform: [{ scale: 0.975 }] },
  polaroidLeft: { alignSelf: 'flex-start' },
  polaroidRight: { alignSelf: 'flex-end' },

  /* 和纸胶带：贴在相纸上缘，半透明，两端超出相纸边缘 */
  tape: {
    position: 'absolute',
    top: -8,
    width: 64,
    height: 18,
    backgroundColor: colors.tape,
    borderRadius: 1,
    zIndex: 10,
  },
  tapeLeft: {
    left: 18,
    transform: [{ rotate: '-5deg' }],
  },
  tapeRight: {
    right: 18,
    transform: [{ rotate: '4deg' }],
  },
  tapeCenter: {
    alignSelf: 'center',
    transform: [{ rotate: '-2.5deg' }],
  },

  /* 相角：两个牛皮纸三角塞住相纸上缘，是比胶带更常见的相册固定方式 */
  photoCorner: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderStyle: 'solid',
    zIndex: 10,
  },
  cornerTL: {
    left: -1,
    top: -1,
    borderTopWidth: 15,
    borderRightWidth: 15,
    borderTopColor: colors.cornerMount,
    borderRightColor: 'transparent',
  },
  cornerTR: {
    right: -1,
    top: -1,
    borderTopWidth: 15,
    borderLeftWidth: 15,
    borderTopColor: colors.cornerMount,
    borderLeftColor: 'transparent',
  },

  /* 版式块 */
  // 杂志的错位双图：两列宽度不等，中间剩下的内容宽就是留白，不用 spacer
  magazinePairRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  /* 空态 */
  noMediaBox: { paddingVertical: spacing.xxl, gap: spacing.xs },
  noMediaTitle: { ...typography.headline, color: colors.paperInk },
  noMediaText: { ...typography.footnote, color: colors.paperInkSoft, lineHeight: 19 },

  /* grid / large-cover 沿用 */
  classicKicker: {
    ...typography.caption2,
    color: colors.textSecondary,
    letterSpacing: 1.2,
  },
  classicPlace: {
    ...typography.footnote,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  classicBody: {
    ...editorialTypography.body,
    color: colors.textPrimary,
    marginTop: spacing.lg,
  },
  classicTitle: { ...typography.title, color: colors.textPrimary, marginTop: spacing.xs },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginVertical: spacing.xl,
  },
  flow: { gap: spacing.sm },
  fullBlock: { alignSelf: 'center', marginBottom: spacing.sm, position: 'relative' },
  fullImage: { width: '100%', height: '100%', borderRadius: radius.media },
  readerFallback: { backgroundColor: colors.mediaPlaceholder },
  readerFallbackPaper: {
    backgroundColor: colors.paperPlaceholder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readerFallbackText: {
    ...typography.caption2,
    color: colors.paperInkSoft,
    textAlign: 'center',
    paddingHorizontal: 6,
  },
  // flex-start：让每个格子高度等于图片自身高度。默认 stretch 会把矮图那一格拉高，
  // 结果「视频 / 精选」角标贴在空白区底部而不是图片底部。
  classicPairRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  pairItem: { position: 'relative' },
  videoTag: {
    position: 'absolute',
    left: spacing.xs,
    bottom: spacing.xs + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.videoBadge,
  },
  videoTagText: { ...typography.caption2, fontSize: 9, color: colors.textOnMedia },
  highlightTag: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs + 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.surfaceTranslucent,
  },
  highlightTagText: { ...typography.caption2, fontSize: 9, color: colors.textPrimary },
  // 手账下的角标要像贴纸/铅笔记号，不是一层 UI 浮层
  tagOnPaper: {
    backgroundColor: colors.paperCard,
    borderRadius: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.stamp,
  },
  highlightTagTextOnPaper: { color: colors.stamp, letterSpacing: 0.6 },
  tagInk: { backgroundColor: 'rgba(70, 64, 58, 0.74)', borderRadius: 2 },
  footer: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xxl,
    textAlign: 'center',
  },
});

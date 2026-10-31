import { useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveDisplaySource, resolveMediaSource } from '@/src/data';
import type { MediaAsset } from '@/src/domain/types';
import { colors, layout, spacing, typography } from '@/src/theme';

/**
 * 全屏照片查看器（M17）。
 *
 * 手势全部走 react-native-gesture-handler 的 JS 线程回调 + RN Animated，
 * 不碰 useAnimatedStyle/worklet——时间轴的教训：worklet 写错一个模式就是原生崩溃。
 * 纵向 Pan 激活阈值 (activeOffsetY) 与横向 failOffsetX 让位给翻页，仲裁交给 GH。
 *
 * v1 明确不做：捏合缩放、视频播放。见 docs 记录不改候选。
 */
export default function PhotoViewer({
  items,
  initialIndex,
  onClose,
}: {
  items: MediaAsset[];
  initialIndex: number;
  onClose: () => void;
}) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [index, setIndex] = useState(() => Math.min(initialIndex, items.length - 1));
  const [chromeOn, setChromeOn] = useState(true);
  const chromeOpacity = useRef(new Animated.Value(1)).current;

  /** 下拉关闭的跟手位移。JS 驱动（useNativeDriver: false）——拖动按帧 set 值足够顺滑 */
  const dragY = useRef(new Animated.Value(0)).current;

  const toggleChrome = () => {
    if (chromeOn) {
      setChromeOn(false);
      Animated.timing(chromeOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: false,
      }).start();
    } else {
      setChromeOn(true);
      Animated.timing(chromeOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: false,
      }).start();
    }
  };

  const closeWithDrag = () => {
    Animated.timing(dragY, { toValue: windowHeight, duration: 180, useNativeDriver: false }).start(
      () => onClose(),
    );
  };

  // failOffsetX：横向意图直接让位，FlatList 照常翻页；
  // activeOffsetY：纵向拖过 12pt 才接管，轻微晃动不会误触
  const panGesture = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .failOffsetX([-16, 16])
    .onUpdate((e) => {
      dragY.setValue(e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 900) {
        closeWithDrag();
      } else {
        Animated.spring(dragY, {
          toValue: 0,
          speed: 30,
          bounciness: 5,
          useNativeDriver: false,
        }).start();
      }
    });

  const tapGesture = Gesture.Tap().onEnd((_e, success) => {
    if (success) toggleChrome();
  });

  const composed = Gesture.Simultaneous(panGesture, tapGesture);

  // 拖动时整体淡出，露出底下的页面——iOS 相册同款下拉关闭体感
  const dragStyles = useMemo(
    () => ({
      transform: [{ translateY: dragY }],
      opacity: dragY.interpolate({
        inputRange: [-200, 0, 300],
        outputRange: [0.5, 1, 0.4],
        extrapolate: 'clamp',
      }),
    }),
    [dragY],
  );

  return (
    <Modal transparent animationType="fade" statusBarTranslucent supportedOrientations={['portrait']}>
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[styles.root, dragStyles]}>
          <GestureDetector gesture={composed}>
            <View style={styles.pagerArea}>
              <FlatList
                data={items}
                keyExtractor={(item) => item.id}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                initialScrollIndex={Math.max(0, Math.min(initialIndex, items.length - 1))}
                getItemLayout={(_data, i) => ({
                  length: windowWidth,
                  offset: windowWidth * i,
                  index: i,
                })}
                onMomentumScrollEnd={(e) => {
                  const next = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
                  if (next !== index) setIndex(next);
                }}
                renderItem={({ item }) => (
                  <View style={[styles.page, { width: windowWidth, height: windowHeight }]}>
                    <ViewerImage item={item} />
                  </View>
                )}
              />
            </View>
          </GestureDetector>

          {/* 顶栏画在翻页区之上：点它不会触发 chrome 切换 */}
          <Animated.View
            style={[
              styles.topBar,
              {
                top: insets.top,
                opacity: chromeOpacity,
              },
            ]}
            pointerEvents={chromeOn ? 'auto' : 'none'}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.closePressed]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="关闭查看器">
              <SymbolView
                name={{ ios: 'xmark', android: 'close', web: 'close' }}
                tintColor={colors.textOnMedia}
                size={16}
              />
            </Pressable>
            <Text style={styles.counter}>
              {index + 1} / {items.length}
            </Text>
            <View style={styles.closeButton} />
          </Animated.View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * 查看器图源链：原图优先（全屏要清晰度）→ 失败降级缩略图 → 占位。
 * 旧导入的死 uri 在这里不再是无声空白。
 */
function ViewerImage({ item }: { item: MediaAsset }) {
  const primary = resolveMediaSource(item.uri);
  const fallback = resolveDisplaySource(item);
  const [primaryFailed, setPrimaryFailed] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);

  const source: ImageSourcePropType | undefined = !primaryFailed
    ? primary
    : !fallbackFailed
      ? fallback
      : undefined;

  if (!source) {
    return <View style={[StyleSheet.absoluteFill, styles.unavailable]} />;
  }
  return (
    <Image
      source={source}
      style={StyleSheet.absoluteFill}
      resizeMode="contain"
      onError={() => {
        if (source === primary) setPrimaryFailed(true);
        else setFallbackFailed(true);
      }}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  pagerArea: { flex: 1 },
  page: { alignItems: 'center', justifyContent: 'center' },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.sm,
  },
  closeButton: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: layout.minTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  closePressed: { transform: [{ scale: 0.92 }] },
  counter: {
    ...typography.footnote,
    color: colors.textOnMedia,
    flex: 1,
    textAlign: 'center',
    // 等宽数字：翻页时计数不左右抖动
    fontVariant: ['tabular-nums'],
  },
  unavailable: { backgroundColor: colors.mediaPlaceholder },
});

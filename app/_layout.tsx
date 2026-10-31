import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { checkMockIntegrity } from '@/src/data';
import { repairMediaSources, type MediaSourcePatch } from '@/src/library/repair';
import { useAppStore } from '@/src/store/appStore';
import { colors } from '@/src/theme';

export {
  // 让 expo-router 捕获路由树里的运行时错误
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // SDK 58 起 initialRouteName 已弃用，改叫 anchor
  anchor: '(tabs)',
};

/**
 * 等本地存档读完再渲染路由树。
 * 不等的话会先按示例数据画一帧，存档一到再整屏换掉——用户看到的是"打开时相册闪了一下"，
 * 改过标题的还会先闪回旧标题。
 */
function useStoreHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useAppStore.persist.hasHydrated());

  useEffect(() => {
    if (useAppStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsubscribe = useAppStore.persist.onFinishHydration(() => setHydrated(true));
    // 兜底：AsyncStorage 读失败或迟迟不回调时放行，宁可短暂看到示例数据也不要卡在启动画面
    const fallback = setTimeout(() => setHydrated(true), 1200);
    return () => {
      unsubscribe();
      clearTimeout(fallback);
    };
  }, []);

  return hydrated;
}

export default function RootLayout() {
  const hydrated = useStoreHydrated();
  /** 每个会话只跑一次 */
  const repairStarted = useRef(false);

  // 开发期自检：mock 数据 ID 是否自洽、图片资源是否都在
  useEffect(() => {
    if (!__DEV__) return;
    const issues = checkMockIntegrity();
    if (issues.length > 0) {
      console.warn(`[mock] 发现 ${issues.length} 个数据问题:\n${issues.join('\n')}`);
    } else {
      console.log('[mock] 数据自检通过');
    }
  }, []);

  // 老存档自愈：M16 前导入的照片持有临时目录 uri（系统清理后成死路径，
  // 表现为「一部分照片永远显示不出来」）。按 libraryAssetId 重新持久化进沙盒。
  // 静默后台跑：不弹权限框、逐张修逐张回写，修好的照片当场复活。
  useEffect(() => {
    if (!hydrated || repairStarted.current) return;
    repairStarted.current = true;
    (async () => {
      try {
        const { media, patchMediaSources } = useAppStore.getState();
        const pending: MediaSourcePatch[] = [];
        const flush = () => {
          if (pending.length === 0) return;
          patchMediaSources([...pending]);
          pending.length = 0;
        };
        await repairMediaSources(media, (patch) => {
          pending.push(patch);
          if (pending.length >= 4) flush();
        });
        flush();
      } catch (error) {
        // 自愈失败不该影响启动；下个会话还会再试
        console.warn('[repair] 媒体源自愈未完成:', error);
      }
    })();
  }, [hydrated]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {hydrated ? (
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
            }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="place/[placeId]" />
            <Stack.Screen name="visit/[visitId]" />
            <Stack.Screen name="story/[storyId]/index" />
            <Stack.Screen name="story/[storyId]/edit" />
            {/* App 内回收站：被移除的照片。不看归属，任何一张都能从这里恢复 */}
            <Stack.Screen name="removed" />
            {/* 真实相册是独立的一条线：不读写 store，删掉这两个 Screen 不影响示例流程 */}
            <Stack.Screen name="library/index" />
            <Stack.Screen name="library/inspect" />
            <Stack.Screen name="library/dates" />
            <Stack.Screen name="quarantine" />
            <Stack.Screen
              name="settings"
              options={{
                presentation: 'modal',
                headerShown: true,
                title: '设置',
                headerTintColor: colors.textPrimary,
              }}
            />
          </Stack>
        ) : (
          <View style={{ flex: 1, backgroundColor: colors.background }} />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

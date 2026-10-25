import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { checkMockIntegrity } from '@/src/data';
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

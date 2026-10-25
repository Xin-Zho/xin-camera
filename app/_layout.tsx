import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { checkMockIntegrity } from '@/src/data';
import { colors } from '@/src/theme';

export {
  // 让 expo-router 捕获路由树里的运行时错误
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // SDK 58 起 initialRouteName 已弃用，改叫 anchor
  anchor: '(tabs)',
};

export default function RootLayout() {
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
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

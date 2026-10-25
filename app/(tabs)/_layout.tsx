import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { colors, typography } from '@/src/theme';

export const unstable_settings = {
  // SDK 58 起 initialRouteName 已弃用，改叫 anchor
  anchor: 'map',
};

export default function TabLayout() {
  return (
    <Tabs
      // 配合 anchor：非 stack 导航要回到 anchor 必须是 initialRoute
      backBehavior="initialRoute"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.textPrimary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarLabelStyle: { ...typography.caption2, letterSpacing: 0.2 },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.separator,
        },
      }}>
      <Tabs.Screen
        name="map"
        options={{
          title: '地图',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'map', android: 'map', web: 'map' }} tintColor={color} size={26} />
          ),
        }}
      />
      <Tabs.Screen
        name="stories"
        options={{
          title: '故事',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{
                ios: 'rectangle.stack',
                android: 'collections_bookmark',
                web: 'collections_bookmark',
              }}
              tintColor={color}
              size={26}
            />
          ),
        }}
      />
    </Tabs>
  );
}

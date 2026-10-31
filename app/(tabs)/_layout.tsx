import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { BlurView } from 'expo-blur';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs/types';

import { colors, radius, typography } from '@/src/theme';

export const unstable_settings = {
  // SDK 58 起 initialRouteName 已弃用，改叫 anchor
  anchor: 'map',
};

/**
 * FluxTie 风格底部导航：悬浮真毛玻璃胶囊 Dock（expo-blur）。
 * 完全自绘 tabBar——图标药丸固定尺寸、三项等宽居中，杜绝系统 tab bar 的错位；
 * 按压整颗图标缩放（FluxTie/MD3 的触感），选中态是主色药丸。
 */
export default function TabLayout() {
  return (
    <Tabs
      // 配合 anchor：非 stack 导航要回到 anchor 必须是 initialRoute
      backBehavior="initialRoute"
      // 自绘 Dock 是导航器级配置（tabBar 不属于 screenOptions）
      tabBar={(props) => <FloatingDock {...props} />}
      screenOptions={{
        headerShown: false,
      }}>
      <Tabs.Screen
        name="map"
        options={{
          title: '地图',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'map', android: 'map', web: 'map' }} tintColor={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="photos"
        options={{
          title: '图库',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{
                ios: 'photo.on.rectangle',
                android: 'photo_library',
                web: 'photo_library',
              }}
              tintColor={color}
              size={22}
            />
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
              size={22}
            />
          ),
        }}
      />
    </Tabs>
  );
}

function FloatingDock({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  return (
    <View style={[styles.dock, { bottom: insets.bottom + 10 }]} pointerEvents="box-none">
      {/* 真毛玻璃：系统模糊 + extraLight 提亮；Android 走实验性模糊方法。垫在内容下不吃手势 */}
      <BlurView
        intensity={45}
        tint="extraLight"
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* hairline 描边画在模糊之上，勾出胶囊轮廓 */}
      <View style={[StyleSheet.absoluteFill, styles.dockBorder]} pointerEvents="none" />
      <View style={styles.row} pointerEvents="box-none">
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label = options.title ?? route.name;
          const focused = state.index === index;
          const iconColor = focused ? colors.textOnMedia : colors.textTertiary;

          const onPress = () => {
            const event = emitter.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigateToTab(route.key);
            }
          };

          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={label}
              style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
              onPress={onPress}>
              <View style={[styles.iconPill, focused && styles.iconPillActive]}>
                {options.tabBarIcon?.({ focused, color: iconColor, size: 22 })}
              </View>
              <Text style={[styles.itemLabel, focused && styles.itemLabelActive]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 20,
    right: 20,
    height: 64,
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    overflow: 'hidden',
    // FluxTie 悬浮件：极轻落影辅助分层，主体层次靠真毛玻璃
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  dockBorder: {
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  itemPressed: {
    transform: [{ scale: 0.94 }],
  },
  iconPill: {
    width: 54,
    height: 30,
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPillActive: {
    backgroundColor: colors.accent,
  },
  itemLabel: {
    ...typography.caption2,
    color: colors.textTertiary,
  },
  itemLabelActive: {
    color: colors.accent,
  },
});

import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/src/theme';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: '页面不存在' }} />
      <View style={styles.container}>
        <Text style={styles.title}>这里什么都没有</Text>
        <Text style={styles.hint}>可能是走了条不存在的路。</Text>
        <Link href="/(tabs)/map" style={styles.link}>
          <Text style={styles.linkText}>回到地图</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    backgroundColor: colors.background,
    gap: spacing.xs,
  },
  title: { ...typography.title2, color: colors.textPrimary },
  hint: { ...typography.footnote, color: colors.textSecondary },
  link: { marginTop: spacing.xl, paddingVertical: spacing.md },
  linkText: { ...typography.callout, color: colors.accent },
});

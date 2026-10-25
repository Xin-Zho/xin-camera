import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { clearQuarantine, readQuarantine } from '@/src/store/storage';
import type { QuarantineRecord } from '@/src/store/storage';
import { colors, layout, radius, spacing, typography } from '@/src/theme';

/**
 * 隔离存档。
 *
 * 存档读不出来时，这里保留的是**原始文本**，不是解析后的对象——
 * 解析后的东西已经是"我们以为它是什么"，恢复的时候没有价值。
 * 文字设为可长按选中，方便把内容拷出去手工抢救。
 */
export default function QuarantineScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [record, setRecord] = useState<QuarantineRecord | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const next = await readQuarantine();
    setRecord(next);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmClear = () => {
    Alert.alert('删除这份备份？', '删掉之后就没法再从这份存档里找回任何内容了。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await clearQuarantine();
          await load();
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{
        paddingTop: insets.top + spacing.sm,
        paddingBottom: insets.bottom + spacing.xxl,
      }}
      showsVerticalScrollIndicator={false}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={8}
          accessibilityLabel="返回">
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            tintColor={colors.textPrimary}
            size={20}
          />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>隔离存档</Text>
          <Text style={styles.subtitle}>读不出来的存档原样备份在这里</Text>
        </View>
      </View>

      {!loaded ? null : record ? (
        <View style={styles.body}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>备份信息</Text>
            <Row label="备份时间" value={record.capturedAt.replace('T', ' ').slice(0, 19)} />
            <Row label="来源 key" value={record.sourceKey || '—'} />
            <Row label="大小" value={`${record.bytes} 字节`} />
            <Row label="原因" value={record.reason || '—'} />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>原始内容</Text>
            <Text style={styles.raw} selectable>
              {record.payload}
            </Text>
          </View>

          <Pressable style={styles.dangerButton} onPress={confirmClear}>
            <Text style={styles.dangerButtonText}>删除这份备份</Text>
          </Pressable>

          <Text style={styles.footer}>
            这份数据不会自动被示例数据覆盖，只有点上面的删除才会清掉。
          </Text>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>没有隔离存档</Text>
          <Text style={styles.emptyText}>
            只有在存档读不出来的时候才会在这里留一份备份。现在没有，说明上次存档是好的。
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.backgroundGrouped },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.md,
  },
  backButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -6,
  },
  headerText: { flex: 1, gap: 1 },
  title: { ...typography.title2, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textTertiary },
  body: { paddingHorizontal: layout.screenPadding, gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: { ...typography.headline, color: colors.textPrimary },
  row: { gap: 2 },
  rowLabel: { ...typography.caption2, color: colors.textTertiary, letterSpacing: 0.4 },
  rowValue: { ...typography.footnote, color: colors.textPrimary },
  raw: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
  dangerButton: {
    minHeight: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.dangerMuted,
  },
  dangerButtonText: { ...typography.callout, color: colors.danger, fontWeight: '600' },
  empty: { paddingHorizontal: layout.screenPadding, paddingTop: spacing.xxl, gap: spacing.sm },
  emptyTitle: { ...typography.headline, color: colors.textPrimary },
  emptyText: { ...typography.footnote, color: colors.textSecondary, lineHeight: 20 },
  footer: { ...typography.caption, color: colors.textTertiary, lineHeight: 17 },
});

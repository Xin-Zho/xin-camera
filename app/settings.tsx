import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { mockMedia, mockPlaces, mockVisits } from '@/src/data';
import { useAppStore } from '@/src/store/appStore';
import { selectActiveStories } from '@/src/store/selectors';
import { colors, layout, radius, spacing, typography } from '@/src/theme';

interface RowProps {
  label: string;
  value: string;
  hint?: string;
}

function Row({ label, value, hint }: RowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export default function SettingsScreen() {
  // 用 store 而不是 mock 常量：这里要反映用户当前的操作结果（合并、删除），
  // 否则在故事页删完再进来会看到没变的数字，看起来像状态不同步。
  const stories = useAppStore((s) => s.stories);
  const activeStories = selectActiveStories(stories).length;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <Text style={styles.sectionTitle}>原型状态</Text>
      <View style={styles.card}>
        <Row
          label="本地持久化"
          value="未接入"
          hint="编辑只存在内存里，重启 App 会回到示例数据"
        />
        <View style={styles.divider} />
        <Row label="照片库扫描" value="未接入" hint="第二阶段接 iOS 相册 API" />
        <View style={styles.divider} />
        <Row label="真实 GPS 与地点反查" value="未接入" hint="当前地点名称是示例数据" />
        <View style={styles.divider} />
        <Row label="后台整理" value="未接入" hint="不承诺真实 iOS 后台任务" />
        <View style={styles.divider} />
        <Row label="云同步 / 账号" value="不做" hint="全部本地内存" />
        <View style={styles.divider} />
        <Row label="AI 图片风格转换" value="不做" />
      </View>

      <Text style={styles.sectionTitle}>示例数据</Text>
      <View style={styles.card}>
        <Row label="地点" value={`${mockPlaces.length}`} />
        <View style={styles.divider} />
        <Row label="到访" value={`${mockVisits.length}`} />
        <View style={styles.divider} />
        <Row label="媒体" value={`${mockMedia.length}`} />
        <View style={styles.divider} />
        <Row
          label="故事（可见）"
          value={`${activeStories}`}
          hint={`共 ${stories.length} 条，含已合并与已删除`}
        />
      </View>

      <Text style={styles.sectionTitle}>备份</Text>
      <View style={styles.card}>
        <Row label="导出故事结构" value="后续版本" hint="默认不复制完整媒体文件" />
        <View style={styles.divider} />
        <Row label="更换设备重新匹配" value="后续版本" />
      </View>

      <Text style={styles.footer}>
        第一阶段原型 · 所有照片与地点均为项目内示例素材，不读取真实相册，不上传任何数据。
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.backgroundGrouped },
  content: {
    padding: layout.screenPadding,
    paddingBottom: spacing.huge,
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.caption2,
    color: colors.textTertiary,
    letterSpacing: 0.8,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 52,
  },
  rowMain: { flex: 1, gap: 2 },
  rowLabel: { ...typography.callout, color: colors.textPrimary },
  rowHint: { ...typography.caption, color: colors.textTertiary },
  rowValue: { ...typography.callout, color: colors.textSecondary },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  footer: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: spacing.xxl,
    lineHeight: 18,
  },
});

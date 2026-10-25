import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { mockMedia, mockPlaces, mockVisits } from '@/src/data';
import { STORE_KEY, STORE_VERSION, useAppStore } from '@/src/store/appStore';
import { selectActiveStories } from '@/src/store/selectors';
import { describeStorageIssue, readQuarantine } from '@/src/store/storage';
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

/** 可点击的行：整行高亮。tone 区分「跳转」（强调色）和「不可撤销操作」（危险色） */
function ActionRow({
  label,
  hint,
  onPress,
  tone = 'danger',
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  tone?: 'danger' | 'accent';
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.rowMain}>
        <Text style={[styles.rowLabel, tone === 'danger' ? styles.actionLabel : styles.linkLabel]}>
          {label}
        </Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  // 用 store 而不是 mock 常量：这里要反映用户当前的操作结果（合并、删除），
  // 否则在故事页删完再进来会看到没变的数字，看起来像状态不同步。
  const stories = useAppStore((s) => s.stories);
  const resetToMock = useAppStore((s) => s.resetToMock);
  const storageIssue = useAppStore((s) => s.storageIssue);
  const activeStories = selectActiveStories(stories).length;

  // 隔离存档只在这里用来决定「要不要显示那一行」，内容在专门页面里看
  const [quarantineBytes, setQuarantineBytes] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    void readQuarantine().then((record) => {
      if (active) setQuarantineBytes(record?.bytes ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  const storageNotice = describeStorageIssue(storageIssue);

  const confirmReset = () => {
    Alert.alert(
      '重置为示例数据？',
      '本地保存的编辑、合并和删除记录会被覆盖成初始示例故事，不能撤销。',
      [
        { text: '取消', style: 'cancel' },
        { text: '重置', style: 'destructive', onPress: resetToMock },
      ],
    );
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      {storageNotice ? (
        <View
          style={[
            styles.notice,
            storageNotice.tone === 'danger' ? styles.noticeDanger : styles.noticeWarning,
          ]}>
          <Text
            style={[
              styles.noticeTitle,
              storageNotice.tone === 'danger' ? styles.noticeTextDanger : styles.noticeTextWarning,
            ]}>
            {storageNotice.title}
          </Text>
          <Text
            style={[
              styles.noticeBody,
              storageNotice.tone === 'danger' ? styles.noticeTextDanger : styles.noticeTextWarning,
            ]}>
            {storageNotice.body}
          </Text>
          {quarantineBytes !== null && storageIssue.kind !== 'unavailable' ? (
            <Pressable style={styles.noticeButton} onPress={() => router.push('/quarantine')}>
              <Text style={styles.noticeButtonText}>查看备份</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>真实相册（只读实验）</Text>
      <View style={styles.card}>
        <ActionRow
          label="打开真实相册"
          hint="读缩略图、类型、拍摄时间、定位；不生成到访和故事，也不写相册"
          tone="accent"
          onPress={() => router.push('/library')}
        />
        <View style={styles.divider} />
        <Row
          label="照片库扫描"
          value="只读实验"
          hint="已能分页读取；尚未接入到访与故事的生成链路"
        />
        <View style={styles.divider} />
        <Row label="真实 GPS 与地点反查" value="只读经纬度" hint="地点名称仍来自示例数据" />
      </View>

      <Text style={styles.sectionTitle}>原型状态</Text>
      <View style={styles.card}>
        <Row
          label="本地持久化"
          value={storageNotice ? '本次运行有效' : '已开启'}
          hint={
            storageNotice
              ? '现在写不进去，退出 App 会回到示例数据'
              : '标题、封面、顺序、重点照片，以及合并 / 拆分 / 删除都会写进本地，重启后保留'
          }
        />
        <View style={styles.divider} />
        <Row
          label="存档范围"
          value={`v${STORE_VERSION}`}
          hint={`只存故事层（${STORE_KEY}）；地点、到访、照片每次从示例数据重建`}
        />
        <View style={styles.divider} />
        <Row label="后台整理" value="未接入" hint="不承诺真实 iOS 后台任务" />
        <View style={styles.divider} />
        <Row label="云同步 / 账号" value="不做" hint="数据只在本机" />
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
        <View style={styles.divider} />
        <ActionRow
          label="重置为示例数据"
          hint="丢掉本地存档，回到最初的示例故事"
          onPress={confirmReset}
        />
      </View>

      <Text style={styles.sectionTitle}>备份</Text>
      <View style={styles.card}>
        <ActionRow
          label="隔离存档"
          hint={
            quarantineBytes === null
              ? '没有读不出来的存档备份'
              : `留了一份 ${quarantineBytes} 字节的原始备份，等你去查看或抢救`
          }
          tone="accent"
          onPress={() => router.push('/quarantine')}
        />
        <View style={styles.divider} />
        <Row label="导出故事结构" value="后续版本" hint="默认不复制完整媒体文件" />
        <View style={styles.divider} />
        <Row label="更换设备重新匹配" value="后续版本" />
      </View>

      <Text style={styles.footer}>
        示例数据与真实相册是两条独立的线：故事、地图、编辑全部走示例数据，真实相册那一页只读。
        编辑结果只写在本机，卸载 App 或点上面的重置都会清掉。
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
  rowPressed: { backgroundColor: colors.backgroundGrouped },
  rowLabel: { ...typography.callout, color: colors.textPrimary },
  actionLabel: { color: colors.danger },
  linkLabel: { color: colors.accent },
  notice: {
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  noticeDanger: { backgroundColor: colors.dangerMuted },
  noticeWarning: { backgroundColor: colors.warningMuted },
  noticeTitle: { ...typography.footnote, fontWeight: '600' },
  noticeBody: { ...typography.caption, lineHeight: 17 },
  noticeTextDanger: { color: colors.danger },
  noticeTextWarning: { color: colors.warning },
  noticeButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.xxs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  noticeButtonText: { ...typography.caption, color: colors.textPrimary, fontWeight: '600' },
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

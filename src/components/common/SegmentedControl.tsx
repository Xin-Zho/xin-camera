import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/src/theme';

/**
 * iOS 风格分段控件。用于编辑页的版式、封面标题位置这类"少数几选一"。
 * 泛型保证 onChange 回传的不会是别的字符串。
 */
interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  groupLabel?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  groupLabel,
}: Props<T>) {
  return (
    <View style={styles.track} accessibilityRole="radiogroup" accessibilityLabel={groupLabel}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active && styles.segmentActive]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}>
            <Text
              style={[styles.label, active && styles.labelActive]}
              numberOfLines={1}
              allowFontScaling={false}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: radius.md + 2,
    backgroundColor: colors.backgroundGrouped,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.xs,
  },
  segmentActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  label: { ...typography.footnote, color: colors.textSecondary },
  labelActive: { color: colors.textPrimary, fontWeight: '600' },
});

import type { BudgetLine, SpendingStatus } from '@jengalink/contracts';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf, radius, spacing } from '@jengalink/ui';
import { Text, useJengaTheme } from '@jengalink/ui/native';
import { View } from 'react-native';

export function SpendingStatusChip({ status }: { status: SpendingStatus }) {
  const { t } = useI18n();
  const { colors, status: tone } = useJengaTheme();
  const c =
    status === 'approved'
      ? tone('paid')
      : status === 'submitted'
        ? { color: colors.structure, soft: colors.structureSoft }
        : status === 'rejected' || status === 'changes_requested'
          ? tone('problem')
          : { color: colors.inkMuted, soft: colors.surfaceSunken };
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: radius.pill,
        backgroundColor: c.soft,
      }}
    >
      <Text variant="caption" color={c.color}>
        {t(`spending.status_${status}`)}
      </Text>
    </View>
  );
}

/** One package: spent and reserved out of its cost budget, with the four figures (from the server). */
export function BudgetLineCard({ line }: { line: BudgetLine }) {
  const { t } = useI18n();
  const { colors, status } = useJengaTheme();
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / Math.max(1, line.costBudget)) * 100))}%` as const;
  const figures = [
    [t('spending.spent'), line.posted],
    [t('spending.reserved'), line.committed],
    [t('spending.waiting'), line.pending],
    [t('spending.free'), line.headroom],
  ] as const;
  return (
    <View style={{ gap: spacing.sm }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          gap: spacing.sm,
          flexWrap: 'wrap',
        }}
      >
        <Text variant="bodyStrong">{line.name}</Text>
        <Text variant="caption" muted>
          {t('spending.costBudget', { amount: formatRwf(line.costBudget) })}
        </Text>
      </View>
      <View
        accessible
        accessibilityLabel={`${t('spending.spent')} ${formatRwf(line.posted)}, ${t('spending.reserved')} ${formatRwf(line.committed)}, ${t('spending.free')} ${formatRwf(line.headroom)}`}
        style={{
          flexDirection: 'row',
          height: 12,
          borderRadius: 6,
          overflow: 'hidden',
          backgroundColor: colors.surfaceSunken,
        }}
      >
        <View style={{ width: pct(line.posted), backgroundColor: colors.primary }} />
        <View
          style={{
            width: pct(line.committed),
            backgroundColor: colors.primary,
            opacity: 0.4,
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 }}>
        {figures.map(([label, n], i) => (
          <View key={label} style={{ width: '50%' }}>
            <Text variant="caption" muted>
              {label}
            </Text>
            <Text variant="bodyStrong" color={i === 3 && n <= 0 ? status('problem').color : undefined}>
              {formatRwf(n)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

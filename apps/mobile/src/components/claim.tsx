import type { ClaimStatus } from '@jengalink/contracts';
import { useI18n } from '@jengalink/i18n/react';
import { radius } from '@jengalink/ui';
import { Text, useJengaTheme } from '@jengalink/ui/native';
import { View } from 'react-native';

export function ClaimStatusChip({ status }: { status: ClaimStatus }) {
  const { t } = useI18n();
  const { colors, status: tone } = useJengaTheme();
  const c =
    status === 'approved' || status === 'paid'
      ? tone('paid')
      : status === 'submitted'
        ? { color: colors.structure, soft: colors.structureSoft }
        : status === 'rejected' || status === 'changes_requested'
          ? tone('problem')
          : { color: colors.inkMuted, soft: colors.surfaceSunken };
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: c.soft }}>
      <Text variant="caption" color={c.color}>
        {t(`claims.status_${status}`)}
      </Text>
    </View>
  );
}

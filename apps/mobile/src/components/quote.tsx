import type { QuoteSummary } from '@jengalink/contracts';
import { useI18n } from '@jengalink/i18n/react';
import { radius } from '@jengalink/ui';
import { Text, useJengaTheme } from '@jengalink/ui/native';
import { View } from 'react-native';

export function QuoteStatusChip({ status }: { status: QuoteSummary['status'] }) {
  const { t } = useI18n();
  const { colors, status: tone } = useJengaTheme();
  const c =
    status === 'accepted'
      ? tone('paid')
      : status === 'sent'
        ? { color: colors.structure, soft: colors.structureSoft }
        : status === 'expired' || status === 'declined'
          ? tone('problem')
          : { color: colors.inkMuted, soft: colors.surfaceSunken };
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: c.soft }}>
      <Text variant="caption" color={c.color}>
        {t(`quote.status_${status}`)}
      </Text>
    </View>
  );
}

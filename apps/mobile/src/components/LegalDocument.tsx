import type { MessageKey } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { radius, spacing } from '@jengalink/ui';
import { Text, useJengaTheme } from '@jengalink/ui/native';
import { TriangleAlert } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';

/** Shared renderer for the Privacy Notice and Terms of Service screens. */
export function LegalDocument({ updatedKey, paragraphKeys }: { updatedKey: MessageKey; paragraphKeys: MessageKey[] }) {
  const { t } = useI18n();
  const { colors } = useJengaTheme();
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
      <Text variant="caption" muted>
        {t(updatedKey)}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          gap: spacing.sm,
          padding: spacing.md,
          borderRadius: radius.md,
          backgroundColor: colors.structureSoft,
          alignItems: 'flex-start',
        }}
      >
        <TriangleAlert size={18} color={colors.structure} />
        <Text variant="label" color={colors.structure} style={{ flex: 1 }}>
          {t('legal.draftNotice')}
        </Text>
      </View>
      <View style={{ gap: spacing.lg }}>
        {paragraphKeys.map((k) => (
          <Text key={k}>{t(k)}</Text>
        ))}
      </View>
    </ScrollView>
  );
}

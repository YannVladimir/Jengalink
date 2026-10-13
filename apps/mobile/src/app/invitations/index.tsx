import type { InvitationView } from '@jengalink/contracts';
import { request } from '@jengalink/contracts/client';
import { formatDate, type MessageKey } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { spacing } from '@jengalink/ui';
import { Card, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import { router, useFocusEffect } from 'expo-router';
import { Mail } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { ListRow } from '@/components/ui';
import { api, useAuth } from '@/lib/auth';

/** Invitations waiting for the signed-in user (sent to their verified phone or email). */
export default function InvitationsScreen() {
  const { t, locale } = useI18n();
  const { colors } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [list, setList] = useState<InvitationView[] | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setFailed(false);
      void withRefresh(() => request(() => api.GET('/v1/invitations')))
        .then(setList)
        .catch(() => setFailed(true));
    }, [withRefresh]),
  );

  if (failed) return <StateView kind="error" title={t('common.somethingWrong')} />;
  if (!list)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} style={{ backgroundColor: colors.background }}>
      {list.length === 0 ? (
        <Text muted>{t('invite.listEmpty')}</Text>
      ) : (
        <Card flush>
          {list.map((inv, i) => (
            <ListRow
              key={inv.id}
              icon={Mail}
              title={inv.projectName ?? inv.organizationName}
              subtitle={`${t(`server.role_${inv.role}` as MessageKey)} · ${inv.invitedBy ?? inv.organizationName} · ${t('invite.expiresOn', { date: formatDate(locale, inv.expiresAt) })}`}
              onPress={() => router.push({ pathname: '/invitations/[id]', params: { id: inv.id } })}
              last={i === list.length - 1}
            />
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

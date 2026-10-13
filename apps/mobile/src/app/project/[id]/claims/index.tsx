import type { ClaimMilestones, ClaimSummary, ProjectSummary } from '@jengalink/contracts';
import { request } from '@jengalink/contracts/client';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf, spacing } from '@jengalink/ui';
import { Button, Card, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { HandCoins } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { ClaimStatusChip } from '@/components/claim';
import { api, useAuth } from '@/lib/auth';

const CLAIMERS = ['contractor', 'manager'];

/** The project's payment claims (Phase 4). Owners see claims once they are sent. */
export default function ClaimsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { colors } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [list, setList] = useState<ClaimSummary[] | null>(null);
  const [milestones, setMilestones] = useState<ClaimMilestones | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      Promise.all([
        withRefresh(() => request(() => api.GET('/v1/projects/{id}/claims', { params: { path: { id } } }))),
        withRefresh(() => request(() => api.GET('/v1/projects/{id}/claims/milestones', { params: { path: { id } } }))),
        withRefresh(() => request(() => api.GET('/v1/projects/{id}', { params: { path: { id } } }))),
      ])
        .then(([c, m, p]) => {
          if (!live) return;
          setList(c);
          setMilestones(m);
          setProject(p);
        })
        .catch(() => live && setFailed(true));
      return () => {
        live = false;
      };
    }, [id, withRefresh]),
  );

  if (failed) return <StateView kind="offline" title={t('common.somethingWrong')} />;
  if (!list || !project || !milestones)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  const claimer = project.myRoles.some((r) => CLAIMERS.includes(r));
  const agreed = milestones.agreementVersion !== null;

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <Text variant="caption" muted>
        {project.name}
      </Text>
      <Text variant="caption" muted>
        {t('claims.recordOnly')}
      </Text>
      {agreed && (
        <Card>
          {milestones.milestones.map((m) => (
            <View key={m.index} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 4 }}>
              <Text style={{ flex: 1 }}>{m.name}</Text>
              <Text variant="caption" muted>
                {m.remaining === null ? t('claims.claimedSoFar', { amount: formatRwf(m.claimed) }) : m.remaining === 0 ? t('claims.fullyClaimed') : t('claims.left', { amount: formatRwf(m.remaining) })}
              </Text>
            </View>
          ))}
        </Card>
      )}
      {!agreed && <Text muted>{t('claims.noAgreement')}</Text>}
      {agreed && list.length === 0 && <Text muted>{claimer ? t('claims.empty') : t('claims.emptyOwner')}</Text>}
      {list.map((c) => (
        <Pressable key={c.id} onPress={() => router.push({ pathname: '/project/[id]/claims/[claimId]', params: { id, claimId: c.id } })} accessibilityRole="button">
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text variant="caption" muted style={{ flex: 1 }}>
                {c.number}
                {c.submittedAt ? ` · ${formatDate(locale, c.submittedAt)}` : ''}
              </Text>
              <ClaimStatusChip status={c.status} />
            </View>
            <Text variant="money" style={{ marginTop: 4 }}>
              {formatRwf(c.amount)}
            </Text>
            <Text variant="bodyStrong">{c.milestoneName}</Text>
            <Text variant="caption" muted>
              {t('claims.evidenceCount', { count: c.evidenceCount })}
            </Text>
          </Card>
        </Pressable>
      ))}
      {claimer && agreed && project.status === 'active' && (
        <Button title={t('claims.newClaim')} icon={HandCoins} onPress={() => router.push({ pathname: '/project/[id]/claims/[claimId]', params: { id, claimId: 'new' } })} />
      )}
    </ScrollView>
  );
}

import type { ProjectBudget, ProjectSummary, SpendingSummary } from '@jengalink/contracts';
import { request } from '@jengalink/contracts/client';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf, spacing } from '@jengalink/ui';
import { Button, Card, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { BudgetLineCard, SpendingStatusChip } from '@/components/spending';
import { api, useAuth } from '@/lib/auth';

const REQUESTERS = ['contractor', 'manager'];

/** Spending requests on cost + fee packages (Phase 4), with each package's budget. */
export default function SpendingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { colors } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [list, setList] = useState<SpendingSummary[] | null>(null);
  const [budget, setBudget] = useState<ProjectBudget | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      Promise.all([
        withRefresh(() => request(() => api.GET('/v1/projects/{id}/spending', { params: { path: { id } } }))),
        withRefresh(() => request(() => api.GET('/v1/projects/{id}/budget', { params: { path: { id } } }))),
        withRefresh(() => request(() => api.GET('/v1/projects/{id}', { params: { path: { id } } }))),
      ])
        .then(([l, b, p]) => {
          if (!live) return;
          setList(l);
          setBudget(b);
          setProject(p);
        })
        .catch(() => live && setFailed(true));
      return () => {
        live = false;
      };
    }, [id, withRefresh]),
  );

  if (failed) return <StateView kind="offline" title={t('common.somethingWrong')} />;
  if (!list || !budget || !project)
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  const requester = project.myRoles.some((r) => REQUESTERS.includes(r));
  const ready = budget.lines.length > 0;

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <Text variant="caption" muted>
        {project.name}
      </Text>
      <Text variant="caption" muted>
        {t('spending.recordOnly')}
      </Text>
      {budget.agreementVersion === null ? (
        <Text muted>{t('spending.noAgreement')}</Text>
      ) : !ready ? (
        <Text muted>{t('spending.noPackages')}</Text>
      ) : (
        <Card>
          <Text variant="sectionTitle" style={{ marginBottom: spacing.sm }}>
            {t('spending.budgetTitle')}
          </Text>
          <View style={{ gap: spacing.lg }}>
            {budget.lines.map((l) => (
              <BudgetLineCard key={l.index} line={l} />
            ))}
          </View>
        </Card>
      )}
      {ready && list.length === 0 && <Text muted>{t('spending.empty')}</Text>}
      {list.map((r) => (
        <Pressable
          key={r.id}
          onPress={() =>
            router.push({
              pathname: '/project/[id]/spending/[requestId]',
              params: { id, requestId: r.id },
            })
          }
          accessibilityRole="button"
        >
          <Card>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
              }}
            >
              <Text variant="caption" muted style={{ flex: 1 }}>
                {r.number} · {r.milestoneName}
              </Text>
              <SpendingStatusChip status={r.status} />
            </View>
            <Text variant="money" style={{ marginTop: 4 }}>
              {formatRwf(r.amount)}
            </Text>
            <Text variant="bodyStrong">{r.purpose}</Text>
            {(r.posted > 0 || r.committed > 0) && (
              <Text variant="caption" muted>
                {t('spending.spent')} {formatRwf(r.posted)} · {t('spending.reserved')} {formatRwf(r.committed)}
              </Text>
            )}
          </Card>
        </Pressable>
      ))}
      {requester && ready && project.status === 'active' && (
        <Button
          title={t('spending.newRequest')}
          icon={Plus}
          onPress={() =>
            router.push({
              pathname: '/project/[id]/spending/[requestId]',
              params: { id, requestId: 'new' },
            })
          }
        />
      )}
    </ScrollView>
  );
}

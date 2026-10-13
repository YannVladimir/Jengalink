import { actionCount, type MoneyAcross, type MoneyActions, type ProjectMoney } from '@jengalink/contracts';
import { request } from '@jengalink/contracts/client';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf, radius, spacing } from '@jengalink/ui';
import { Button, Card, ClaimTracker, Money, MoneyBar, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import { router, useFocusEffect } from 'expo-router';
import { Banknote, ChevronRight, FilePen, FolderPlus, HandCoins, ReceiptText, Wallet } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fromIsoDate } from '@/components/DatePickerSheet';
import { api, useAuth } from '@/lib/auth';
import { useCurrentProject } from '@/lib/current-project';

/**
 * Money (Phase 4): what is owed now, what waits on you, the contract bar, claims with their
 * steps, and payments. Contract money only; contractor internal costs never appear (spec §37.3).
 */
export default function MoneyScreen() {
  const { t, locale } = useI18n();
  const { colors } = useJengaTheme();
  const { withRefresh } = useAuth();
  const { project, select } = useCurrentProject();
  const [money, setMoney] = useState<ProjectMoney | null>(null);
  const [across, setAcross] = useState<MoneyAcross | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!project) return;
      let live = true;
      Promise.all([
        withRefresh(() => request(() => api.GET('/v1/projects/{id}/money', { params: { path: { id: project.id } } }))).catch(() => null),
        withRefresh(() => request(() => api.GET('/v1/money'))),
      ])
        .then(([m, a]) => {
          if (!live) return;
          setMoney(m);
          setAcross(a);
          setFailed(false);
        })
        .catch(() => live && setFailed(true));
      return () => {
        live = false;
      };
    }, [project, withRefresh]),
  );

  if (!project)
    return (
      <StateView
        kind="empty"
        title={t('feed.noProjectsTitle')}
        message={t('dash.emptyLead')}
        action={<Button title={t('wizard.startProject')} icon={FolderPlus} onPress={() => router.push('/project/new')} />}
      />
    );
  if (failed) return <StateView kind="offline" title={t('common.somethingWrong')} />;
  if (!across)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );

  const f = money?.figures;
  const others = across.projects.filter((p) => p.projectId !== project.id);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 120 }}>
        <View style={{ gap: 2 }}>
          <Text variant="screenTitle">{t('money.title')}</Text>
          <Text variant="caption" muted>
            {project.name}
          </Text>
        </View>

        {!money ? (
          <Card>
            <Text muted>{t('money.noAccess')}</Text>
          </Card>
        ) : f && f.contract === 0 ? (
          <Card>
            <Text muted>{t('money.noAgreement')}</Text>
          </Card>
        ) : (
          f && (
            <Card>
              <Text variant="label" muted>
                {money.side === 'contractor' ? t('money.owedToYou') : t('money.youOweNow')}
              </Text>
              <Money amount={f.approvedUnpaid} variant="moneyLarge" />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text muted>{t('money.waitingForDecision')}</Text>
                <Money amount={f.awaitingDecision} />
              </View>
              {f.pendingVerification > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                  <Text muted>{t('money.pendingVerification')}</Text>
                  <Money amount={f.pendingVerification} />
                </View>
              )}
              <View style={{ marginTop: spacing.lg }}>
                <MoneyBar contract={f.contract} paid={f.paid} approvedUnpaid={f.approvedUnpaid} />
              </View>
            </Card>
          )
        )}

        {money && <Actions actions={money.actions} projectId={project.id} />}

        {money && money.claims.length > 0 && (
          <View style={{ gap: spacing.sm }}>
            <Text variant="sectionTitle">{t('money.paymentClaims')}</Text>
            {money.claims.map((c) => (
              <Pressable key={c.id} onPress={() => router.push({ pathname: '/project/[id]/claims/[claimId]', params: { id: project.id, claimId: c.id } })} accessibilityRole="button">
                <Card>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong">
                        {c.number} · {c.milestoneName}
                      </Text>
                      {c.paid > 0 && c.status !== 'paid' && (
                        <Text variant="caption" muted>
                          {t('money.partlyPaid', { paid: formatRwf(c.paid), amount: formatRwf(c.amount) })}
                        </Text>
                      )}
                    </View>
                    <Money amount={c.amount} />
                  </View>
                  <View style={{ marginTop: spacing.sm }}>
                    <ClaimTracker requestedAt={c.requestedAt} approvedAt={c.approvedAt} paidAt={c.paidAt} disputedStep={c.disputedStep} />
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        )}

        {money && money.payments.length > 0 && (
          <View style={{ gap: spacing.sm }}>
            <Text variant="sectionTitle">{t('money.paymentsRecorded')}</Text>
            <Card>
              {money.payments.map((p, i) => (
                <View key={p.id} style={{ flexDirection: 'row', gap: spacing.sm, paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{p.claimNumber ?? t('payments.advance')}</Text>
                    <Text variant="caption" muted>
                      {formatDate(locale, fromIsoDate(p.paymentDate))} · {t(`payments.method_${p.method}`)} · {t(`payments.status_${p.status}`)}
                    </Text>
                  </View>
                  <Money amount={p.amount} />
                </View>
              ))}
            </Card>
          </View>
        )}

        {money?.spending && (
          <Card>
            <Text variant="label" muted>
              {t('money.spendingTitle')}
            </Text>
            <Text style={{ marginTop: 4 }}>
              {t('money.spendingLine', { posted: formatRwf(money.spending.posted), committed: formatRwf(money.spending.committed), budget: formatRwf(money.spending.costBudget) })}
            </Text>
          </Card>
        )}

        <View style={{ gap: spacing.sm }}>
          <Row icon={HandCoins} label={t('money.allClaims')} onPress={() => router.push({ pathname: '/project/[id]/claims', params: { id: project.id } })} />
          <Row icon={Banknote} label={t('money.allPayments')} onPress={() => router.push({ pathname: '/project/[id]/payments', params: { id: project.id } })} />
          <Row icon={Wallet} label={t('spending.title')} onPress={() => router.push({ pathname: '/project/[id]/spending', params: { id: project.id } })} />
          <Row icon={FilePen} label={t('changes.title')} onPress={() => router.push({ pathname: '/project/[id]/changes', params: { id: project.id } })} />
        </View>

        {others.length > 0 && (
          <View style={{ gap: spacing.sm }}>
            <Text variant="sectionTitle">{t('money.acrossTitle')}</Text>
            <Card>
              {others.map((p, i) => (
                <Pressable
                  key={p.projectId}
                  onPress={() => select(p.projectId)}
                  accessibilityRole="button"
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{p.projectName}</Text>
                    <Text variant="caption" muted>
                      {t('money.owedHere', { amount: formatRwf(p.figures.approvedUnpaid) })}
                      {p.figures.awaitingDecision > 0 ? ` · ${t('money.waitingForDecision')} ${formatRwf(p.figures.awaitingDecision)}` : ''}
                    </Text>
                  </View>
                  {actionCount(p.actions) > 0 && (
                    <View style={{ minWidth: 24, paddingHorizontal: 6, height: 24, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }}>
                      <Text variant="caption" color={colors.onPrimary}>
                        {actionCount(p.actions)}
                      </Text>
                    </View>
                  )}
                  <ChevronRight size={18} color={colors.inkMuted} />
                </Pressable>
              ))}
            </Card>
          </View>
        )}

        <Text variant="caption" muted style={{ textAlign: 'center' }}>
          {t('money.paidMeansVerified')} {t('money.outsideApp')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/** What waits on the caller, each a row to where it is done. */
function Actions({ actions: a, projectId }: { actions: MoneyActions; projectId: string }) {
  const { t } = useI18n();
  const items = [
    { n: a.claimsToDecide, label: t('money.claimsToDecide', { count: a.claimsToDecide }), icon: HandCoins, to: '/project/[id]/claims' as const },
    { n: a.paymentsToConfirm, label: t('money.paymentsToConfirm', { count: a.paymentsToConfirm }), icon: Banknote, to: '/project/[id]/payments' as const },
    { n: a.spendingToDecide, label: t('money.spendingToDecide', { count: a.spendingToDecide }), icon: Wallet, to: '/project/[id]/spending' as const },
    { n: a.receiptsMissing, label: t('money.receiptsMissing', { count: a.receiptsMissing }), icon: ReceiptText, to: '/project/[id]/spending' as const },
  ].filter((x) => x.n > 0);
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="sectionTitle">{t('money.needsYou')}</Text>
      {items.length === 0 ? (
        <Text muted>{t('money.nothingWaiting')}</Text>
      ) : (
        items.map((x) => <Row key={x.label} icon={x.icon} label={x.label} strong onPress={() => router.push({ pathname: x.to, params: { id: projectId } })} />)
      )}
    </View>
  );
}

function Row({ icon: Icon, label, onPress, strong }: { icon: typeof Wallet; label: string; onPress: () => void; strong?: boolean }) {
  const { colors } = useJengaTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: 52,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        backgroundColor: colors.surface,
        borderWidth: strong ? 1.5 : 1,
        borderColor: strong ? colors.primary : colors.border,
      }}
    >
      <Icon size={20} color={strong ? colors.primary : colors.inkMuted} />
      <Text variant={strong ? 'bodyStrong' : 'body'} style={{ flex: 1 }}>
        {label}
      </Text>
      <ChevronRight size={18} color={colors.inkMuted} />
    </Pressable>
  );
}

import { type InvitationView, provinceKeys } from '@jengalink/contracts';
import { formatDate, type MessageKey } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf, spacing } from '@jengalink/ui';
import { Button, Card, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import { router } from 'expo-router';
import { Check, CheckCircle2, Eye, type LucideIcon, ShieldCheck, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomAction } from '@/components/ui';
import { request } from '@jengalink/contracts/client';
import { ApiError, api, useAuth } from '@/lib/auth';

/** One block of the plain-words explanation: an icon, a heading and 2–3 short lines. */
export function PromiseList({ icon: Icon, title, items, tone }: { icon: LucideIcon; title: string; items: string[]; tone: 'see' | 'approve' | 'keep' }) {
  const { colors, status } = useJengaTheme();
  const color = tone === 'see' ? colors.structure : tone === 'approve' ? colors.primary : status('paid').color;
  const soft = tone === 'see' ? colors.structureSoft : tone === 'approve' ? colors.primarySoft : status('paid').soft;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: soft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={18} color={color} />
        </View>
        <Text variant="sectionTitle">{title}</Text>
      </View>
      <View style={{ gap: spacing.sm }} accessibilityRole="list">
        {items.map((item) => (
          <View key={item} style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Check size={16} color={color} style={{ marginTop: 3 }} />
            <Text style={{ flex: 1 }}>{item}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** What an owner sees, approves and keeps, from the contractor's side (before sending). */
export function OwnerExplainer() {
  const { t } = useI18n();
  return (
    <View style={{ gap: spacing.md }}>
      <PromiseList icon={Eye} tone="see" title={t('invite.seeTitle')} items={[t('invite.see1'), t('invite.see2'), t('invite.see3')]} />
      <PromiseList
        icon={CheckCircle2}
        tone="approve"
        title={t('invite.approveTitle')}
        items={[t('invite.approve1'), t('invite.approve2'), t('invite.approve3')]}
      />
      <PromiseList icon={ShieldCheck} tone="keep" title={t('invite.keepTitle')} items={[t('invite.keep1'), t('invite.keep2')]} />
    </View>
  );
}

const roleName = (role: string, t: ReturnType<typeof useI18n>['t']) => t(`server.role_${role}` as MessageKey);

/** The invitation as its recipient sees it, with Accept and Decline. */
export function InvitationDetails({ invitation, onChange }: { invitation: InvitationView; onChange: (i: InvitationView) => void }) {
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inv = invitation;
  const who = inv.invitedBy ?? t('invite.someone');
  const role = roleName(inv.role, t);
  const isOwner = inv.scope === 'project' && inv.role === 'owner';
  const headline =
    inv.scope === 'organization'
      ? t('invite.headlineOrg', { who, org: inv.organizationName, role })
      : isOwner
        ? t('invite.headlineOwner', { who, project: inv.projectName ?? '' })
        : t('invite.headlineRole', { who, project: inv.projectName ?? '', role });

  const act = async (what: 'accept' | 'decline') => {
    setBusy(what);
    setError(null);
    try {
      const path = what === 'accept' ? '/v1/invitations/{id}/accept' : '/v1/invitations/{id}/decline';
      const next = await withRefresh(() => request(() => api.POST(path, { params: { path: { id: inv.id } } })));
      onChange(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(null);
    }
  };

  if (inv.state === 'accepted' || inv.state === 'declined') {
    const accepted = inv.state === 'accepted';
    const tone = status(accepted ? 'paid' : 'reported');
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flex: 1, padding: spacing.xl, gap: spacing.lg, justifyContent: 'center' }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: tone.soft }}>
            {accepted ? <Check size={32} color={tone.color} /> : <X size={32} color={tone.color} />}
          </View>
          <Text variant="screenTitle">
            {accepted ? t('invite.acceptedTitle', { project: inv.projectName ?? inv.organizationName }) : t('invite.declinedTitle')}
          </Text>
          <Text muted>{accepted ? t('invite.acceptedLead') : t('invite.declinedLead', { who })}</Text>
          {accepted && inv.role === 'owner' && inv.projectId && (
            <Button
              title={t('accept.reviewButton')}
              size="lg"
              block
              onPress={() => router.replace({ pathname: '/project/[id]/accept', params: { id: inv.projectId! } })}
            />
          )}
          <Button
            title={t('wizard.doneButton')}
            variant={accepted && inv.role === 'owner' ? 'secondary' : 'primary'}
            size="lg"
            block
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          />
        </View>
      </SafeAreaView>
    );
  }

  const closed = inv.state !== 'pending';
  const p = inv.project;
  const site = p ? [p.district, p.province && (provinceKeys[p.province] ? t(`province.${provinceKeys[p.province]}`) : p.province)].filter(Boolean).join(', ') : '';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 140 }}>
        <View style={{ gap: spacing.xs }}>
          <Text variant="caption" muted>
            {t('invite.fromCompany', { org: inv.organizationName })}
          </Text>
          <Text variant="screenTitle">{headline}</Text>
        </View>

        {p && (
          <Card flush>
            <Fact label={t('wizard.reviewType')} value={t(`projectType.${p.type}`)} />
            {site ? <Fact label={t('wizard.reviewLocation')} value={site} /> : null}
            <Fact label={t('wizard.reviewValue')} value={p.contractValue != null ? formatRwf(p.contractValue) : t('wizard.notSet')} />
            <Fact label={t('wizard.reviewStages')} value={t('wizard.stagesCount', { count: p.stageCount })} last />
          </Card>
        )}

        {isOwner ? (
          <View style={{ gap: spacing.md }}>
            <PromiseList icon={Eye} tone="see" title={t('invite.youSeeTitle')} items={[t('invite.youSee1'), t('invite.youSee2'), t('invite.youSee3')]} />
            <PromiseList
              icon={CheckCircle2}
              tone="approve"
              title={t('invite.youApproveTitle')}
              items={[t('invite.youApprove1'), t('invite.youApprove2'), t('invite.youApprove3')]}
            />
            <PromiseList
              icon={ShieldCheck}
              tone="keep"
              title={t('invite.controlTitle')}
              items={[t('invite.control1'), t('invite.control2'), t('invite.control3')]}
            />
          </View>
        ) : (
          <Card>
            <Text>
              {inv.scope === 'organization'
                ? t('invite.orgLead')
                : `${t('invite.roleLead', { role })} ${inv.financialVisibility ? t('invite.roleMoney') : t('invite.roleNoMoney')}`}
            </Text>
          </Card>
        )}

        <Text variant="caption" muted>
          {closed ? stateText(inv, t) : t('invite.expiresOn', { date: formatDate(locale, inv.expiresAt) })}
        </Text>
        {error && (
          <Text variant="caption" color={status('problem').color} alert>
            {error}
          </Text>
        )}
      </ScrollView>

      {!closed && (
        <BottomAction>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button
              title={busy === 'decline' ? t('invite.declining') : t('invite.decline')}
              variant="secondary"
              size="lg"
              loading={busy === 'decline'}
              disabled={!!busy}
              onPress={() => void act('decline')}
            />
            <View style={{ flex: 1 }}>
              <Button
                title={busy === 'accept' ? t('invite.accepting') : t('invite.accept')}
                size="lg"
                block
                loading={busy === 'accept'}
                disabled={!!busy}
                onPress={() => void act('accept')}
              />
            </View>
          </View>
        </BottomAction>
      )}
    </SafeAreaView>
  );
}

function stateText(inv: InvitationView, t: ReturnType<typeof useI18n>['t']) {
  switch (inv.state) {
    case 'expired':
      return t('invite.stateExpired');
    case 'accepted':
      return t('invite.stateAccepted');
    case 'declined':
      return t('invite.stateDeclined');
    case 'revoked':
      return t('invite.stateRevoked');
    default:
      return '';
  }
}

function Fact({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const { colors } = useJengaTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: spacing.md,
        minHeight: 48,
        alignItems: 'center',
        paddingHorizontal: spacing.lg,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <Text muted>{label}</Text>
      <Text variant="bodyStrong" style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

/** Loads one invitation (by id or link token) and shows it; errors explain who can open it. */
export function InvitationLoader({ fetch, deps }: { fetch: () => Promise<InvitationView>; deps: unknown[] }) {
  const { t } = useI18n();
  const { colors } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [invitation, setInvitation] = useState<InvitationView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    withRefresh(fetch)
      .then((i) => live && setInvitation(i))
      .catch((err: unknown) => {
        if (!live) return;
        if (err instanceof ApiError && err.status === 404) setError(t('invite.notFound'));
        // 403 names the masked phone or email it was sent to, so the user knows which account to use.
        else setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  if (error) return <StateView kind="error" title={t('invite.receivedTitle')} message={error} />;
  if (!invitation)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  return <InvitationDetails invitation={invitation} onChange={setInvitation} />;
}

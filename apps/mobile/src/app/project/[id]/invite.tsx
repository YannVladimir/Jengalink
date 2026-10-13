import type { CreatedInvitation, InvitationView, OtpChannel, ProjectSummary } from '@jengalink/contracts';
import { request } from '@jengalink/contracts/client';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { radius, spacing } from '@jengalink/ui';
import { Button, Card, Text, useJengaTheme } from '@jengalink/ui/native';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Clock, Mail, Share2, Smartphone, UserRoundCheck } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OwnerExplainer } from '@/components/invitation';
import { BottomAction } from '@/components/ui';
import { ApiError, api, useAuth } from '@/lib/auth';

const INVITATION_DAYS = 7;
const newKey = () => `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Contractor invites the client as owner (Phase 3). The screen first says in
 * plain words what the owner will see and approve, then sends the invitation.
 */
export default function InviteOwnerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh, user } = useAuth();

  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [pending, setPending] = useState<InvitationView | null>(null);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [channel, setChannel] = useState<OtpChannel>('sms');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<CreatedInvitation | null>(null);
  const key = useRef(newKey());

  const fetchAll = useCallback(async () => {
    const [p, invitations] = await Promise.all([
      withRefresh(() => request(() => api.GET('/v1/projects/{id}', { params: { path: { id } } }))),
      withRefresh(() => request(() => api.GET('/v1/projects/{id}/invitations', { params: { path: { id } } }))),
    ]);
    const members = p.hasOwner
      ? await withRefresh(() => request(() => api.GET('/v1/projects/{id}/members', { params: { path: { id } } })))
      : [];
    return {
      project: p,
      pending: invitations.find((i) => i.role === 'owner' && i.state === 'pending') ?? null,
      ownerName: members.find((m) => m.role === 'owner')?.displayName ?? null,
    };
  }, [id, withRefresh]);

  const apply = useCallback((r: Awaited<ReturnType<typeof fetchAll>>) => {
    setProject(r.project);
    setPending(r.pending);
    setOwnerName(r.ownerName);
  }, []);
  const load = () =>
    fetchAll()
      .then(apply)
      .catch(() => setLoadError(true));

  useEffect(() => {
    let live = true;
    fetchAll()
      .then((r) => live && apply(r))
      .catch(() => live && setLoadError(true));
    return () => {
      live = false;
    };
  }, [fetchAll, apply]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await withRefresh(() =>
        request(() =>
          api.POST('/v1/projects/{id}/invitations', {
            params: { path: { id }, header: { 'Idempotency-Key': key.current } },
            body: { channel, recipient: value.trim(), role: 'owner' },
          }),
        ),
      );
      setSent(created);
      key.current = newKey();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (inv: InvitationView) => {
    setBusy(true);
    try {
      await withRefresh(() => request(() => api.DELETE('/v1/invitations/{id}', { params: { path: { id: inv.id } } })));
      setPending(null);
      setShowForm(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  const share = (inv: CreatedInvitation) =>
    void Share.share({
      message: t('invite.shareMessage', { who: user?.displayName ?? t('invite.someone'), project: inv.projectName ?? '', link: inv.link }),
    });

  if (loadError)
    return (
      <Centered>
        <Text muted>{t('common.somethingWrong')}</Text>
        <Button
          title={t('common.tryAgain')}
          variant="secondary"
          onPress={() => {
            setLoadError(false);
            void load();
          }}
        />
      </Centered>
    );
  if (!project)
    return (
      <Centered>
        <ActivityIndicator color={colors.primary} />
      </Centered>
    );

  if (sent)
    return (
      <Outcome
        icon={<Check size={32} color={status('paid').color} />}
        soft={status('paid').soft}
        title={t('invite.sentTitle')}
        lead={t('invite.sentLead', { to: sent.sentTo, days: INVITATION_DAYS })}
      >
        <Button title={t('invite.share')} icon={Share2} variant="secondary" size="lg" block onPress={() => share(sent)} />
        <Button title={t('wizard.doneButton')} size="lg" block onPress={() => router.back()} />
      </Outcome>
    );

  if (project.hasOwner)
    return (
      <Outcome
        icon={<UserRoundCheck size={32} color={status('paid').color} />}
        soft={status('paid').soft}
        title={t('invite.joinedTitle')}
        lead={t('invite.joinedLead', { name: ownerName ?? t('invite.someone') })}
      >
        <Button title={t('wizard.doneButton')} size="lg" block onPress={() => router.back()} />
      </Outcome>
    );

  const formVisible = !pending || showForm;
  const canSend = value.trim().length >= (channel === 'sms' ? 9 : 5);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: spacing.xs }}>
          <Text variant="screenTitle">{t('invite.title')}</Text>
          <Text muted>{t('invite.lead', { project: project.name })}</Text>
        </View>

        {pending && (
          <Card>
            <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
              <Clock size={20} color={status('waiting').color} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{t('invite.pendingTitle')}</Text>
                <Text variant="caption" muted>
                  {t('invite.pendingLead', { to: pending.sentTo, date: formatDate(locale, pending.expiresAt) })}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button title={t('invite.withdraw')} variant="ghost" disabled={busy} onPress={() => void withdraw(pending)} />
              {!showForm && <Button title={t('invite.sendOther')} variant="secondary" onPress={() => setShowForm(true)} />}
            </View>
          </Card>
        )}

        <OwnerExplainer />

        {formVisible && (
          <View style={{ gap: spacing.sm }}>
            <Text variant="sectionTitle">{t('invite.contactTitle')}</Text>
            <View
              accessibilityRole="radiogroup"
              style={{ flexDirection: 'row', padding: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken }}
            >
              {(
                [
                  { key: 'sms', label: t('invite.byPhone'), icon: Smartphone },
                  { key: 'email', label: t('invite.byEmail'), icon: Mail },
                ] as const
              ).map(({ key: k, label, icon: Icon }) => {
                const on = channel === k;
                return (
                  <Pressable
                    key={k}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    onPress={() => {
                      setChannel(k);
                      setValue('');
                      setError(null);
                    }}
                    style={{
                      flex: 1,
                      minHeight: 44,
                      borderRadius: radius.pill,
                      backgroundColor: on ? colors.surface : 'transparent',
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <Icon size={18} color={on ? colors.ink : colors.inkMuted} />
                    <Text variant="label" color={on ? colors.ink : colors.inkMuted}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text variant="label">{channel === 'sms' ? t('invite.phoneLabel') : t('invite.emailLabel')}</Text>
            <TextInput
              accessibilityLabel={channel === 'sms' ? t('invite.phoneLabel') : t('invite.emailLabel')}
              value={value}
              onChangeText={setValue}
              placeholder={channel === 'sms' ? t('invite.phonePlaceholder') : t('invite.emailPlaceholder')}
              placeholderTextColor={colors.inkSubtle}
              keyboardType={channel === 'sms' ? 'phone-pad' : 'email-address'}
              autoComplete={channel === 'sms' ? 'tel' : 'email'}
              autoCapitalize="none"
              style={{
                height: 52,
                paddingHorizontal: spacing.lg,
                borderRadius: radius.md,
                borderWidth: 1.5,
                borderColor: error ? status('problem').color : colors.borderStrong,
                backgroundColor: colors.surface,
                color: colors.ink,
                fontSize: 17,
                fontFamily: 'Inter_500Medium',
              }}
            />
            {error && (
              <Text variant="caption" color={status('problem').color}>
                {error}
              </Text>
            )}
          </View>
        )}
      </ScrollView>

      <BottomAction>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button title={t('invite.later')} variant="secondary" size="lg" onPress={() => router.back()} />
          {formVisible && (
            <View style={{ flex: 1 }}>
              <Button
                title={busy ? t('invite.sending') : t('invite.send')}
                size="lg"
                block
                loading={busy}
                disabled={!canSend}
                onPress={() => void send()}
              />
            </View>
          )}
        </View>
      </BottomAction>
    </SafeAreaView>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  const { colors } = useJengaTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.background }}>
      {children}
    </View>
  );
}

function Outcome({
  icon,
  soft,
  title,
  lead,
  children,
}: {
  icon: React.ReactNode;
  soft: string;
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  const { colors } = useJengaTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1, padding: spacing.xl, gap: spacing.lg, justifyContent: 'center' }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: soft }}>
          {icon}
        </View>
        <Text variant="screenTitle">{title}</Text>
        <Text muted>{lead}</Text>
        {children}
      </View>
    </SafeAreaView>
  );
}

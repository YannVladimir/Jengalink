import type { InvitationView, ProjectSummary, Role } from '@jengalink/contracts';
import { request } from '@jengalink/contracts/client';
import { isReviewed, languageNames, locales, type MessageKey } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatPhone, radius, spacing } from '@jengalink/ui';
import { Card, Text, useJengaTheme } from '@jengalink/ui/native';
import { router, useFocusEffect } from 'expo-router';
import {
  BadgeCheck,
  Banknote,
  Bell,
  Camera,
  Check,
  Download,
  FileSignature,
  FileText,
  FolderPlus,
  HandCoins,
  Languages,
  LifeBuoy,
  ListChecks,
  LogOut,
  Mail,
  Newspaper,
  Palette,
  ScrollText,
  UserPlus,
  UserRound,
  Wallet,
} from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ListRow, ProjectHeader, Screen, SectionHeader } from '@/components/ui';
import { api, useAuth } from '@/lib/auth';
import { useOutbox } from '@/lib/outbox';
import { project } from '@/lib/demo';
import { useLocale } from '@/lib/locale';
import { useRole } from '@/lib/role';

const roleKey: Record<Role, MessageKey> = {
  owner: 'more.roleOwner',
  contractor: 'more.roleContractor',
  supervisor: 'more.roleSupervisor',
};

export default function MoreScreen() {
  const { role, setRole } = useRole();
  const { colors } = useJengaTheme();
  const { user, signOut, withRefresh } = useAuth();
  const { t } = useI18n();
  const [invitations, setInvitations] = useState<InvitationView[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [unread, setUnread] = useState(0);
  const { summary } = useOutbox();
  const unsent = summary.waiting + summary.failed + summary.drafts;
  const [confirmOut, setConfirmOut] = useState(false);

  // Real invitations and projects (the rest of this screen is demo data for now).
  useFocusEffect(
    useCallback(() => {
      void withRefresh(() => request(() => api.GET('/v1/invitations')))
        .then(setInvitations)
        .catch(() => setInvitations([]));
      void withRefresh(() => request(() => api.GET('/v1/notifications')))
        .then((l) => setUnread(l.unread))
        .catch(() => setUnread(0));
      void withRefresh(() => request(() => api.GET('/v1/projects')))
        .then(setProjects)
        .catch(() => setProjects([]));
    }, [withRefresh]),
  );

  return (
    <Screen>
      <ProjectHeader title={t('more.title')} />

      <SectionHeader title={t('more.you')} />
      <Card flush>
        <ListRow icon={UserRound} title={user?.displayName ?? t('more.signedIn')} subtitle={user?.verifiedPhone ? formatPhone(user.verifiedPhone) : (user?.verifiedEmail ?? undefined)} />
        <ListRow
          icon={LogOut}
          title={confirmOut ? t('sync.signOutAnyway') : t('common.signOut')}
          subtitle={confirmOut ? t('sync.signOutPending', { count: unsent }) : t('more.signOutHint')}
          onPress={() => {
            // Unsent updates live only on this phone: warn once before signing out deletes them.
            if (unsent > 0 && !confirmOut) setConfirmOut(true);
            else void signOut();
          }}
          last
        />
      </Card>

      <Card flush>
        <ListRow icon={Bell} title={t('notify.screenTitle')} subtitle={unread > 0 ? t('notify.unread', { count: unread }) : undefined} onPress={() => router.push('/notifications')} last />
      </Card>

      {invitations.length > 0 && (
        <Card flush>
          <ListRow icon={Mail} title={t('invite.listTitle')} subtitle={t('invite.listRow', { count: invitations.length })} onPress={() => router.push('/invitations')} last />
        </Card>
      )}

      <LanguagePicker />

      <SectionHeader title={t('more.team')} />
      <Card flush>
        {project.team.map((m, i) => (
          <ListRow key={m.name} icon={UserRound} title={m.name} subtitle={m.detail} last={i === project.team.length - 1} />
        ))}
      </Card>

      {projects.length > 0 && (
        <>
          <SectionHeader title={t('plan.projectsTitle')} action={t('dash.allProjects', { count: projects.length })} onAction={() => router.push('/projects')} />
          <Card flush>
            {projects.flatMap((p) => [
              ...(p.status === 'active' && p.myRoles.some((r) => r === 'contractor' || r === 'supervisor' || r === 'manager')
                ? [<ListRow key={`${p.id}-update`} icon={Camera} title={t('nav.newUpdate')} subtitle={p.name} onPress={() => router.push({ pathname: '/update/new', params: { projectId: p.id } })} />]
                : []),
              ...(p.status === 'draft' && p.myRoles.includes('owner')
                ? [
                    <ListRow
                      key={`${p.id}-accept`}
                      icon={BadgeCheck}
                      title={t('accept.reviewRow')}
                      subtitle={t('accept.reviewRowHint', { name: p.name })}
                      onPress={() => router.push({ pathname: '/project/[id]/accept', params: { id: p.id } })}
                    />,
                  ]
                : []),
              ...(p.seesMoney
                ? [
                    <ListRow
                      key={`${p.id}-quotes`}
                      icon={FileText}
                      title={t('quote.title')}
                      subtitle={p.name}
                      onPress={() => router.push({ pathname: '/project/[id]/quotes', params: { id: p.id } })}
                    />,
                  ]
                : []),
              ...(p.status === 'active' && p.seesMoney
                ? [
                    <ListRow
                      key={`${p.id}-claims`}
                      icon={HandCoins}
                      title={t('claims.title')}
                      subtitle={p.name}
                      onPress={() => router.push({ pathname: '/project/[id]/claims', params: { id: p.id } })}
                    />,
                    <ListRow
                      key={`${p.id}-spending`}
                      icon={Wallet}
                      title={t('spending.title')}
                      subtitle={p.name}
                      onPress={() => router.push({ pathname: '/project/[id]/spending', params: { id: p.id } })}
                    />,
                    <ListRow
                      key={`${p.id}-payments`}
                      icon={Banknote}
                      title={t('payments.title')}
                      subtitle={p.name}
                      onPress={() => router.push({ pathname: '/project/[id]/payments', params: { id: p.id } })}
                    />,
                  ]
                : []),
              // Weekly reports are for every member (money is left out for those who may not see it).
              ...(p.status === 'active'
                ? [
                    <ListRow
                      key={`${p.id}-reports`}
                      icon={Newspaper}
                      title={t('report.list')}
                      subtitle={p.name}
                      onPress={() => router.push({ pathname: '/project/[id]/reports', params: { id: p.id } })}
                    />,
                  ]
                : []),
              <ListRow key={`${p.id}-exports`} icon={Download} title={t('exports.title')} subtitle={p.name} onPress={() => router.push({ pathname: '/project/[id]/exports', params: { id: p.id } })} />,
              <ListRow
                key={`${p.id}-plan`}
                icon={ListChecks}
                title={t('plan.planStages')}
                subtitle={t('plan.rowHint', { name: p.name })}
                onPress={() => router.push({ pathname: '/project/[id]/plan', params: { id: p.id } })}
              />,
              ...(!p.hasOwner && p.myRoles.some((r) => r === 'contractor' || r === 'manager')
                ? [
                    <ListRow
                      key={`${p.id}-invite`}
                      icon={UserPlus}
                      title={t('invite.inviteOwner')}
                      subtitle={`${p.name} · ${t('invite.noOwnerYet')}`}
                      onPress={() => router.push({ pathname: '/project/[id]/invite', params: { id: p.id } })}
                    />,
                  ]
                : []),
            ])}
          </Card>
        </>
      )}

      <SectionHeader title={t('more.project')} />
      <Card flush>
        <ListRow icon={FolderPlus} title={t('wizard.startProject')} subtitle={t('wizard.startProjectHint')} onPress={() => router.push('/project/new')} />

        <ListRow icon={ScrollText} title={t('more.weeklyReports')} subtitle={t('more.weeklyReportsHint')} onPress={() => {}} />
        <ListRow icon={FileSignature} title={t('more.agreement')} subtitle={t('more.agreementHint')} onPress={() => {}} />
        <ListRow icon={FileText} title={t('more.documents')} subtitle={t('more.documentsHint')} onPress={() => {}} last />
      </Card>

      <SectionHeader title={t('more.settings')} />
      <Card flush>
        <ListRow icon={LifeBuoy} title={t('more.help')} subtitle={t('more.helpHint')} onPress={() => {}} />
        <ListRow icon={Palette} title={t('nav.designSystem')} subtitle={t('more.designHint')} onPress={() => router.push('/design')} last />
      </Card>

      <Card>
        <Text variant="label" muted>
          {t('more.viewingAs')}
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' }}>
          {(Object.keys(roleKey) as Role[]).map((r) => {
            const on = r === role;
            return (
              <Pressable
                key={r}
                onPress={() => setRole(r)}
                accessibilityRole="radio"
                aria-checked={on}
                style={{
                  minHeight: 44,
                  paddingHorizontal: 14,
                  justifyContent: 'center',
                  borderRadius: radius.pill,
                  borderWidth: 1.5,
                  borderColor: on ? colors.primary : colors.borderStrong,
                  backgroundColor: on ? colors.primarySoft : colors.surface,
                }}
              >
                <Text variant="label" color={on ? colors.primary : colors.ink}>
                  {t(roleKey[r])}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text variant="caption" muted style={{ marginTop: spacing.sm }}>
          {t('more.viewingAsHint')}
        </Text>
      </Card>
    </Screen>
  );
}

/** English, Kinyarwanda, French, Swahili — each written in its own language. */
function LanguagePicker() {
  const { colors } = useJengaTheme();
  const { t } = useI18n();
  const { locale, setLocale } = useLocale();
  return (
    <>
      <SectionHeader title={t('common.language')} />
      <Card flush>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('more.chooseLanguage')}>
          {locales.map((l, i) => {
            const on = l === locale;
            return (
              <Pressable
                key={l}
                onPress={() => void setLocale(l)}
                accessibilityRole="radio"
                aria-checked={on}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  minHeight: 56,
                  paddingHorizontal: spacing.lg,
                  backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                  borderBottomWidth: i === locales.length - 1 ? 0 : 1,
                  borderBottomColor: colors.border,
                })}
              >
                <Languages size={18} color={on ? colors.primary : colors.inkMuted} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong" color={on ? colors.primary : colors.ink}>
                    {languageNames[l]}
                  </Text>
                  {!isReviewed(l) && (
                    <Text variant="caption" muted>
                      {t('more.languageNeedsReview')}
                    </Text>
                  )}
                </View>
                {on && <Check size={20} color={colors.primary} />}
              </Pressable>
            );
          })}
        </View>
      </Card>
    </>
  );
}

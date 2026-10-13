import { type InvitationView, provinceKeys } from '@jengalink/contracts';
import { formatDate, type MessageKey, type Translate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf } from '@jengalink/ui';
import { Button, StateView, Text } from '@jengalink/ui/web';
import { Check, CheckCircle2, Eye, type LucideIcon, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';

/** One block of the plain-words explanation: an icon, a heading and 2–3 short lines. */
export function PromiseList({ icon: Icon, title, items, tone }: { icon: LucideIcon; title: string; items: string[]; tone: 'see' | 'approve' | 'keep' }) {
  return (
    <section className={`iv-promise iv-promise--${tone}`}>
      <h3>
        <span className="iv-promise__icon" aria-hidden>
          <Icon size={18} />
        </span>
        {title}
      </h3>
      <ul>
        {items.map((item) => (
          <li key={item}>
            <Check size={16} aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What an owner sees, approves and keeps, from the contractor's side (before sending). */
export function OwnerExplainer() {
  const { t } = useI18n();
  return (
    <div className="iv-promises">
      <PromiseList icon={Eye} tone="see" title={t('invite.seeTitle')} items={[t('invite.see1'), t('invite.see2'), t('invite.see3')]} />
      <PromiseList icon={CheckCircle2} tone="approve" title={t('invite.approveTitle')} items={[t('invite.approve1'), t('invite.approve2'), t('invite.approve3')]} />
      <PromiseList icon={ShieldCheck} tone="keep" title={t('invite.keepTitle')} items={[t('invite.keep1'), t('invite.keep2')]} />
    </div>
  );
}

function stateText(inv: InvitationView, t: Translate) {
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

/** The invitation as its recipient sees it, with Accept and Decline. */
export function InvitationDetails({ invitation, onChange }: { invitation: InvitationView; onChange: (i: InvitationView) => void }) {
  const { t, locale } = useI18n();
  const { withRefresh } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inv = invitation;
  const who = inv.invitedBy ?? t('invite.someone');
  const role = t(`server.role_${inv.role}` as MessageKey);
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
      onChange(await withRefresh(() => request(() => api.POST(path, { params: { path: { id: inv.id } } }))));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(null);
    }
  };

  if (inv.state === 'accepted' || inv.state === 'declined') {
    const accepted = inv.state === 'accepted';
    return (
      <div className="wz-done">
        <span className={`wz-done__icon${accepted ? '' : ' iv-done--neutral'}`} aria-hidden>
          {accepted ? <Check size={32} /> : <X size={32} />}
        </span>
        <Text variant="screenTitle" as="h1">
          {accepted ? t('invite.acceptedTitle', { project: inv.projectName ?? inv.organizationName }) : t('invite.declinedTitle')}
        </Text>
        <Text muted>{accepted ? t('invite.acceptedLead') : t('invite.declinedLead', { who })}</Text>
        <div className="iv-share">
          {accepted && inv.role === 'owner' && inv.projectId && (
            <Button size="lg" onClick={() => navigate(`/projects/${inv.projectId}/accept`)}>
              {t('accept.reviewButton')}
            </Button>
          )}
          <Button size="lg" variant={accepted && inv.role === 'owner' ? 'secondary' : 'primary'} onClick={() => navigate('/')}>
            {t('wizard.doneButton')}
          </Button>
        </div>
      </div>
    );
  }

  const closed = inv.state !== 'pending';
  const p = inv.project;
  const province = p?.province ? (provinceKeys[p.province] ? t(`province.${provinceKeys[p.province]}`) : p.province) : null;
  const site = p ? [p.district, province].filter(Boolean).join(', ') : '';

  return (
    <article className="iv">
      <header className="iv-head">
        <p className="ws-head__sub">{t('invite.fromCompany', { org: inv.organizationName })}</p>
        <Text variant="screenTitle" as="h1">
          {headline}
        </Text>
      </header>

      {p && (
        <dl className="iv-facts">
          <div>
            <dt>{t('wizard.reviewType')}</dt>
            <dd>{t(`projectType.${p.type}`)}</dd>
          </div>
          {site && (
            <div>
              <dt>{t('wizard.reviewLocation')}</dt>
              <dd>{site}</dd>
            </div>
          )}
          <div>
            <dt>{t('wizard.reviewValue')}</dt>
            <dd>{p.contractValue != null ? formatRwf(p.contractValue) : t('wizard.notSet')}</dd>
          </div>
          <div>
            <dt>{t('wizard.reviewStages')}</dt>
            <dd>{t('wizard.stagesCount', { count: p.stageCount })}</dd>
          </div>
        </dl>
      )}

      {isOwner ? (
        <div className="iv-promises">
          <PromiseList icon={Eye} tone="see" title={t('invite.youSeeTitle')} items={[t('invite.youSee1'), t('invite.youSee2'), t('invite.youSee3')]} />
          <PromiseList
            icon={CheckCircle2}
            tone="approve"
            title={t('invite.youApproveTitle')}
            items={[t('invite.youApprove1'), t('invite.youApprove2'), t('invite.youApprove3')]}
          />
          <PromiseList icon={ShieldCheck} tone="keep" title={t('invite.controlTitle')} items={[t('invite.control1'), t('invite.control2'), t('invite.control3')]} />
        </div>
      ) : (
        <p className="jl-card iv-role">
          {inv.scope === 'organization'
            ? t('invite.orgLead')
            : `${t('invite.roleLead', { role })} ${inv.financialVisibility ? t('invite.roleMoney') : t('invite.roleNoMoney')}`}
        </p>
      )}

      <p className="jl-field__hint">{closed ? stateText(inv, t) : t('invite.expiresOn', { date: formatDate(locale, inv.expiresAt) })}</p>
      {error && (
        <p className="jl-field__error" role="alert">
          {error}
        </p>
      )}

      {!closed && (
        <div className="wz-actions iv-actions">
          <Button variant="secondary" size="lg" loading={busy === 'decline'} disabled={!!busy} onClick={() => void act('decline')}>
            {busy === 'decline' ? t('invite.declining') : t('invite.decline')}
          </Button>
          <Button size="lg" loading={busy === 'accept'} disabled={!!busy} onClick={() => void act('accept')}>
            {busy === 'accept' ? t('invite.accepting') : t('invite.accept')}
          </Button>
        </div>
      )}
    </article>
  );
}

/** Loads one invitation (by id or link token) and shows it; errors explain who can open it. */
export function InvitationLoader({ by }: { by: { id: string } | { token: string } }) {
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const [invitation, setInvitation] = useState<InvitationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keyValue = 'id' in by ? by.id : by.token;

  useEffect(() => {
    let live = true;
    setError(null);
    setInvitation(null);
    const fetch = () =>
      'id' in by
        ? request(() => api.GET('/v1/invitations/{id}', { params: { path: { id: by.id } } }))
        : request(() => api.GET('/v1/invitations/token/{token}', { params: { path: { token: by.token } } }));
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
  }, [keyValue, withRefresh, t]);

  if (error) return <StateView kind="error" title={t('invite.receivedTitle')} message={error} />;
  if (!invitation) return null;
  return <InvitationDetails invitation={invitation} onChange={setInvitation} />;
}

import type { CreatedInvitation, InvitationView, OtpChannel, ProjectSummary } from '@jengalink/contracts';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { Button, StateView, Text } from '@jengalink/ui/web';
import { Check, Clock, Copy, Mail, Share2, Smartphone, UserRoundCheck } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { OwnerExplainer } from '../components/Invitation';
import { ApiError, api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';

const INVITATION_DAYS = 7;
const newKey = () => `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Contractor invites the client as owner (Phase 3). The page first says in
 * plain words what the owner will see and approve, then sends the invitation.
 */
export default function InviteOwnerPage() {
  const { id = '' } = useParams();
  const { t, locale } = useI18n();
  const { withRefresh, user } = useAuth();
  const navigate = useNavigate();
  const inputId = useId();

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
  const [copied, setCopied] = useState(false);
  const key = useRef(newKey());

  const load = useCallback(async () => {
    try {
      const [p, invitations] = await Promise.all([
        withRefresh(() => request(() => api.GET('/v1/projects/{id}', { params: { path: { id } } }))),
        withRefresh(() => request(() => api.GET('/v1/projects/{id}/invitations', { params: { path: { id } } }))),
      ]);
      setProject(p);
      setPending(invitations.find((i) => i.role === 'owner' && i.state === 'pending') ?? null);
      if (p.hasOwner) {
        const members = await withRefresh(() => request(() => api.GET('/v1/projects/{id}/members', { params: { path: { id } } })));
        setOwnerName(members.find((m) => m.role === 'owner')?.displayName ?? null);
      }
    } catch {
      setLoadError(true);
    }
  }, [id, withRefresh]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
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

  if (loadError)
    return (
      <div className="ws-page">
        <StateView
          kind="error"
          title={t('common.somethingWrong')}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setLoadError(false);
                void load();
              }}
            >
              {t('common.tryAgain')}
            </Button>
          }
        />
      </div>
    );
  if (!project) return null;

  if (sent) {
    const message = t('invite.shareMessage', { who: user?.displayName ?? t('invite.someone'), project: sent.projectName ?? '', link: sent.link });
    return (
      <div className="ws-page wz">
        <div className="wz-done">
          <span className="wz-done__icon" aria-hidden>
            <Check size={32} />
          </span>
          <Text variant="screenTitle" as="h1">
            {t('invite.sentTitle')}
          </Text>
          <Text muted>{t('invite.sentLead', { to: sent.sentTo, days: INVITATION_DAYS })}</Text>
          <div className="iv-share">
            {'share' in navigator && (
              <Button variant="secondary" icon={Share2} onClick={() => void navigator.share({ text: message }).catch(() => {})}>
                {t('invite.share')}
              </Button>
            )}
            <Button
              variant="secondary"
              icon={copied ? Check : Copy}
              onClick={() =>
                void navigator.clipboard
                  .writeText(message)
                  .then(() => setCopied(true))
                  .catch(() => {})
              }
            >
              {copied ? t('invite.copied') : t('invite.copy')}
            </Button>
          </div>
          <Button size="lg" onClick={() => navigate('/')}>
            {t('wizard.doneButton')}
          </Button>
        </div>
      </div>
    );
  }

  if (project.hasOwner)
    return (
      <div className="ws-page wz">
        <div className="wz-done">
          <span className="wz-done__icon" aria-hidden>
            <UserRoundCheck size={32} />
          </span>
          <Text variant="screenTitle" as="h1">
            {t('invite.joinedTitle')}
          </Text>
          <Text muted>{t('invite.joinedLead', { name: ownerName ?? t('invite.someone') })}</Text>
          <Button size="lg" onClick={() => navigate('/')}>
            {t('wizard.doneButton')}
          </Button>
        </div>
      </div>
    );

  const formVisible = !pending || showForm;
  const canSend = value.trim().length >= (channel === 'sms' ? 9 : 5);

  return (
    <div className="ws-page wz">
      <header className="ws-head">
        <Text variant="screenTitle" as="h1">
          {t('invite.title')}
        </Text>
        <p className="ws-head__sub">{t('invite.lead', { project: project.name })}</p>
      </header>

      <div className="wz-card iv-send jl-card">
        {pending && (
          <div className="iv-pending" role="status">
            <Clock size={20} aria-hidden />
            <div>
              <strong>{t('invite.pendingTitle')}</strong>
              <p>{t('invite.pendingLead', { to: pending.sentTo, date: formatDate(locale, pending.expiresAt) })}</p>
            </div>
            <div className="iv-pending__actions">
              <Button variant="ghost" disabled={busy} onClick={() => void withdraw(pending)}>
                {t('invite.withdraw')}
              </Button>
              {!showForm && (
                <Button variant="secondary" onClick={() => setShowForm(true)}>
                  {t('invite.sendOther')}
                </Button>
              )}
            </div>
          </div>
        )}

        <OwnerExplainer />

        {formVisible && (
          <form className="wz-section" onSubmit={(e) => void send(e)}>
            <Text variant="sectionTitle" as="h2">
              {t('invite.contactTitle')}
            </Text>
            <div className="si-tabs" role="radiogroup" aria-label={t('invite.contactTitle')}>
              {(
                [
                  { key: 'sms', label: t('invite.byPhone'), icon: Smartphone },
                  { key: 'email', label: t('invite.byEmail'), icon: Mail },
                ] as const
              ).map(({ key: k, label, icon: Icon }) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={channel === k}
                  className={channel === k ? 'is-on' : undefined}
                  onClick={() => {
                    setChannel(k);
                    setValue('');
                    setError(null);
                  }}
                >
                  <Icon size={18} aria-hidden /> {label}
                </button>
              ))}
            </div>
            <div className="jl-field">
              <label className="jl-field__label" htmlFor={inputId}>
                {channel === 'sms' ? t('invite.phoneLabel') : t('invite.emailLabel')}
              </label>
              <span className={`si-input${error ? ' si-input--error' : ''}`}>
                <input
                  id={inputId}
                  type={channel === 'sms' ? 'tel' : 'email'}
                  autoComplete={channel === 'sms' ? 'tel' : 'email'}
                  value={value}
                  maxLength={254}
                  placeholder={channel === 'sms' ? t('invite.phonePlaceholder') : t('invite.emailPlaceholder')}
                  onChange={(e) => setValue(e.target.value)}
                />
              </span>
              {error && (
                <span className="jl-field__error" role="alert">
                  {error}
                </span>
              )}
            </div>
            <div className="wz-actions">
              <Button variant="secondary" size="lg" onClick={() => navigate('/')}>
                {t('invite.later')}
              </Button>
              <Button type="submit" size="lg" loading={busy} disabled={!canSend}>
                {busy ? t('invite.sending') : t('invite.send')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

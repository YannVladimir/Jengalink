import { DEMO_CODE, DEMO_PEOPLE, type DemoPerson, type OtpChannel, type StartOtpResponse } from '@jengalink/contracts';
import { Button } from '@jengalink/ui/web';
import { ArrowRight, Mail, Smartphone } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useI18n } from '@jengalink/i18n/react';
import { LanguageSelect } from '../components/LanguageSelect';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { useDemo } from '../lib/environment';

type Step = { kind: 'contact' } | { kind: 'code'; challenge: StartOtpResponse; destination: string } | { kind: 'name' };

/** Sign in without a password: phone (default) or email, then a 6-digit code. */
export default function SignIn() {
  const { status, user, startOtp, verifyOtp, updateMe } = useAuth();
  const { t, locale } = useI18n();
  const demo = useDemo();
  const [channel, setChannel] = useState<OtpChannel>('sms');
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'contact' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const codeRef = useRef<HTMLInputElement>(null);
  const from = (useLocation().state as { from?: unknown } | null)?.from;
  // Only same-app paths, never another site.
  const returnTo = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/';

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (status === 'signedIn' && user?.displayName) return <Navigate to={returnTo} replace />;
  const current: Step = status === 'signedIn' ? { kind: 'name' } : step;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = (e?: FormEvent) => {
    e?.preventDefault();
    void run(async () => {
      const destination = channel === 'sms' ? `+250${contact.replace(/\D/g, '').replace(/^0/, '')}` : contact;
      const challenge = await startOtp(channel, destination, locale);
      setCode('');
      setStep({ kind: 'code', challenge, destination });
      setTimeout(() => codeRef.current?.focus(), 0);
    });
  };

  /** Demo environment: one tap signs in as a demo person (fixed code, nothing is sent). */
  const signInAs = (person: DemoPerson) =>
    void run(async () => {
      const challenge = await startOtp('sms', `+250${person.phone.slice(1)}`, locale);
      await verifyOtp(challenge.challengeId, DEMO_CODE, locale);
    });

  const submitCode = (value: string) => {
    if (current.kind !== 'code') return;
    void run(async () => {
      try {
        await verifyOtp(current.challenge.challengeId, value, locale);
      } catch (err) {
        setCode('');
        codeRef.current?.focus();
        throw err;
      }
    });
  };

  const saveName = (e: FormEvent) => {
    e.preventDefault();
    void run(() => updateMe({ displayName: name.trim() }));
  };

  const waitSeconds = current.kind === 'code' ? Math.max(0, Math.ceil((new Date(current.challenge.resendAfter).getTime() - now) / 1000)) : 0;

  return (
    <div className="si">
      <aside className="si-brand" aria-hidden>
        <div className="si-brand__logo">
          <svg width="32" height="32" viewBox="0 0 32 32">
            <rect x="4" y="21" width="24" height="7" rx="2" fill="currentColor" />
            <rect x="4" y="12.5" width="24" height="7" rx="2" fill="currentColor" opacity=".7" />
            <rect x="9" y="4" width="19" height="7" rx="2" fill="var(--jl-accent)" />
          </svg>
          JengaLink
        </div>
        <p className="si-brand__line">{t('auth.brandLine')}</p>
        <svg className="si-brand__tower" viewBox="0 0 260 220">
          {[0, 1, 2, 3].map((r) => (
            <rect key={r} x={r % 2 ? 30 : 10} y={180 - r * 44} width="220" height="36" rx="8" fill="currentColor" opacity=".12" />
          ))}
          <rect x="60" y="4" width="180" height="36" rx="8" fill="var(--jl-primary)" />
        </svg>
      </aside>

      <main className="si-main">
        <LanguageSelect className="lang-select lang-select--top" />
        <div className="si-card">
          {current.kind === 'contact' && (
            <form onSubmit={sendCode} noValidate>
              <h1 className="jl-text-screen-title">{t('auth.signIn')}</h1>
              <p className="jl-muted si-lead">{t('auth.noPassword')}</p>
              <div className="si-tabs" role="radiogroup" aria-label={t('auth.signIn')}>
                {(
                  [
                    { key: 'sms', label: t('auth.phone'), icon: Smartphone },
                    { key: 'email', label: t('auth.email'), icon: Mail },
                  ] as const
                ).map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={channel === key}
                    className={channel === key ? 'is-on' : ''}
                    onClick={() => {
                      setChannel(key);
                      setContact('');
                      setError(null);
                    }}
                  >
                    <Icon size={16} aria-hidden /> {label}
                  </button>
                ))}
              </div>
              <label className="jl-field">
                <span className="jl-field__label">{channel === 'sms' ? t('auth.phoneLabel') : t('auth.emailLabel')}</span>
                <span className={`si-input${error ? ' si-input--error' : ''}`}>
                  {channel === 'sms' && <span className="si-input__prefix">+250</span>}
                  <input
                    autoFocus
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    inputMode={channel === 'sms' ? 'tel' : 'email'}
                    type={channel === 'sms' ? 'tel' : 'email'}
                    autoComplete={channel === 'sms' ? 'tel-national' : 'email'}
                    placeholder={channel === 'sms' ? '78 123 4567' : 'you@example.com'}
                    aria-invalid={!!error || undefined}
                  />
                </span>
                <span className={error ? 'jl-field__error' : 'jl-field__hint'} role={error ? 'alert' : undefined}>
                  {error ?? (channel === 'sms' ? t('auth.phoneHint') : t('auth.emailHint'))}
                </span>
              </label>
              <Button type="submit" size="lg" block icon={ArrowRight} loading={busy} disabled={contact.trim().length < (channel === 'sms' ? 9 : 5)}>
                {t('auth.sendCode')}
              </Button>
            </form>
          )}
          {current.kind === 'contact' && demo && (
            <section className="si-demo" aria-labelledby="si-demo-title">
              <h2 id="si-demo-title">{t('demo.tryTitle')}</h2>
              <p>{t('demo.codeHint', { code: DEMO_CODE })}</p>
              <ul>
                {DEMO_PEOPLE.map((p) => (
                  <li key={p.key}>
                    <button type="button" disabled={busy} onClick={() => signInAs(p)}>
                      {p.name}
                      <span>
                        {t(`server.role_${p.role}`)} · {t(`demo.project_${p.project}`)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {current.kind === 'code' && (
            <form onSubmit={(e) => (e.preventDefault(), submitCode(code))}>
              <h1 className="jl-text-screen-title">{t('auth.enterCode')}</h1>
              <p className="jl-muted si-lead">{t('auth.codeSentTo', { destination: current.challenge.sentTo })}</p>
              <label className="jl-field">
                <span className="jl-field__label">{t('auth.codeLabel')}</span>
                <input
                  ref={codeRef}
                  className={`si-code${error ? ' si-input--error' : ''}`}
                  value={code}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setCode(digits);
                    if (digits.length === 6) submitCode(digits);
                  }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="••••••"
                  aria-invalid={!!error || undefined}
                />
                {error && (
                  <span className="jl-field__error" role="alert">
                    {error}
                  </span>
                )}
              </label>
              <Button type="submit" size="lg" block loading={busy} disabled={code.length !== 6}>
                {t('auth.signIn')}
              </Button>
              <div className="si-row">
                <button type="button" className="si-link" onClick={() => setStep({ kind: 'contact' })}>
                  {channel === 'sms' ? t('auth.changeNumber') : t('auth.changeEmail')}
                </button>
                <button type="button" className="si-link" disabled={waitSeconds > 0} onClick={() => sendCode()}>
                  {waitSeconds > 0 ? t('auth.newCodeIn', { seconds: waitSeconds }) : t('auth.sendNewCode')}
                </button>
              </div>
            </form>
          )}

          {current.kind === 'name' && (
            <form onSubmit={saveName}>
              <h1 className="jl-text-screen-title">{t('auth.nameTitle')}</h1>
              <p className="jl-muted si-lead">{t('auth.nameLead')}</p>
              <label className="jl-field">
                <span className="jl-field__label">{t('auth.nameLabel')}</span>
                <span className="si-input">
                  <input autoFocus value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder={t('auth.namePlaceholder')} />
                </span>
                {error && (
                  <span className="jl-field__error" role="alert">
                    {error}
                  </span>
                )}
              </label>
              <Button type="submit" size="lg" block loading={busy} disabled={name.trim().length < 2}>
                {t('common.continue')}
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

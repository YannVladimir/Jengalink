import { DEFAULT_QUIET_HOURS, type NotificationSettings } from '@jengalink/contracts';
import { useI18n } from '@jengalink/i18n/react';
import { Card } from '@jengalink/ui/web';
import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';

const FROM = ['20:00', '21:00', '22:00', '23:00'];
const UNTIL = ['05:00', '06:00', '07:00', '08:00'];

/** Reminders and quiet hours (spec §9.4). Each change is saved at once. */
export function NotificationSettingsPanel() {
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const [s, setS] = useState<NotificationSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void withRefresh(() => request(() => api.GET('/v1/me/notification-settings')))
      .then(setS)
      .catch(() => undefined);
  }, [withRefresh]);
  if (!s) return null;

  const save = (next: Pick<NotificationSettings, 'remindersEnabled' | 'quietHours'>) => {
    setS({ ...s, ...next });
    setSaved(false);
    void withRefresh(() => request(() => api.PUT('/v1/me/notification-settings', { body: next })))
      .then((v) => {
        setS(v);
        setSaved(true);
      })
      .catch(() => undefined);
  };
  const quiet = s.quietHours;
  const chips = (name: string, values: string[], current: string, pick: (v: string) => void, label: string) => (
    <fieldset className="up-chips">
      <legend className="jl-field__hint">{label}</legend>
      {values.map((v) => (
        <label key={v} className={v === current ? 'is-on' : undefined}>
          <input type="radio" name={name} checked={v === current} onChange={() => pick(v)} />
          {v}
        </label>
      ))}
    </fieldset>
  );

  return (
    <Card title={t('notify.settingsTitle')}>
      <div className="sh-form">
        <label className="sh-check">
          <input type="checkbox" checked={s.remindersEnabled} onChange={(e) => save({ remindersEnabled: e.target.checked, quietHours: quiet })} />
          {t('notify.remindersLabel')}
        </label>
        <label className="sh-check">
          <input type="checkbox" checked={!!quiet} onChange={(e) => save({ remindersEnabled: s.remindersEnabled, quietHours: e.target.checked ? { ...DEFAULT_QUIET_HOURS } : null })} />
          {t('notify.quietLabel')}
        </label>
        {quiet ? (
          <div className="ns-quiet">
            {chips('quiet-from', FROM, quiet.start, (v) => save({ remindersEnabled: s.remindersEnabled, quietHours: { ...quiet, start: v } }), t('notify.quietFrom'))}
            {chips('quiet-to', UNTIL, quiet.end, (v) => save({ remindersEnabled: s.remindersEnabled, quietHours: { ...quiet, end: v } }), t('notify.quietTo'))}
            <p className="jl-field__hint">{t('notify.quietHint', { start: quiet.start, end: quiet.end })}</p>
          </div>
        ) : (
          <p className="jl-field__hint ns-quiet">{t('notify.quietOff')}</p>
        )}
        <p className="jl-field__hint ns-lock">
          <Lock size={14} aria-hidden /> {t('notify.lockScreenNote')}
        </p>
        {saved && (
          <p className="ns-saved" role="status">
            {t('notify.saved')}
          </p>
        )}
      </div>
    </Card>
  );
}

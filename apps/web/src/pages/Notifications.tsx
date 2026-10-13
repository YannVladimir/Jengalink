import { type NotificationKind, type NotificationList, webPathOf } from '@jengalink/contracts';
import { formatDateTime } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { Button, StateView, Text } from '@jengalink/ui/web';
import { AlarmClock, Banknote, CheckCheck, FilePen, HandCoins, type LucideIcon, Newspaper, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { NotificationSettingsPanel } from '../components/NotificationSettings';
import { api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';

const icons: Record<NotificationKind, LucideIcon> = {
  claim_to_decide: HandCoins,
  spending_to_decide: Banknote,
  change_to_decide: FilePen,
  report_published: Newspaper,
  update_problem: TriangleAlert,
  decisions_reminder: AlarmClock,
};

/** In-app notifications (spec §9.4): each opens the exact item and is marked read. */
export default function NotificationsPage() {
  const { t, locale } = useI18n();
  const { withRefresh } = useAuth();
  const [list, setList] = useState<NotificationList | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void withRefresh(() => request(() => api.GET('/v1/notifications')))
      .then(setList)
      .catch(() => setFailed(true));
  }, [withRefresh]);

  if (failed)
    return (
      <div className="ws-page">
        <StateView kind="error" title={t('common.somethingWrong')} />
      </div>
    );
  if (!list) return null;

  return (
    <div className="ws-page">
      <header className="ws-head fd-head">
        <div>
          <Text variant="screenTitle" as="h1">
            {t('notify.screenTitle')}
          </Text>
          {list.unread > 0 && <p className="ws-head__sub">{t('notify.unread', { count: list.unread })}</p>}
        </div>
        {list.unread > 0 && (
          <Button
            variant="secondary"
            icon={CheckCheck}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setList(await withRefresh(() => request(() => api.POST('/v1/notifications/read-all'))));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('notify.markAll')}
          </Button>
        )}
      </header>
      {list.items.length === 0 && <StateView kind="empty" title={t('notify.empty')} />}
      {list.items.length > 0 && (
        <ul className="nt-list jl-card">
          {list.items.map((n) => {
            const Icon = icons[n.kind];
            return (
              <li key={n.id} className={n.readAt ? undefined : 'is-unread'}>
                <Link
                  to={webPathOf(n.path)}
                  onClick={() => {
                    if (!n.readAt) void withRefresh(() => request(() => api.POST('/v1/notifications/{notificationId}/read', { params: { path: { notificationId: n.id } } }))).catch(() => undefined);
                  }}
                >
                  <span className={`nt-icon nt-icon--${n.kind}`}>
                    <Icon size={18} aria-hidden />
                  </span>
                  <span className="nt-text">
                    <strong>{n.title}</strong>
                    <span>{n.body}</span>
                    <small>{formatDateTime(locale, n.createdAt)}</small>
                  </span>
                  {!n.readAt && <span className="nt-dot" aria-label={t('notify.unread', { count: 1 })} />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <NotificationSettingsPanel />
    </div>
  );
}

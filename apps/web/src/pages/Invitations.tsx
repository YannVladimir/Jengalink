import type { InvitationView } from '@jengalink/contracts';
import { formatDate, type MessageKey } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { StateView, Text } from '@jengalink/ui/web';
import { ChevronRight, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { InvitationLoader } from '../components/Invitation';
import { api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';

/** Invitations waiting for the signed-in user; the SMS and email link here. */
export default function InvitationsPage() {
  const { t, locale } = useI18n();
  const { withRefresh } = useAuth();
  const [list, setList] = useState<InvitationView[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void withRefresh(() => request(() => api.GET('/v1/invitations')))
      .then(setList)
      .catch(() => setFailed(true));
  }, [withRefresh]);

  return (
    <div className="ws-page wz">
      <header className="ws-head">
        <Text variant="screenTitle" as="h1">
          {t('invite.listTitle')}
        </Text>
      </header>
      {failed ? (
        <StateView kind="error" title={t('common.somethingWrong')} />
      ) : !list ? null : list.length === 0 ? (
        <Text muted>{t('invite.listEmpty')}</Text>
      ) : (
        <ul className="iv-list jl-card">
          {list.map((inv) => (
            <li key={inv.id}>
              <Link to={`/invitations/${inv.id}`}>
                <span className="iv-list__icon" aria-hidden>
                  <Mail size={18} />
                </span>
                <span className="iv-list__text">
                  <strong>{inv.projectName ?? inv.organizationName}</strong>
                  <small>
                    {t(`server.role_${inv.role}` as MessageKey)} · {inv.invitedBy ?? inv.organizationName} ·{' '}
                    {t('invite.expiresOn', { date: formatDate(locale, inv.expiresAt) })}
                  </small>
                </span>
                <ChevronRight size={18} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One invitation from the list. */
export function InvitationPage() {
  const { id = '' } = useParams();
  return (
    <div className="ws-page wz">
      <InvitationLoader by={{ id }} />
    </div>
  );
}

/** Landing page for the shared link (/invite/<token>), outside the workspace. */
export function InviteLinkPage() {
  const { token = '' } = useParams();
  return (
    <main className="iv-landing">
      <div className="iv-landing__card">
        <InvitationLoader by={{ token }} />
      </div>
    </main>
  );
}

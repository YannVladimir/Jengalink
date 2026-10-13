import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Bell, Camera, ChevronsUpDown, FolderKanban, FolderPlus, LayoutDashboard, LogOut, Mail, Palette, Wallet } from 'lucide-react';
import { formatPhone } from '@jengalink/ui';
import { useI18n } from '@jengalink/i18n/react';
import type { MessageKey } from '@jengalink/i18n';
import { LanguageSelect } from '../components/LanguageSelect';
import { api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { project } from '../lib/demo';

const nav: { to: string; label: MessageKey; icon: typeof Camera; end: boolean }[] = [
  { to: '/', label: 'nav.overview', icon: LayoutDashboard, end: true },
  { to: '/money', label: 'nav.money', icon: Wallet, end: false },
  { to: '/updates', label: 'nav.updates', icon: Camera, end: false },
];

/**
 * Web workspace (spec §4.3): left sidebar, project name and role always visible.
 * Detailed financial tables live here; mobile shows summaries and focused approvals.
 */
export default function Workspace() {
  const { user, signOut, withRefresh } = useAuth();
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [unread, setUnread] = useState(0);
  const [deciding, setDeciding] = useState(0);
  // The unread count follows you around the workspace (refreshed on every page change).
  useEffect(() => {
    void withRefresh(() => request(() => api.GET('/v1/notifications')))
      .then((l) => setUnread(l.unread))
      .catch(() => undefined);
    void withRefresh(() => request(() => api.GET('/v1/decisions')))
      .then((d) => setDeciding(d.count))
      .catch(() => undefined);
  }, [pathname, withRefresh]);
  return (
    <div className="ws">
      <aside className="ws-side">
        <div className="ws-brand">
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
            <rect x="4" y="21" width="24" height="7" rx="2" fill="currentColor" />
            <rect x="4" y="12.5" width="24" height="7" rx="2" fill="currentColor" opacity=".7" />
            <rect x="9" y="4" width="19" height="7" rx="2" fill="var(--jl-accent)" />
          </svg>
          <span>JengaLink</span>
        </div>
        <button className="ws-project" type="button" aria-label={project.name}>
          <span className="ws-project__name">{project.name}</span>
          <span className="ws-project__role">{t('more.roleOwner')} · {project.location.split(' · ')[0]}</span>
          <ChevronsUpDown size={16} className="ws-project__icon" aria-hidden />
        </button>
        <nav className="ws-nav" aria-label="Project">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'is-active' : undefined)}>
              <Icon size={18} aria-hidden />
              {t(label)}
              {label === 'nav.overview' && deciding > 0 && (
                <span className="ws-nav__badge" aria-label={t('home.decisions', { count: deciding })}>
                  {deciding}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="ws-side__foot">
          <NavLink to="/projects" end>
            <FolderKanban size={16} aria-hidden /> {t('plan.projectsTitle')}
          </NavLink>
          <NavLink to="/projects/new">
            <FolderPlus size={16} aria-hidden /> {t('wizard.startProject')}
          </NavLink>
          <NavLink to="/notifications">
            <Bell size={16} aria-hidden /> {t('notify.screenTitle')}
            {unread > 0 && (
              <span className="ws-nav__badge" aria-label={t('notify.unread', { count: unread })}>
                {unread}
              </span>
            )}
          </NavLink>
          <NavLink to="/invitations">
            <Mail size={16} aria-hidden /> {t('invite.listTitle')}
          </NavLink>
          <NavLink to="/design">
            <Palette size={16} aria-hidden /> {t('nav.designSystem')}
          </NavLink>
          <LanguageSelect className="lang-select lang-select--side" />
          <div className="ws-user">
            <span className="ws-user__avatar" aria-hidden>
              {(user?.displayName ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="ws-user__text">
              <strong>{user?.displayName}</strong>
              <span>{user?.verifiedPhone ? formatPhone(user.verifiedPhone) : user?.verifiedEmail}</span>
            </span>
            <button type="button" className="ws-user__out" onClick={() => void signOut()} aria-label={t('common.signOut')} title={t('common.signOut')}>
              <LogOut size={18} aria-hidden />
            </button>
          </div>
        </div>
      </aside>
      <main className="ws-main">
        <Outlet />
      </main>
    </div>
  );
}

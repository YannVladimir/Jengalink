import { actionCount, type MoneyActions, type MoneyAcross, type ProjectMoney } from '@jengalink/contracts';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf } from '@jengalink/ui';
import { Card, ClaimTracker, Money as Amount, MoneyBar, StateView, Text } from '@jengalink/ui/web';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';

const fromIsoDate = (iso: string) => new Date(`${iso}T12:00:00`);

/**
 * Money across projects (spec §4.4 "Money overview", §36.1): what is owed and what waits on you.
 * Contract money only; contractor internal costs never appear here (spec §37.3).
 */
export default function MoneyPage() {
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const [data, setData] = useState<MoneyAcross | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void withRefresh(() => request(() => api.GET('/v1/money')))
      .then(setData)
      .catch(() => setFailed(true));
  }, [withRefresh]);

  if (failed)
    return (
      <div className="ws-page">
        <StateView kind="error" title={t('common.somethingWrong')} />
      </div>
    );
  if (!data) return null;

  return (
    <div className="ws-page">
      <header className="ws-head">
        <Text variant="screenTitle" as="h1">
          {t('money.title')}
        </Text>
        <p className="ws-head__sub">
          {t('money.acrossHint')} {t('money.outsideApp')}
        </p>
      </header>
      <div className="ws-kpis">
        {data.owedToMe > 0 && <Stat label={t('money.owedToYou')} amount={data.owedToMe} tone="approved" />}
        {(data.owedByMe > 0 || data.owedToMe === 0) && <Stat label={t('money.youOweNow')} amount={data.owedByMe} tone="approved" />}
        <Stat label={t('money.waitingForDecision')} amount={data.awaitingDecision} tone="waiting" />
        <Stat label={t('money.pendingVerification')} amount={data.pendingVerification} />
      </div>
      <Card title={t('money.needsYou')}>
        <Actions actions={data.actions} />
      </Card>
      <Card title={t('money.acrossTitle')} flush>
        <div className="ws-table-wrap">
          <table className="ws-table">
            <thead>
              <tr>
                <th scope="col">{t('money.chooseProject')}</th>
                <th scope="col" className="num">
                  {t('money.agreedContract')}
                </th>
                <th scope="col" className="num">
                  {t('money.paid')}
                </th>
                <th scope="col" className="num">
                  {t('money.approvedNotPaid')}
                </th>
                <th scope="col" className="num">
                  {t('money.waitingForDecision')}
                </th>
                <th scope="col">{t('money.needsYou')}</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((p) => (
                <tr key={p.projectId}>
                  <td>
                    <Link to={`/projects/${p.projectId}/money`}>
                      <strong>{p.projectName}</strong>
                    </Link>
                    <small className="muted"> · {p.organizationName}</small>
                  </td>
                  <td className="num">{formatRwf(p.figures.contract)}</td>
                  <td className="num">{formatRwf(p.figures.paid)}</td>
                  <td className="num">{formatRwf(p.figures.approvedUnpaid)}</td>
                  <td className="num">{formatRwf(p.figures.awaitingDecision)}</td>
                  <td>{actionCount(p.actions) > 0 ? <span className="qt-status mn-badge">{actionCount(p.actions)}</span> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/** One project's Money screen: the contract bar, what waits on you, claims with their steps, payments. */
export function ProjectMoneyPage() {
  const { id = '' } = useParams();
  const { t, locale } = useI18n();
  const { withRefresh } = useAuth();
  const [m, setM] = useState<ProjectMoney | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void withRefresh(() => request(() => api.GET('/v1/projects/{id}/money', { params: { path: { id } } })))
      .then(setM)
      .catch(() => setFailed(true));
  }, [id, withRefresh]);

  if (failed)
    return (
      <div className="ws-page">
        <StateView kind="no-permission" title={t('common.somethingWrong')} />
      </div>
    );
  if (!m) return null;
  const f = m.figures;

  return (
    <div className="ws-page">
      <header className="ws-head">
        <div>
          <p className="ws-head__sub">
            <Link to="/money">{t('money.title')}</Link> · {m.projectName}
          </p>
          <Text variant="screenTitle" as="h1">
            {m.side === 'contractor' ? t('money.owedToYou') : t('money.youOweNow')}: {formatRwf(f.approvedUnpaid)}
          </Text>
        </div>
      </header>
      {f.contract === 0 ? (
        <Text muted>{t('money.noAgreement')}</Text>
      ) : (
        <>
          <div className="ws-kpis ws-kpis--5">
            <Stat label={t('money.agreedContract')} amount={f.contract} />
            <Stat label={t('money.paid')} amount={f.paid} tone="paid" />
            <Stat label={t('money.approvedNotPaid')} amount={f.approvedUnpaid} tone="approved" />
            <Stat label={t('money.waitingForDecision')} amount={f.awaitingDecision} tone="waiting" />
            <Stat label={t('money.stillToCome')} amount={f.stillToCome} />
          </div>
          <Card>
            <MoneyBar contract={f.contract} paid={f.paid} approvedUnpaid={f.approvedUnpaid} />
            {(f.pendingVerification > 0 || f.advances > 0) && (
              <p className="ws-note">
                {f.pendingVerification > 0 && `${t('money.pendingVerification')}: ${formatRwf(f.pendingVerification)}`}
                {f.pendingVerification > 0 && f.advances > 0 && ' · '}
                {f.advances > 0 && `${t('money.advances')}: ${formatRwf(f.advances)}`}
              </p>
            )}
          </Card>
        </>
      )}

      <Card title={t('money.needsYou')}>
        <Actions actions={m.actions} projectId={m.projectId} />
      </Card>

      <Card title={t('money.paymentClaims')}>
        {m.claims.length === 0 ? (
          <p className="jl-field__hint">{t('money.noClaims')}</p>
        ) : (
          <ul className="mn-claims">
            {m.claims.map((c) => (
              <li key={c.id}>
                <Link to={`/projects/${m.projectId}/claims/${c.id}`} className="mn-claims__head">
                  <span>
                    <strong>
                      {c.number} · {c.milestoneName}
                    </strong>
                    {c.paid > 0 && c.status !== 'paid' && <small>{t('money.partlyPaid', { paid: formatRwf(c.paid), amount: formatRwf(c.amount) })}</small>}
                  </span>
                  <Amount amount={c.amount} variant="money" />
                </Link>
                <ClaimTracker requestedAt={c.requestedAt} approvedAt={c.approvedAt} paidAt={c.paidAt} disputedStep={c.disputedStep} />
              </li>
            ))}
          </ul>
        )}
        <p>
          <Link to={`/projects/${m.projectId}/claims`}>
            {t('money.allClaims')} <ChevronRight size={14} aria-hidden />
          </Link>
        </p>
      </Card>

      <Card title={t('money.paymentsRecorded')} flush>
        <div className="ws-table-wrap">
          <table className="ws-table">
            <thead>
              <tr>
                <th scope="col">{t('money.dateCol')}</th>
                <th scope="col">{t('money.forCol')}</th>
                <th scope="col">{t('money.methodCol')}</th>
                <th scope="col">{t('money.verificationCol')}</th>
                <th scope="col" className="num">
                  {t('money.amountCol')}
                </th>
              </tr>
            </thead>
            <tbody>
              {m.payments.map((p) => (
                <tr key={p.id}>
                  <td className="muted">{formatDate(locale, fromIsoDate(p.paymentDate))}</td>
                  <td>{p.claimNumber ?? t('payments.advance')}</td>
                  <td>{t(`payments.method_${p.method}`)}</td>
                  <td>
                    <span className={`qt-status pm-status is-${p.status}`}>{t(`payments.status_${p.status}`)}</span>
                  </td>
                  <td className="num">{formatRwf(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mn-more">
          <Link to={`/projects/${m.projectId}/payments`}>
            {t('money.allPayments')} <ChevronRight size={14} aria-hidden />
          </Link>
        </p>
      </Card>
      {m.spending && (
        <Card title={t('money.spendingTitle')}>
          <p>{t('money.spendingLine', { posted: formatRwf(m.spending.posted), committed: formatRwf(m.spending.committed), budget: formatRwf(m.spending.costBudget) })}</p>
          <Link to={`/projects/${m.projectId}/spending`}>
            {t('spending.title')} <ChevronRight size={14} aria-hidden />
          </Link>
        </Card>
      )}
      <p>
        <Link to={`/projects/${m.projectId}/changes`}>
          {t('changes.title')} <ChevronRight size={14} aria-hidden />
        </Link>
        {' · '}
        <Link to={`/projects/${m.projectId}/exports`}>
          {t('exports.kind_money_history')} <ChevronRight size={14} aria-hidden />
        </Link>
      </p>
      <p className="ws-note">
        {t('money.paidMeansVerified')} {t('money.outsideApp')}
      </p>
    </div>
  );
}

/** What waits on the caller, each a link to where it is done (or a summary across projects). */
function Actions({ actions: a, projectId }: { actions: MoneyActions; projectId?: string }) {
  const { t } = useI18n();
  const items = [
    { n: a.claimsToDecide, label: t('money.claimsToDecide', { count: a.claimsToDecide }), to: 'claims' },
    { n: a.paymentsToConfirm, label: t('money.paymentsToConfirm', { count: a.paymentsToConfirm }), to: 'payments' },
    { n: a.spendingToDecide, label: t('money.spendingToDecide', { count: a.spendingToDecide }), to: 'spending' },
    { n: a.receiptsMissing, label: t('money.receiptsMissing', { count: a.receiptsMissing }), to: 'spending' },
  ].filter((x) => x.n > 0);
  if (!items.length) return <p className="jl-field__hint">{t('money.nothingWaiting')}</p>;
  return (
    <ul className="mn-actions">
      {items.map((x) => (
        <li key={x.label}>
          {projectId ? (
            <Link to={`/projects/${projectId}/${x.to}`}>
              {x.label} <ChevronRight size={14} aria-hidden />
            </Link>
          ) : (
            <span>{x.label}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, amount, tone }: { label: string; amount: number; tone?: 'paid' | 'approved' | 'waiting' }) {
  return (
    <div className="ws-kpi">
      <span className="ws-kpi__label">
        {tone && <i className="ws-dot" style={{ background: `var(--jl-status-${tone})` }} />}
        {label}
      </span>
      <span className="ws-kpi__value">
        <Amount amount={amount} variant="money" />
      </span>
    </div>
  );
}

import { formatRwf, groupDigits } from '@jengalink/ui';
import { Button, Card, ClaimTracker, Money, StateView, StatusBadge, Text } from '@jengalink/ui/web';
import { ArrowLeft, Check } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { PhotoTile } from '../components/PhotoTile';
import { formatDate, formatDuration } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { claimBadge, findClaim, project } from '../lib/demo';

/**
 * Claim review on web: amount first, what it pays for, photos, then a
 * confirmation that repeats the amount (safe approvals, Build Plan).
 */
export default function ClaimPage() {
  const { t, locale } = useI18n();
  const { id = '' } = useParams();
  const claim = findClaim(id);
  const dialog = useRef<HTMLDialogElement>(null);
  const [approved, setApproved] = useState(false);

  if (!claim) {
    return (
      <div className="ws-page">
        <StateView
          kind="no-permission"
          title={t('claim.notFoundTitle')}
          message={t('claim.notFoundMessage')}
          action={
            <Link to="/money" className="jl-btn jl-btn--secondary">
              {t('claim.backToMoney')}
            </Link>
          }
        />
      </div>
    );
  }

  const stage = project.stages.find((s) => s.id === claim.stageId);
  const badge = approved ? claimBadge.approved : claimBadge[claim.status];
  const canDecide = claim.status === 'submitted' && !approved;

  return (
    <div className="ws-page ws-page--narrow">
      <Link to="/money" className="ws-back">
        <ArrowLeft size={16} aria-hidden /> {t('money.title')}
      </Link>

      <header className="ws-claim-head">
        <div>
          <p className="ws-head__sub">
            {t('claim.fromContractor', { number: claim.number, from: claim.requestedBy })} · {formatDate(locale, claim.requestedAt)}
          </p>
          <Money amount={claim.amount} variant="display" />
          <Text variant="sectionTitle" as="h1">
            {claim.title}
          </Text>
          <p className="ws-head__sub">
            {t('claim.stageLine', { stage: claim.stageName })}
            {canDecide ? ` · ${t('common.waiting', { duration: formatDuration(t, claim.requestedAt) })}` : ''}
          </p>
        </div>
        <StatusBadge status={badge.status} label={t(badge.label)} />
      </header>

      {approved && (
        <div className="ws-callout" role="status">
          <strong>{t('claim.approvedNotPaid')}</strong>{' '}
          {t('claim.approvedNext', { from: claim.requestedBy, amount: formatRwf(claim.amount) })}
        </div>
      )}

      {canDecide && (
        <div className="ws-actions">
          <Button size="lg" icon={Check} onClick={() => dialog.current?.showModal()}>
            {t('claim.approve', { amount: formatRwf(claim.amount) })}
          </Button>
          <Button size="lg" variant="secondary">
            {t('claim.askChanges')}
          </Button>
          <Button variant="ghost">{t('claim.reject')}</Button>
        </div>
      )}

      <div className="ws-photos">
        {claim.photos.map((p) => (
          <figure key={p.id}>
            <PhotoTile photo={p} />
            <figcaption>{p.caption}</figcaption>
          </figure>
        ))}
      </div>

      <div className="ws-grid">
        <Card title={t('claim.paysFor')} flush>
          <table className="ws-table">
            <tbody>
              {claim.lineItems.map((l) => (
                <tr key={l.label}>
                  <td>{l.label}</td>
                  <td className="num">{groupDigits(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{t('common.total')} (RWF)</td>
                <td className="num">{groupDigits(claim.amount)}</td>
              </tr>
            </tfoot>
          </table>
        </Card>
        <div className="ws-col">
          <Card title={t('claim.progress')}>
            <ClaimTracker
              requestedAt={claim.requestedAt}
              approvedAt={approved ? new Date().toISOString() : claim.approvedAt}
              paidAt={claim.paidAt}
            />
          </Card>
          <Card title={t('claim.note')}>
            <p style={{ margin: 0 }}>{claim.note}</p>
          </Card>
          {stage && (
            <Card title={t('claim.checks')}>
              <ul className="ws-list">
                {stage.acceptanceCriteria.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <dialog ref={dialog} className="ws-dialog" aria-labelledby="confirm-title">
        <form method="dialog">
          <h2 id="confirm-title" className="jl-text-section-title">
            {t('claim.confirmTitle')}
          </h2>
          <Money amount={claim.amount} variant="display" />
          <p className="jl-muted">
            {t('claim.confirmBody', { title: claim.title, stage: claim.stageName })}
          </p>
          <div className="ws-actions">
            <Button
              size="lg"
              icon={Check}
              onClick={() => {
                setApproved(true);
                dialog.current?.close();
              }}
            >
              {t('claim.confirmYes', { amount: formatRwf(claim.amount) })}
            </Button>
            <Button size="lg" variant="secondary" onClick={() => dialog.current?.close()}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

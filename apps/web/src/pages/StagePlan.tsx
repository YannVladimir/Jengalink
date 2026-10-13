import {
  clampWeight,
  MAX_CRITERIA,
  MAX_STAGES,
  moveStage,
  type PlanDraftStage,
  planDraftToRequest,
  planProblems,
  spreadTo100,
  type StagePlan,
  toPlanDraft,
} from '@jengalink/contracts';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf } from '@jengalink/ui';
import { AmountInput, Button, StateView, Text } from '@jengalink/ui/web';
import { ArrowDown, ArrowUp, Check, ChevronDown, CircleAlert, Lock, MessageSquare, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { ApiError, api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';

let nextKey = 0;
const newKey = () => `new-${++nextKey}`;
/** "2026-11-02" at local noon, so the day never shifts with the time zone. */
const fromIsoDate = (iso: string) => new Date(`${iso}T12:00:00`);

/**
 * Stage plan (Phase 3): each stage's share of the job, planned dates and the
 * checks the owner will use to accept it. Saved as one plan so shares total 100%.
 */
export default function StagePlanPage() {
  const { id = '' } = useParams();
  const { t, locale } = useI18n();
  const { withRefresh } = useAuth();
  const [plan, setPlan] = useState<StagePlan | null>(null);
  const [draft, setDraft] = useState<PlanDraftStage[]>([]);
  const [value, setValue] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchPlan = useCallback(
    () => withRefresh(() => request(() => api.GET('/v1/projects/{id}/plan', { params: { path: { id } } }))),
    [id, withRefresh],
  );
  const apply = useCallback((p: StagePlan) => {
    setPlan(p);
    setDraft(toPlanDraft(p.stages));
    setValue(p.contractValue);
    setConflict(false);
    setError(null);
  }, []);

  useEffect(() => {
    let live = true;
    fetchPlan()
      .then((p) => live && apply(p))
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, [fetchPlan, apply]);

  const reload = () => {
    setLoadFailed(false);
    fetchPlan()
      .then(apply)
      .catch(() => setLoadFailed(true));
  };

  const editable = !!plan && plan.canEdit && !plan.locked;
  const problems = planProblems(draft);
  const dirty = useMemo(
    () =>
      !!plan &&
      JSON.stringify(planDraftToRequest(draft, value)) !== JSON.stringify(planDraftToRequest(toPlanDraft(plan.stages), plan.contractValue)),
    [plan, draft, value],
  );
  const update = (key: string, change: Partial<PlanDraftStage>) => {
    setSaved(false);
    setDraft((d) => d.map((s) => (s.key === key ? { ...s, ...change } : s)));
  };

  const save = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const next = await withRefresh(() =>
        request(() =>
          api.PUT('/v1/projects/{id}/plan', {
            params: { path: { id }, header: { 'If-Match': `"${plan.revision}"` } },
            body: planDraftToRequest(draft, value),
          }),
        ),
      );
      apply(next);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) setConflict(true);
      else setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  if (loadFailed)
    return (
      <div className="ws-page">
        <StateView
          kind="error"
          title={t('common.somethingWrong')}
          action={
            <Button variant="secondary" onClick={reload}>
              {t('common.tryAgain')}
            </Button>
          }
        />
      </div>
    );
  if (!plan) return null;
  const totalOk = problems.total === 100;

  return (
    <div className="ws-page wz pl">
      <header className="ws-head">
        <Text variant="screenTitle" as="h1">
          {t('plan.title')}
        </Text>
        <p className="ws-head__sub">{t('plan.lead')}</p>
      </header>

      {!editable && (
        <p className="pl-note jl-card">
          <Lock size={18} aria-hidden />{' '}
          {plan.locked && plan.latestDecision?.decision === 'accepted'
            ? t('accept.acceptedBanner', {
                name: plan.latestDecision.decidedByName ?? t('invite.someone'),
                date: formatDate(locale, plan.latestDecision.decidedAt),
              })
            : plan.locked
              ? t('plan.lockedNote')
              : t('plan.readOnlyNote')}
        </p>
      )}

      {!plan.locked && plan.latestDecision?.decision === 'changes_requested' && (
        <p className="iv-pending ac-asked" role="status">
          <MessageSquare size={18} aria-hidden />
          <span>
            {t('accept.askedChanges', {
              name: plan.latestDecision.decidedByName ?? t('invite.someone'),
              note: plan.latestDecision.note ?? '',
            })}
          </span>
        </p>
      )}

      {editable ? (
        <section className="jl-card ac-value">
          <AmountInput label={t('wizard.valueLabel')} value={value} onChange={setValue} />
          <span className="jl-field__hint">{value === null ? t('accept.noValue') : t('accept.waitingOwner')}</span>
        </section>
      ) : (
        <section className="jl-card ac-value">
          <span className="jl-field__label">{t('accept.valueLabel')}</span>
          <strong>{plan.contractValue !== null ? formatRwf(plan.contractValue) : t('accept.noValue')}</strong>
        </section>
      )}

      {editable && (
        <div className={`pl-total${totalOk ? ' is-ok' : ''}`} role="status">
          {totalOk ? <Check size={18} aria-hidden /> : <CircleAlert size={18} aria-hidden />}
          <span>{totalOk ? t('plan.totalOk') : t('plan.totalOff', { total: problems.total })}</span>
          {!totalOk && draft.length > 0 && (
            <Button variant="secondary" onClick={() => setDraft(spreadTo100(draft))}>
              {t('plan.evenOut')}
            </Button>
          )}
        </div>
      )}

      <ol className="pl-list">
        {draft.map((s, i) => (
          <StageItem
            key={s.key}
            stage={s}
            index={i}
            count={draft.length}
            open={open === s.key}
            editable={editable}
            badDates={problems.badDates.includes(i)}
            onToggle={() => setOpen(open === s.key ? null : s.key)}
            onChange={(c) => update(s.key, c)}
            onMove={(by) => setDraft(moveStage(draft, i, by))}
            onRemove={() => setDraft(draft.filter((x) => x.key !== s.key))}
          />
        ))}
      </ol>

      {editable && draft.length < MAX_STAGES && (
        <div>
          <Button
            variant="secondary"
            icon={Plus}
            onClick={() => {
              const key = newKey();
              setDraft([...draft, { key, name: t('wizard.newStageName'), weight: 0, description: '', plannedStart: null, plannedEnd: null, criteria: [] }]);
              setOpen(key);
            }}
          >
            {t('wizard.addStage')}
          </Button>
        </div>
      )}

      {conflict && (
        <div className="pl-note jl-card" role="alert">
          <span>{t('plan.conflict')}</span>
          <Button variant="secondary" onClick={reload}>
            {t('plan.reload')}
          </Button>
        </div>
      )}
      {error && (
        <p className="jl-field__error" role="alert">
          {error}
        </p>
      )}

      {editable && (
        <div className="pl-save">
          <span className="jl-field__hint">{saved && !dirty ? t('plan.saved') : dirty ? t('plan.unsaved') : ''}</span>
          <Button size="lg" loading={busy} disabled={!dirty || !problems.ok || conflict} onClick={() => void save()}>
            {busy ? t('plan.saving') : t('plan.save')}
          </Button>
        </div>
      )}
    </div>
  );
}

function StageItem({
  stage: s,
  index,
  count,
  open,
  editable,
  badDates,
  onToggle,
  onChange,
  onMove,
  onRemove,
}: {
  stage: PlanDraftStage;
  index: number;
  count: number;
  open: boolean;
  editable: boolean;
  badDates: boolean;
  onToggle: () => void;
  onChange: (c: Partial<PlanDraftStage>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t, locale } = useI18n();
  const uid = useId();
  const [criterion, setCriterion] = useState('');
  const fmt = (iso: string) => formatDate(locale, fromIsoDate(iso));
  const dates =
    s.plannedStart || s.plannedEnd ? [s.plannedStart ? fmt(s.plannedStart) : '…', s.plannedEnd ? fmt(s.plannedEnd) : '…'].join(' – ') : t('plan.noDates');
  const addCriterion = () => {
    const text = criterion.trim();
    if (text.length < 3 || s.criteria.length >= MAX_CRITERIA) return;
    onChange({ criteria: [...s.criteria, text] });
    setCriterion('');
  };

  return (
    <li className={`pl-stage jl-card${open ? ' is-open' : ''}`}>
      <button type="button" className="pl-stage__head" aria-expanded={open} onClick={onToggle}>
        <span className="pl-stage__n">{index + 1}</span>
        <span className="pl-stage__title">
          <strong>{s.name || '…'}</strong>
          <small>
            {dates} · {s.criteria.length ? t('plan.criteriaCount', { count: s.criteria.length }) : t('plan.noCriteria')}
          </small>
        </span>
        <span className="pl-stage__weight">{s.weight}%</span>
        <ChevronDown size={18} className="pl-stage__chev" aria-hidden />
      </button>

      {open && (
        <div className="pl-stage__body">
          {editable && (
            <div className="jl-field">
              <label className="jl-field__label" htmlFor={`${uid}-name`}>
                {t('plan.stageName')}
              </label>
              <span className="si-input pl-input">
                <input id={`${uid}-name`} value={s.name} maxLength={80} onChange={(e) => onChange({ name: e.target.value })} />
              </span>
            </div>
          )}

          <div className="pl-row">
            <div className="jl-field">
              <label className="jl-field__label" htmlFor={`${uid}-w`}>
                {t('plan.share')}
              </label>
              {editable ? (
                <span className="si-input pl-input pl-input--weight">
                  <input
                    id={`${uid}-w`}
                    type="number"
                    min={0}
                    max={100}
                    value={s.weight}
                    onChange={(e) => onChange({ weight: clampWeight(Number(e.target.value)) })}
                  />
                  <span className="si-input__prefix">%</span>
                </span>
              ) : (
                <span>{t('wizard.stageShare', { weight: s.weight })}</span>
              )}
            </div>
            {(['start', 'end'] as const).map((which) => {
              const value = which === 'start' ? s.plannedStart : s.plannedEnd;
              return (
                <div className="jl-field" key={which}>
                  <label className="jl-field__label" htmlFor={`${uid}-${which}`}>
                    {t(which === 'start' ? 'plan.start' : 'plan.end')}
                  </label>
                  {editable ? (
                    <span className={`si-input pl-input${which === 'end' && badDates ? ' si-input--error' : ''}`}>
                      <input
                        id={`${uid}-${which}`}
                        type="date"
                        value={value ?? ''}
                        min={which === 'end' ? (s.plannedStart ?? undefined) : undefined}
                        onChange={(e) => onChange(which === 'start' ? { plannedStart: e.target.value || null } : { plannedEnd: e.target.value || null })}
                      />
                    </span>
                  ) : (
                    <span>{value ? fmt(value) : '—'}</span>
                  )}
                </div>
              );
            })}
          </div>
          {badDates && (
            <p className="jl-field__error" role="alert">
              {t('plan.endBeforeStart')}
            </p>
          )}

          <div className="jl-field">
            <label className="jl-field__label" htmlFor={`${uid}-desc`}>
              {t('plan.description')}
            </label>
            {editable ? (
              <textarea
                id={`${uid}-desc`}
                className="pl-textarea"
                rows={2}
                maxLength={500}
                value={s.description}
                placeholder={t('plan.descriptionPlaceholder')}
                onChange={(e) => onChange({ description: e.target.value })}
              />
            ) : (
              <span>{s.description || '—'}</span>
            )}
          </div>

          <div className="jl-field">
            <span className="jl-field__label">{t('plan.criteriaTitle')}</span>
            {editable && <span className="jl-field__hint">{t('plan.criteriaHint')}</span>}
            {s.criteria.length === 0 && !editable && <span>{t('plan.noCriteria')}</span>}
            <ul className="pl-criteria">
              {s.criteria.map((c, ci) => (
                <li key={`${ci}-${c}`}>
                  <Check size={16} aria-hidden />
                  <span>{c}</span>
                  {editable && (
                    <button
                      type="button"
                      className="wz-stages__remove"
                      aria-label={t('plan.removeCriterion', { text: c })}
                      onClick={() => onChange({ criteria: s.criteria.filter((_, j) => j !== ci) })}
                    >
                      <X size={16} aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {editable && s.criteria.length < MAX_CRITERIA && (
              <form
                className="pl-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  addCriterion();
                }}
              >
                <span className="si-input pl-input">
                  <input aria-label={t('plan.criteriaPlaceholder')} value={criterion} maxLength={160} placeholder={t('plan.criteriaPlaceholder')} onChange={(e) => setCriterion(e.target.value)} />
                </span>
                <Button type="submit" variant="secondary" disabled={criterion.trim().length < 3}>
                  {t('plan.addCriterion')}
                </Button>
              </form>
            )}
          </div>

          {editable && (
            <div className="pl-tools">
              <button type="button" className="pl-icon" aria-label={t('plan.moveUp', { name: s.name })} disabled={index === 0} onClick={() => onMove(-1)}>
                <ArrowUp size={18} aria-hidden />
              </button>
              <button type="button" className="pl-icon" aria-label={t('plan.moveDown', { name: s.name })} disabled={index === count - 1} onClick={() => onMove(1)}>
                <ArrowDown size={18} aria-hidden />
              </button>
              <span className="pl-tools__gap" />
              {count > 1 && (
                <Button variant="ghost" icon={Trash2} onClick={onRemove} aria-label={t('wizard.removeStage', { name: s.name })}>
                  {t('plan.removeStage')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

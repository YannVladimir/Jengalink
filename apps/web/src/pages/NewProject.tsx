import {
  type LocationLevel,
  locationLevels,
  type OrganizationView,
  type ProjectLocation,
  type ProjectSummary,
  type ProjectType,
  provinceKeys,
  type StageDraft,
  stageTemplates,
  withStageAdded,
  withStageRemoved,
} from '@jengalink/contracts';
import type { MessageKey, Translate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf } from '@jengalink/ui';
import { AmountInput, Button, Text } from '@jengalink/ui/web';
import { Building2, Check, Construction, Hammer, House, ListChecks, type LucideIcon, Plus, Store, UserPlus, X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, api, request } from '../lib/api';
import { useAuth } from '../lib/auth-context';

const typeIcons: Record<ProjectType, LucideIcon> = {
  house: House,
  renovation: Hammer,
  apartment: Building2,
  commercial: Store,
  civil: Construction,
};
const projectTypes = Object.keys(typeIcons) as ProjectType[];

type Step = 'company' | 'basics' | 'location' | 'value' | 'stages' | 'review';

/** Retries of the same wizard reuse one key, so a lost reply never creates two projects. */
const newKey = () => `wiz-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const provinceName = (name: string, t: Translate) => {
  const k = provinceKeys[name];
  return k ? t(`province.${k}`) : name;
};

const placeText = (loc: ProjectLocation, t: Translate) => {
  const parts = locationLevels
    .map((l) => (l === 'province' && loc.province ? provinceName(loc.province, t) : loc[l]))
    .filter(Boolean);
  return parts.length ? parts.reverse().join(', ') : t('wizard.notSet');
};

/**
 * Contractor project wizard (Phase 3), same steps as the phone: name and type,
 * site (province → village), contract value, template stages, then review.
 */
export default function NewProjectPage() {
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const navigate = useNavigate();

  const [orgs, setOrgs] = useState<OrganizationView[] | null>(null);
  const [company, setCompany] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<ProjectType>('house');
  const [location, setLocation] = useState<ProjectLocation>({});
  const [value, setValue] = useState<number | null>(null);
  const [stages, setStages] = useState<StageDraft[]>([]);
  const [stagesFor, setStagesFor] = useState<ProjectType | null>(null);
  const [step, setStep] = useState<Step>('basics');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ProjectSummary | null>(null);
  const key = useRef(newKey());

  useEffect(() => {
    void withRefresh(() => request(() => api.GET('/v1/organizations')))
      .then((list) => {
        setOrgs(list);
        if (!list.some((o) => o.kind !== 'household')) setStep('company');
      })
      .catch(() => setOrgs([]));
  }, [withRefresh]);

  const org = orgs?.find((o) => o.kind === 'contractor' || o.kind === 'developer') ?? orgs?.find((o) => o.kind !== 'household');
  const steps: Step[] = [...(org ? [] : (['company'] as Step[])), 'basics', 'location', 'value', 'stages', 'review'];
  const index = steps.indexOf(step);

  const go = (to: Step) => {
    setError(null);
    if (to === 'stages' && stagesFor !== type) {
      setStages(stageTemplates[type].map((s) => ({ name: t(`stageTemplate.${s.key}` as MessageKey), weight: s.weight })));
      setStagesFor(type);
    }
    setStep(to);
  };
  const next = () => steps[index + 1] && go(steps[index + 1]);
  const back = () => (index > 0 ? go(steps[index - 1]) : navigate(-1));

  const canContinue =
    step === 'company'
      ? company.trim().length >= 2
      : step === 'basics'
        ? name.trim().length >= 2
        : step === 'location'
          ? !!location.district
          : step === 'stages'
            ? stages.length > 0 && stages.every((s) => s.name.trim().length >= 2)
            : true;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const organization =
        org ??
        (await withRefresh(() =>
          request(() => api.POST('/v1/organizations', { body: { name: company.trim(), kind: 'contractor' } })),
        ));
      const project = await withRefresh(() =>
        request(() =>
          api.POST('/v1/projects', {
            params: { header: { 'Idempotency-Key': key.current } },
            body: {
              organizationId: organization.id,
              name: name.trim(),
              type,
              location,
              ...(value ? { contractValue: value } : {}),
              stages: stages.map((s) => ({ name: s.name.trim(), weight: s.weight })),
            },
          }),
        ),
      );
      setCreated(project);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  if (created)
    return (
      <div className="ws-page wz">
        <div className="wz-done">
          <span className="wz-done__icon" aria-hidden>
            <Check size={32} />
          </span>
          <Text variant="screenTitle" as="h1">
            {t('wizard.doneTitle')}
          </Text>
          <Text muted>{t('wizard.doneLead', { name: created.name })}</Text>
          <div className="iv-share">
            <Button size="lg" icon={UserPlus} onClick={() => navigate(`/projects/${created.id}/invite`)}>
              {t('invite.inviteOwner')}
            </Button>
            <Button variant="secondary" size="lg" icon={ListChecks} onClick={() => navigate(`/projects/${created.id}/plan`)}>
              {t('plan.planStages')}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => navigate('/')}>
              {t('invite.later')}
            </Button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="ws-page wz">
      <header className="ws-head">
        <Text variant="screenTitle" as="h1">
          {t('wizard.title')}
        </Text>
        <p className="ws-head__sub">{t('wizard.stepOf', { step: index + 1, total: steps.length })}</p>
        <div className="wz-bar" aria-hidden>
          {steps.map((s, i) => (
            <span key={s} className={i <= index ? 'is-done' : undefined} />
          ))}
        </div>
      </header>

      {!orgs ? null : (
        <form
          className="jl-card wz-card"
          onSubmit={(e) => {
            e.preventDefault();
            if (step === 'review') void create();
            else if (canContinue) next();
          }}
        >
          {step === 'company' && (
            <Section title={t('wizard.companyTitle')} lead={t('wizard.companyLead')}>
              <Field label={t('wizard.companyLabel')} value={company} onChange={setCompany} placeholder={t('wizard.companyPlaceholder')} />
            </Section>
          )}

          {step === 'basics' && (
            <Section title={t('wizard.basicsTitle')}>
              <Field label={t('wizard.nameLabel')} value={name} onChange={setName} placeholder={t('wizard.namePlaceholder')} />
              <fieldset className="wz-types">
                <legend className="jl-field__label">{t('wizard.typeLabel')}</legend>
                {projectTypes.map((pt) => {
                  const Icon = typeIcons[pt];
                  return (
                    <label key={pt} className={`wz-type${pt === type ? ' is-on' : ''}`}>
                      <input type="radio" name="type" checked={pt === type} onChange={() => setType(pt)} />
                      <Icon size={24} aria-hidden />
                      <span>
                        <strong>{t(`projectType.${pt}`)}</strong>
                        <small>{t(`projectTypeHint.${pt}`)}</small>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            </Section>
          )}

          {step === 'location' && (
            <Section title={t('wizard.locationTitle')} lead={t('wizard.locationLead')}>
              <LocationSelects value={location} onChange={setLocation} />
            </Section>
          )}

          {step === 'value' && (
            <Section title={t('wizard.valueTitle')} lead={t('wizard.valueLead')}>
              <AmountInput label={t('wizard.valueLabel')} value={value} onChange={setValue} />
              <div>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setValue(null);
                    next();
                  }}
                >
                  {t('wizard.valueSkip')}
                </Button>
              </div>
              <p className="jl-field__hint">{t('wizard.moneyNote')}</p>
            </Section>
          )}

          {step === 'stages' && (
            <Section title={t('wizard.stagesTitle')} lead={t('wizard.stagesLead')}>
              <ol className="wz-stages">
                {stages.map((s, i) => (
                  <li key={i}>
                    <span className="wz-stages__n">{i + 1}</span>
                    <span className="wz-stages__body">
                      <input
                        aria-label={`${t('wizard.renameStage')} ${i + 1}`}
                        value={s.name}
                        maxLength={80}
                        onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                      />
                      <small>{t('wizard.stageShare', { weight: s.weight })}</small>
                    </span>
                    {stages.length > 1 && (
                      <button
                        type="button"
                        className="wz-stages__remove"
                        aria-label={t('wizard.removeStage', { name: s.name })}
                        onClick={() => setStages(withStageRemoved(stages, i))}
                      >
                        <X size={18} aria-hidden />
                      </button>
                    )}
                  </li>
                ))}
              </ol>
              {stages.length < 30 && (
                <div>
                  <Button variant="secondary" icon={Plus} onClick={() => setStages(withStageAdded(stages, t('wizard.newStageName')))}>
                    {t('wizard.addStage')}
                  </Button>
                </div>
              )}
              <p className="jl-field__hint">{t('wizard.stagesLater')}</p>
            </Section>
          )}

          {step === 'review' && (
            <Section title={t('wizard.reviewTitle')}>
              <dl className="wz-review">
                <Row label={t('wizard.reviewName')} value={name} onEdit={() => go('basics')} />
                <Row label={t('wizard.reviewType')} value={t(`projectType.${type}`)} onEdit={() => go('basics')} />
                <Row label={t('wizard.reviewLocation')} value={placeText(location, t)} onEdit={() => go('location')} />
                <Row label={t('wizard.reviewValue')} value={value ? formatRwf(value) : t('wizard.notSet')} onEdit={() => go('value')} />
                <Row label={t('wizard.reviewStages')} value={t('wizard.stagesCount', { count: stages.length })} onEdit={() => go('stages')} />
              </dl>
              <p className="jl-field__hint">{t('wizard.moneyNote')}</p>
            </Section>
          )}

          {error && (
            <p className="jl-field__error" role="alert">
              {error}
            </p>
          )}

          <div className="wz-actions">
            <Button variant="secondary" size="lg" onClick={back}>
              {t('common.back')}
            </Button>
            {step === 'review' ? (
              <Button type="submit" size="lg" loading={busy}>
                {busy ? t('wizard.creating') : t('wizard.create')}
              </Button>
            ) : (
              <Button type="submit" size="lg" disabled={!canContinue}>
                {t('common.continue')}
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

function Section({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <section className="wz-section">
      <div>
        <Text variant="sectionTitle" as="h2">
          {title}
        </Text>
        {lead && <Text muted>{lead}</Text>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const id = useId();
  const { t } = useI18n();
  const tooShort = value.length > 0 && value.trim().length < 2;
  return (
    <div className="jl-field">
      <label className="jl-field__label" htmlFor={id}>
        {label}
      </label>
      <span className="si-input">
        <input id={id} value={value} maxLength={120} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} autoFocus />
      </span>
      {tooShort && <span className="jl-field__hint">{t('wizard.nameTooShort')}</span>}
    </div>
  );
}

/** One select per level; each loads its options from the API once its parent is chosen. */
function LocationSelects({ value, onChange }: { value: ProjectLocation; onChange: (v: ProjectLocation) => void }) {
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const [options, setOptions] = useState<Partial<Record<LocationLevel, string[]>>>({});
  const depth = locationLevels.findIndex((l) => !value[l]);
  const openLevel = depth === -1 ? null : locationLevels[depth];

  useEffect(() => {
    if (!openLevel || options[openLevel]) return;
    void withRefresh(() =>
      request(() =>
        api.GET('/v1/locations/rw', {
          params: { query: { province: value.province, district: value.district, sector: value.sector, cell: value.cell } },
        }),
      ),
    ).then((r) => setOptions((o) => ({ ...o, [r.level]: r.options })));
  }, [openLevel, options, value.province, value.district, value.sector, value.cell, withRefresh]);

  const choose = (level: LocationLevel, option: string) => {
    const i = locationLevels.indexOf(level);
    const nextValue: ProjectLocation = {};
    locationLevels.slice(0, i).forEach((l) => (nextValue[l] = value[l]));
    if (option) nextValue[level] = option;
    // Options below a changed level belong to the old parent.
    setOptions((o) => Object.fromEntries(Object.entries(o).filter(([l]) => locationLevels.indexOf(l as LocationLevel) <= i)));
    onChange(nextValue);
  };

  return (
    <div className="wz-location">
      {locationLevels.map((level, i) => {
        const list = options[level] ?? (value[level] ? [value[level]!] : []);
        const enabled = depth === -1 || i <= depth;
        return (
          <label key={level} className="jl-field">
            <span className="jl-field__label">{t(`location.${level}`)}</span>
            <select value={value[level] ?? ''} disabled={!enabled} onChange={(e) => choose(level, e.target.value)}>
              <option value="">{t('wizard.choose')}</option>
              {list.map((o) => (
                <option key={o} value={o}>
                  {level === 'province' ? provinceName(o, t) : o}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
}

function Row({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  const { t } = useI18n();
  return (
    <div className="wz-review__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
      <button type="button" className="si-link" onClick={onEdit} aria-label={`${t('wizard.edit')}: ${label}`}>
        {t('wizard.edit')}
      </button>
    </div>
  );
}

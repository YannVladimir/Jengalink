import { useEffect, useState, type ReactNode } from 'react';
import {
  colors,
  palette,
  statuses,
  typeScale,
  type StageBlockInput,
  type Status,
} from '@jengalink/ui';
import {
  AmountInput,
  Button,
  Card,
  LastUpdated,
  Money,
  OfflineBanner,
  Skeleton,
  StateView,
  StatusBadge,
  Text,
  ProgressRing,
  RingLegend,
  JengaTower,
  MoneyBar,
  ClaimTracker,
  WalletCard,
} from '@jengalink/ui/web';
import { ArrowRight, Camera, Check, Plus } from 'lucide-react';

type Theme = 'system' | 'light' | 'dark';

// Sample house build used across the infographics.
const sampleStages: StageBlockInput[] = [
  { id: 's1', name: 'Foundation', status: 'accepted' },
  { id: 's2', name: 'Ground floor walls', status: 'accepted' },
  { id: 's3', name: 'Ground floor slab', status: 'accepted' },
  { id: 's4', name: 'First floor walls', status: 'ready_for_review' },
  { id: 's5', name: 'Roof structure', status: 'in_progress' },
  { id: 's6', name: 'Roofing sheets', status: 'planned' },
  { id: 's7', name: 'Finishes', status: 'planned' },
];

const swatches: { name: string; token: string; hex: string; use: string }[] = [
  { name: 'Jenga Orange', token: 'primary', hex: colors.primary, use: 'Main buttons, "needs you"' },
  { name: 'Safety Orange', token: 'accent', hex: colors.accent, use: 'Progress fills (never text)' },
  { name: 'Steel Blue', token: 'structure', hex: colors.structure, use: 'Headers, sidebar, Approved' },
  { name: 'Asphalt', token: 'ink', hex: colors.ink, use: 'Text and numbers' },
  { name: 'Slate', token: 'ink-muted', hex: colors.inkMuted, use: 'Labels, timestamps' },
  { name: 'Concrete', token: 'background', hex: colors.background, use: 'App background' },
  { name: 'Mortar', token: 'border', hex: colors.border, use: 'Borders, dividers' },
  { name: 'Hi-vis Yellow', token: 'highlight', hex: palette.hiVis, use: 'Small markers only' },
];

const typeSamples: { variant: keyof typeof typeScale; sample: string }[] = [
  { variant: 'display', sample: '68%' },
  { variant: 'screenTitle', sample: 'Kicukiro house' },
  { variant: 'sectionTitle', sample: 'Decisions waiting' },
  { variant: 'body', sample: 'The slab for the first floor was poured on Tuesday.' },
  { variant: 'label', sample: 'Amount requested' },
  { variant: 'caption', sample: 'Updated 5 min ago' },
];

// ?section=<id> shows a single section (handy for reviews and screenshots).
const onlySection = new URLSearchParams(window.location.search).get('section');

function Section({ id, title, lead, children }: { id: string; title: string; lead: string; children: ReactNode }) {
  if (onlySection && onlySection !== id) return null;
  return (
    <section id={id} className="ds-section">
      <div className="ds-section__head">
        <Text variant="screenTitle" as="h2">
          {title}
        </Text>
        <Text muted>{lead}</Text>
      </div>
      {children}
    </section>
  );
}

export default function DesignSystem({ apiStatus }: { apiStatus: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('system');
  const [amount, setAmount] = useState<number | null>(1500000);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  // Deep links like /#infographics land on that section.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
  const updatedAt = new Date(Date.now() - 5 * 60_000);

  const applyTheme = (t: Theme) => {
    setTheme(t);
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  };

  return (
    <div className="ds">
      <header className="ds-hero" hidden={!!onlySection}>
        <div className="ds-hero__inner">
          <HeroTower />
          <div className="ds-brand">
            <JengaMark />
            <span className="ds-brand__name">JengaLink</span>
          </div>
          <h1 className="ds-hero__title">Design system</h1>
          <p className="ds-hero__lead">
            Safety orange on concrete. Built for owners who should understand their project in five
            seconds, on a cheap phone, in English or Kinyarwanda.
          </p>
          <div className="ds-theme" role="radiogroup" aria-label="Theme">
            {(['system', 'light', 'dark'] as Theme[]).map((t) => (
              <button
                key={t}
                role="radio"
                aria-checked={theme === t}
                className={theme === t ? 'is-on' : ''}
                onClick={() => applyTheme(t)}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="ds-main">
        <Section id="colour" title="Colour" lead="Orange is rare on purpose: it always means “tap here” or “needs you”.">
          <div className="ds-swatches">
            {swatches.map((s) => (
              <div key={s.token} className="ds-swatch">
                <div className="ds-swatch__chip" style={{ background: `var(--jl-${s.token})` }} />
                <div className="ds-swatch__meta">
                  <strong>{s.name}</strong>
                  <code>{s.hex}</code>
                  <span>{s.use}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="status" title="Status" lead="Every status has its own colour, icon and word. Approved and Paid never share a colour.">
          <Card flush>
            <table className="ds-status">
              <tbody>
                {(Object.keys(statuses) as Status[]).map((s) => (
                  <tr key={s}>
                    <td>
                      <StatusBadge status={s} />
                    </td>
                    <td className="jl-muted">{statuses[s].meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </Section>

        <Section id="type" title="Typography" lead="Plus Jakarta Sans for headings and big numbers, Inter for everything else. Body text is never below 16 px.">
          <Card flush>
            <div className="ds-type">
              {typeSamples.map(({ variant, sample }) => {
                const t = typeScale[variant];
                return (
                  <div key={variant} className="ds-type__row">
                    <div className="ds-type__spec">
                      <strong>{variant}</strong>
                      <span>
                        {t.family === 'heading' ? 'Jakarta' : 'Inter'} {t.weight} · {t.size}/{t.lineHeight}
                      </span>
                    </div>
                    <Text variant={variant}>{sample}</Text>
                  </div>
                );
              })}
            </div>
          </Card>
        </Section>

        <Section id="buttons" title="Buttons" lead="One main action per screen: large, orange, at the bottom within thumb reach. Secondary actions are quieter.">
          <Card>
            <div className="ds-row">
              <Button size="lg" icon={Check}>
                Approve payment
              </Button>
              <Button variant="secondary" size="lg">
                Ask for changes
              </Button>
              <Button variant="ghost">View photos</Button>
            </div>
            <div className="ds-row">
              <Button icon={Plus}>New update</Button>
              <Button variant="secondary" icon={Camera}>
                Add photos
              </Button>
              <Button variant="danger">Reject claim</Button>
              <Button
                loading={loading}
                onClick={() => {
                  setLoading(true);
                  setTimeout(() => setLoading(false), 1500);
                }}
              >
                {loading ? 'Sending…' : 'Try loading'}
              </Button>
              <Button disabled>Disabled</Button>
            </div>
            <div className="ds-phone-cta">
              <Button size="lg" block icon={ArrowRight}>
                Review payment claim
              </Button>
            </div>
          </Card>
        </Section>

        <Section id="money" title="Money" lead="Every amount reads “RWF 1,500,000” with tabular figures, so columns of numbers line up.">
          <div className="ds-grid-2">
            <Card title="Amounts">
              <div className="ds-stack">
                <Money amount={48_500_000} variant="display" />
                <Money amount={12_750_000} variant="moneyLarge" />
                <Money amount={1_500_000} />
                <Money amount={-250_000} />
              </div>
            </Card>
            <Card title="Amount input">
              <AmountInput
                label="Amount requested"
                value={amount}
                onChange={setAmount}
                hint="Groups digits as you type. Numeric keyboard on phones."
              />
              <div style={{ height: 16 }} />
              <AmountInput label="Site float top-up" value={null} onChange={() => {}} error="Enter an amount above RWF 0" />
            </Card>
          </div>
        </Section>

        <Section id="cards" title="Cards" lead="Cards hold one idea each. Every figure shows when it was last updated.">
          <div className="ds-grid-2">
            <Card title="Payment claim #4" action={<StatusBadge status="waiting" />}>
              <Text variant="label" muted>
                Ground floor slab · Stage 3
              </Text>
              <div style={{ margin: '8px 0 4px' }}>
                <Money amount={6_200_000} variant="moneyLarge" />
              </div>
              <LastUpdated at={updatedAt} />
              <div style={{ marginTop: 16 }}>
                <Button block size="lg">
                  Review and approve
                </Button>
              </div>
            </Card>
            <Card title="Contract money">
              <div className="ds-stack-sm">
                <Row label="Paid" status="paid" amount={18_400_000} />
                <Row label="Approved, not paid" status="approved" amount={6_200_000} />
                <Row label="Still to come" amount={23_900_000} />
              </div>
              <div className="ds-divider" />
              <div className="ds-split">
                <Text variant="bodyStrong">Agreed contract</Text>
                <Money amount={48_500_000} />
              </div>
            </Card>
          </div>
        </Section>

        <Section id="infographics" title="Infographics" lead="Each kind of information always uses the same picture, with the exact number and one plain sentence beside it. Each works without colour.">
          <div className="ds-grid-2">
            <Card title="Overall progress">
              <div className="ds-ring-row">
                <ProgressRing accepted={42} reported={14} />
                <RingLegend accepted={42} reported={14} />
              </div>
              <p className="jl-viz__caption">42% of the work is accepted. 14% more is reported and waiting for review.</p>
            </Card>
            <Card title="Stages">
              <JengaTower stages={sampleStages} onSelect={(id) => setPicked(id)} />
              {picked && <p className="jl-viz__caption">Opened stage {picked.slice(1)} (tap a block).</p>}
            </Card>
            <Card title="Contract money">
              <MoneyBar contract={48_500_000} paid={18_400_000} approvedUnpaid={6_200_000} />
            </Card>
            <Card title="Payment claim #4">
              <div className="ds-stack">
                <ClaimTracker requestedAt="2026-10-01T09:00:00Z" approvedAt="2026-10-03T15:00:00Z" />
                <div className="ds-divider" />
                <ClaimTracker requestedAt="2026-09-20T09:00:00Z" disputedStep="approved" />
              </div>
            </Card>
            <Card>
              <WalletCard expected={420_000} counted={405_000} custodian="Jean (site supervisor)" />
            </Card>
            <Card>
              <WalletCard expected={180_000} counted={180_000} custodian="Aline" />
            </Card>
          </div>
        </Section>

        <Section id="states" title="States" lead="Every screen designs loading, empty, error, offline and “no permission”.">
          <div className="ds-grid-3">
            <Card>
              <StateView kind="empty" title="No updates yet" message="Updates from the site will appear here with their photos." />
            </Card>
            <Card>
              <StateView
                kind="error"
                title="Couldn’t load the claim"
                message="Check your connection and try again. Nothing was approved."
                action={<Button variant="secondary">Try again</Button>}
              />
            </Card>
            <Card>
              <StateView kind="no-permission" title="Not shared with you" message="Ask the project owner to invite you." />
            </Card>
          </div>
          <div className="ds-grid-2" style={{ marginTop: 16 }}>
            <Card title="Offline">
              <div className="ds-stack-sm">
                <OfflineBanner />
                <OfflineBanner pending={3} />
              </div>
            </Card>
            <Card title="Loading">
              <div className="ds-stack-sm">
                <Skeleton width="40%" height={14} />
                <Skeleton width="70%" height={32} />
                <Skeleton height={12} />
                <Skeleton width="85%" height={12} />
              </div>
            </Card>
          </div>
        </Section>
      </main>

      <footer className="ds-footer">
        <span>JengaLink A0 · design tokens in packages/ui</span>
        <span>API: {apiStatus}</span>
      </footer>
    </div>
  );
}

function Row({ label, status, amount }: { label: string; status?: Status; amount: number }) {
  return (
    <div className="ds-split">
      <span className="ds-legend">
        <i style={{ background: status ? `var(--jl-status-${status})` : 'var(--jl-border-strong)' }} />
        {label}
      </span>
      <Money amount={amount} />
    </div>
  );
}

/** Hero art: a Jenga tower of stages; the orange block is the stage in progress. */
function HeroTower() {
  const rows = [0, 1, 2, 3];
  return (
    <svg className="ds-tower" viewBox="0 0 260 220" aria-hidden>
      {rows.map((r) => (
        <rect key={r} className="b" x={r % 2 ? 30 : 10} y={180 - r * 44} width="220" height="36" rx="8" />
      ))}
      <rect className="o" x="60" y="4" width="180" height="36" rx="8" />
    </svg>
  );
}

/** Jenga mark: three stacked blocks, the top one orange. */
function JengaMark() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden>
      <rect x="4" y="21" width="24" height="7" rx="2" fill="var(--jl-structure)" />
      <rect x="4" y="12.5" width="24" height="7" rx="2" fill="var(--jl-structure)" opacity=".7" />
      <rect x="9" y="4" width="19" height="7" rx="2" fill="var(--jl-primary)" />
    </svg>
  );
}

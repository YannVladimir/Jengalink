import {
  Camera,
  CircleCheck,
  Clock,
  Inbox,
  LoaderCircle,
  Lock,
  RefreshCw,
  TriangleAlert,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import {
  type ButtonHTMLAttributes,
  type ElementType,
  type ReactNode,
  useId,
} from 'react';
import { formatUpdatedAgo } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { groupDigits, parseAmount } from '../format';
import { statuses, type Status, type StatusIcon, type TypeVariant } from '../tokens';
import { jengaCss } from './styles';

export { jengaCss };

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** Render once at the root: fonts, theme variables (light + dark) and component styles. */
export function JengaStyles() {
  return <style>{jengaCss}</style>;
}

export function Text({
  variant = 'body',
  as: Tag = 'p',
  muted,
  className,
  children,
}: {
  variant?: TypeVariant;
  as?: ElementType;
  muted?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const kebab = variant.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return (
    <Tag className={cx(`jl-text-${kebab}`, muted && 'jl-muted', className)} style={{ margin: 0 }}>
      {children}
    </Tag>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
  icon?: LucideIcon;
};

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  loading,
  icon: Icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cx('jl-btn', `jl-btn--${variant}`, size === 'lg' && 'jl-btn--lg', block && 'jl-btn--block', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <LoaderCircle size={18} className="jl-spin" aria-hidden />
      ) : (
        Icon && <Icon size={18} aria-hidden />
      )}
      {children}
    </button>
  );
}

export function Card({
  title,
  action,
  flush,
  className,
  children,
}: {
  title?: ReactNode;
  action?: ReactNode;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx('jl-card', flush && 'jl-card--flush', className)}>
      {(title || action) && (
        <header className="jl-card__head">
          {title && <h2 className="jl-card__title jl-text-section-title">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const statusIcons: Record<StatusIcon, LucideIcon> = {
  camera: Camera,
  'check-outline': CircleCheck,
  'check-filled': CircleCheck,
  clock: Clock,
  warning: TriangleAlert,
};

export function StatusBadge({ status, label }: { status: Status; label?: string }) {
  const { t } = useI18n();
  const word = label ?? t(`status.${status}`);
  const meaning = t(`status.${status}Meaning`);
  const meta = statuses[status];
  const Icon = statusIcons[meta.icon];
  const filled = meta.icon === 'check-filled';
  return (
    <span className={`jl-badge jl-badge--${status}`} title={meaning}>
      <Icon
        size={16}
        strokeWidth={2.25}
        aria-hidden
        // Paid = filled check, Approved = outline check: told apart without colour.
        {...(filled ? { fill: 'currentColor', stroke: `var(--jl-status-${status}-soft)` } : {})}
      />
      {word}
    </span>
  );
}

/** Every amount on screen: "RWF 1,500,000", tabular figures. */
export function Money({
  amount,
  variant = 'money',
  className,
}: {
  amount: number;
  variant?: 'money' | 'moneyLarge' | 'display';
  className?: string;
}) {
  const kebab = variant.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const negative = amount < 0;
  return (
    <span className={cx('jl-money', `jl-text-${kebab}`, className)} aria-label={`${negative ? 'minus ' : ''}${Math.abs(amount)} Rwandan francs`}>
      <span className="jl-money__cur">RWF</span>
      {negative ? '−' : ''}
      {groupDigits(Math.abs(Math.round(amount)))}
    </span>
  );
}

export function AmountInput({
  label,
  value,
  onChange,
  hint,
  error,
  placeholder = '0',
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  hint?: string;
  error?: string;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="jl-field">
      <label className="jl-field__label" htmlFor={id}>
        {label}
      </label>
      <div className={cx('jl-amount', error && 'jl-amount--error')}>
        <span className="jl-amount__cur" aria-hidden>
          RWF
        </span>
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          placeholder={placeholder}
          value={value == null ? '' : groupDigits(value)}
          onChange={(e) => onChange(parseAmount(e.target.value))}
          aria-invalid={!!error || undefined}
          aria-describedby={error || hint ? `${id}-help` : undefined}
        />
      </div>
      {(error || hint) && (
        <span id={`${id}-help`} className={error ? 'jl-field__error' : 'jl-field__hint'}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}

const stateIcons = { empty: Inbox, error: TriangleAlert, offline: WifiOff, 'no-permission': Lock } as const;

/** Empty, error, offline and "no permission" states — every screen designs all four. */
export function StateView({
  kind,
  title,
  message,
  action,
}: {
  kind: keyof typeof stateIcons;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  const Icon = stateIcons[kind];
  return (
    <div className={`jl-state jl-state--${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      <span className="jl-state__icon">
        <Icon size={26} aria-hidden />
      </span>
      <h3 className="jl-state__title jl-text-section-title">{title}</h3>
      {message && <p className="jl-state__msg">{message}</p>}
      {action}
    </div>
  );
}

export function OfflineBanner({ pending = 0 }: { pending?: number }) {
  const { t } = useI18n();
  return (
    <div className="jl-banner" role="status">
      <WifiOff size={18} aria-hidden />
      {pending > 0 ? t('states.offlinePending', { count: pending }) : t('states.offline')}
    </div>
  );
}

export function Skeleton({ width = '100%', height = 16 }: { width?: number | string; height?: number }) {
  return <div className="jl-skeleton" style={{ width, height }} aria-hidden />;
}

/** "Updated 5 min ago" — shown under every figure (honest status). */
export function LastUpdated({ at, now }: { at: Date | string; now?: Date }) {
  const { t, locale } = useI18n();
  return (
    <span className="jl-updated">
      <RefreshCw size={12} aria-hidden />
      {t('common.updated', { when: formatUpdatedAgo(t, locale, at, now) })}
    </span>
  );
}

export * from './charts';

import { Check, CircleCheck, Flag, TriangleAlert, Wallet } from 'lucide-react-native';
import { useId, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, Pattern, Rect } from 'react-native-svg';
import { useI18n } from '@jengalink/i18n/react';
import {
  claimSentence,
  claimSteps,
  moneySegments,
  moneySentence,
  ringGeometry,
  ringSentence,
  stageStatusLabel,
  towerLayout,
  towerSentence,
  walletSummary,
  type ClaimInput,
  type MoneyBarInput,
  type RingInput,
  type StageBlockInput,
  type StageStatus,
  type WalletInput,
} from '../charts';
import { radius, spacing } from '../tokens';
import { Money, Text, textStyle, useJengaTheme, type JengaTheme } from './index';

/* Each visual: picture first, exact number beside it, one plain sentence. */

const svgId = (raw: string) => raw.replace(/[^a-zA-Z0-9_-]/g, '');

function Caption({ children }: { children: ReactNode }) {
  return (
    <Text variant="body" muted style={{ marginTop: spacing.sm, fontSize: 14, lineHeight: 20 }}>
      {children}
    </Text>
  );
}

function Hatch({
  id,
  color,
  background,
  lineOpacity = 1,
  size = 6,
}: {
  id: string;
  color: string;
  background?: string;
  lineOpacity?: number;
  size?: number;
}) {
  return (
    <Pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <Rect width={size} height={size} fill={background ?? color} opacity={background ? 1 : 0.28} />
      <Line x1="0" y1="0" x2="0" y2={size} stroke={color} strokeWidth={2.5} opacity={lineOpacity} />
    </Pattern>
  );
}

/* ---------- Progress ring ---------- */

export function ProgressRing({
  accepted,
  reported,
  size = 168,
  label,
}: RingInput & { size?: number; label?: string }) {
  const { t, locale } = useI18n();
  const lang = { t, locale };
  const { colors: c } = useJengaTheme();
  const stroke = Math.round(size * 0.1);
  const g = ringGeometry({ accepted, reported }, size, stroke);
  const hatch = svgId(`ring${useId()}`);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={ringSentence({ accepted, reported }, lang)} style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <Hatch id={hatch} color={c.accent} />
        </Defs>
        <G rotation={-90} origin={`${g.center}, ${g.center}`}>
          <Circle cx={g.center} cy={g.center} r={g.radius} stroke={c.surfaceSunken} strokeWidth={stroke} fill="none" />
          {g.reportedPct > 0 && (
            <Circle
              cx={g.center}
              cy={g.center}
              r={g.radius}
              stroke={`url(#${hatch})`}
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={g.reported.dash}
              strokeDashoffset={g.reported.offset}
            />
          )}
          {g.acceptedPct > 0 && (
            <Circle
              cx={g.center}
              cy={g.center}
              r={g.radius}
              stroke={c.accent}
              strokeWidth={stroke}
              fill="none"
              strokeLinecap={g.acceptedPct < 100 ? 'round' : 'butt'}
              strokeDasharray={g.accepted.dash}
            />
          )}
        </G>
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        {/* Small rings (lists) show just the number, sized to fit inside. */}
        <Text variant={size < 100 ? 'bodyStrong' : 'display'}>{g.acceptedPct}%</Text>
        <Text variant="caption" muted style={size < 100 ? { display: 'none' } : undefined}>
          {label ?? t('charts.accepted')}
        </Text>
      </View>
    </View>
  );
}

export function RingLegend({ accepted, reported }: RingInput) {
  const { t, locale } = useI18n();
  const lang = { t, locale };
  const { colors: c } = useJengaTheme();
  const hatch = svgId(`legend${useId()}`);
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.legendRow}>
        <View style={[styles.swatch, { backgroundColor: c.accent }]} />
        <Text variant="label" muted>
          {t('charts.legendAccepted')} <Text variant="label">{Math.round(accepted)}%</Text>
        </Text>
      </View>
      <View style={styles.legendRow}>
        <Svg width={12} height={12}>
          <Defs>
            <Hatch id={hatch} color={c.accent} />
          </Defs>
          <Rect width={12} height={12} rx={3} fill={`url(#${hatch})`} />
        </Svg>
        <Text variant="label" muted style={{ flexShrink: 1 }}>
          {t('charts.legendReported')} <Text variant="label">{Math.round(reported)}%</Text>
        </Text>
      </View>
    </View>
  );
}

/* ---------- Jenga tower ---------- */

function towerLook(s: StageStatus, theme: JengaTheme) {
  const c = theme.colors;
  switch (s) {
    case 'accepted':
      return { bg: c.primary, border: c.primary, ink: c.onPrimary, dashed: false, hatch: false };
    case 'ready_for_review':
      return { bg: c.primarySoft, border: c.accent, ink: c.ink, dashed: false, hatch: true };
    case 'in_progress':
      return { bg: c.primarySoft, border: c.accent, ink: c.ink, dashed: true, hatch: false };
    case 'blocked':
    case 'changes_required': {
      const p = theme.status('problem');
      return { bg: p.soft, border: p.color, ink: p.color, dashed: false, hatch: false };
    }
    default:
      return { bg: c.surfaceSunken, border: c.borderStrong, ink: c.inkMuted, dashed: true, hatch: false };
  }
}

/**
 * The brand's signature visual: one block per stage, bottom to top. Tap a block to open it.
 * `compact` fits beside the ring on Home: short blocks, status as a symbol, and the
 * whole tower is one 44 px+ target that opens the current stage.
 */
export function JengaTower({
  stages,
  onSelect,
  compact,
}: {
  stages: StageBlockInput[];
  onSelect?: (stageId: string) => void;
  compact?: boolean;
}) {
  const { t, locale } = useI18n();
  const lang = { t, locale };
  const theme = useJengaTheme();
  const [width, setWidth] = useState(compact ? 180 : 320);
  const layout = compact ? towerLayout(stages, width, 28, 4, 10) : towerLayout(stages, width, 48, 6, 16);
  const hatch = svgId(`tower${useId()}`);
  const current = stages.find((s) => s.status !== 'accepted') ?? stages[stages.length - 1];

  const blocks = layout.blocks.map((b) => {
    const look = towerLook(b.status, theme);
    const problem = b.status === 'blocked' || b.status === 'changes_required';
    const symbol = b.status === 'accepted' ? '✓' : problem ? '!' : '';
    const blockStyle = {
      position: 'absolute' as const,
      left: b.x,
      top: b.y,
      width: b.width,
      height: b.height,
      borderRadius: compact ? 7 : 10,
      borderWidth: 1.5,
      borderStyle: look.dashed ? ('dashed' as const) : ('solid' as const),
      borderColor: look.border,
      backgroundColor: look.bg,
      overflow: 'hidden' as const,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      paddingHorizontal: compact ? 8 : 14,
    };
    const inner = (
      <>
        {look.hatch && (
          <Svg style={StyleSheet.absoluteFill}>
            <Defs>
              <Hatch id={hatch} color={theme.colors.accent} background={theme.colors.primarySoft} lineOpacity={0.3} size={10} />
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#${hatch})`} />
          </Svg>
        )}
        <Text
          variant={compact ? 'caption' : 'bodyStrong'}
          color={look.ink}
          numberOfLines={1}
          style={{ flexShrink: 1, fontSize: compact ? 12 : 15, fontFamily: textStyle('bodyStrong').fontFamily }}
        >
          {b.name}
        </Text>
        <Text variant="caption" color={look.ink}>
          {compact ? symbol : `${symbol ? symbol + ' ' : ''}${stageStatusLabel(b.status, lang)}`}
        </Text>
      </>
    );
    if (compact) return <View key={b.id} style={blockStyle}>{inner}</View>;
    return (
      <Pressable
        key={b.id}
        disabled={!onSelect}
        onPress={() => onSelect?.(b.id)}
        accessibilityRole={onSelect ? 'button' : undefined}
        accessibilityLabel={`Stage ${b.index + 1}, ${b.name}: ${stageStatusLabel(b.status, lang)}`}
        style={({ pressed }) => [blockStyle, { opacity: pressed ? 0.85 : 1 }]}
      >
        {inner}
      </Pressable>
    );
  });

  const tower = (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: layout.height }}>
      {blocks}
    </View>
  );

  if (compact) {
    return (
      <Pressable
        disabled={!onSelect || !current}
        onPress={() => current && onSelect?.(current.id)}
        accessibilityRole={onSelect ? 'button' : 'image'}
        accessibilityLabel={`${towerSentence(stages, lang)}${onSelect ? ' Open current stage.' : ''}`}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
        {tower}
      </Pressable>
    );
  }
  return (
    <View accessibilityLabel={towerSentence(stages, lang)}>
      {tower}
      <Caption>{towerSentence(stages, lang)}</Caption>
    </View>
  );
}

/* ---------- Contract money bar ---------- */

export function MoneyBar(input: MoneyBarInput) {
  const { t, locale } = useI18n();
  const lang = { t, locale };
  const theme = useJengaTheme();
  const c = theme.colors;
  const segments = moneySegments(input, lang);
  const fill = {
    paid: theme.status('paid').color,
    approved: theme.status('approved').color,
    remaining: c.surfaceSunken,
  } as const;
  return (
    <View accessible accessibilityLabel={moneySentence(input, lang)}>
      <View style={{ height: 20, borderRadius: 6, overflow: 'hidden', flexDirection: 'row', backgroundColor: c.surfaceSunken }}>
        {segments.map((s) =>
          s.fraction > 0 ? <View key={s.key} style={{ flex: s.fraction, backgroundColor: fill[s.key] }} /> : null,
        )}
      </View>
      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        {segments.map((s) => (
          <View key={s.key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={styles.legendRow}>
              <View
                style={[
                  styles.swatch,
                  { backgroundColor: fill[s.key] },
                  s.key === 'remaining' && { borderWidth: 1, borderColor: c.borderStrong },
                ]}
              />
              <Text muted>{s.label}</Text>
            </View>
            <Money amount={s.amount} />
          </View>
        ))}
      </View>
      <Caption>{moneySentence(input, lang)}</Caption>
    </View>
  );
}

/* ---------- Payment claim step tracker ---------- */

export function ClaimTracker(claim: ClaimInput) {
  const { t, locale } = useI18n();
  const lang = { t, locale };
  const theme = useJengaTheme();
  const c = theme.colors;
  const steps = claimSteps(claim, lang);
  const paid = theme.status('paid');
  const waiting = theme.status('waiting');
  const problem = theme.status('problem');
  return (
    <View accessible accessibilityLabel={claimSentence(claim, lang)}>
      <View style={{ flexDirection: 'row' }}>
        {steps.map((s, i) => {
          const done = s.state === 'done';
          const disputed = s.state === 'disputed';
          const dotBg = done ? paid.color : disputed ? problem.color : c.surface;
          const dotBorder = done ? paid.color : disputed ? problem.color : s.state === 'current' ? waiting.color : c.borderStrong;
          return (
            <View key={s.key} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              {i > 0 && (
                <View
                  style={{
                    position: 'absolute',
                    top: 13,
                    right: '50%',
                    width: '100%',
                    height: 3,
                    backgroundColor: done || disputed ? paid.color : c.border,
                  }}
                />
              )}
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: radius.pill,
                  borderWidth: 2,
                  borderColor: dotBorder,
                  backgroundColor: dotBg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  ...(s.state === 'current' ? { shadowColor: waiting.color, shadowOpacity: 0.4, shadowRadius: 4 } : null),
                }}
              >
                {done && <Check size={16} strokeWidth={3} color={c.surface} />}
                {disputed && <Flag size={14} strokeWidth={2.5} color={c.surface} />}
              </View>
              <Text variant={s.state === 'upcoming' ? 'label' : 'bodyStrong'} muted={s.state === 'upcoming'} style={{ fontSize: 14, marginTop: 4 }}>
                {s.label}
              </Text>
              <Text variant="caption" color={disputed ? problem.color : c.inkMuted}>
                {disputed ? t('status.disputed') : (s.date ?? '—')}
              </Text>
            </View>
          );
        })}
      </View>
      <Caption>{claimSentence(claim, lang)}</Caption>
    </View>
  );
}

/* ---------- Site float wallet card ---------- */

export function WalletCard({ expected, counted, custodian }: WalletInput & { custodian?: string }) {
  const { t, locale } = useI18n();
  const lang = { t, locale };
  const theme = useJengaTheme();
  const c = theme.colors;
  const w = walletSummary({ expected, counted }, lang);
  const tone = w.balanced ? theme.status('paid') : theme.status('waiting');
  const row = { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 } as const;
  return (
    <View accessible accessibilityLabel={`${t('charts.walletTitle')}. ${w.sentence}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.structureSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Wallet size={20} color={c.structure} />
        </View>
        <View>
          <Text variant="bodyStrong">{t('charts.walletTitle')}</Text>
          {custodian && (
            <Text variant="caption" muted>
              {t('charts.walletHeldBy', { name: custodian })}
            </Text>
          )}
        </View>
      </View>
      <View style={row}>
        <Text muted>{t('charts.walletExpected')}</Text>
        <Money amount={expected} />
      </View>
      <View style={[row, { borderTopWidth: 1, borderTopColor: c.border }]}>
        <Text muted>{t('charts.walletCounted')}</Text>
        <Money amount={counted} />
      </View>
      <View
        style={[
          row,
          w.balanced
            ? { borderTopWidth: 1, borderTopColor: c.border }
            : { marginTop: 4, paddingHorizontal: 12, borderRadius: 10, backgroundColor: tone.soft },
        ]}
      >
        <View style={styles.legendRow}>
          {w.balanced ? <CircleCheck size={16} color={tone.color} /> : <TriangleAlert size={16} color={tone.color} />}
          <Text variant="bodyStrong" color={tone.color}>
            {w.balanced ? t('charts.walletDifference') : t('charts.walletToExplain')}
          </Text>
        </View>
        <Money amount={w.difference} color={tone.color} />
      </View>
      <Caption>{w.sentence}</Caption>
    </View>
  );
}

const styles = StyleSheet.create({
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 12, height: 12, borderRadius: 3 },
});

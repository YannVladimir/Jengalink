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
import { request } from '@jengalink/contracts/client';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf, radius, spacing } from '@jengalink/ui';
import { AmountInput, Button, Card, Text, useJengaTheme } from '@jengalink/ui/native';
import { useLocalSearchParams } from 'expo-router';
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  MessageSquare,
  Lock,
  Minus,
  Plus,
  Trash2,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DatePickerSheet, fromIsoDate } from '@/components/DatePickerSheet';
import { BottomAction } from '@/components/ui';
import { ApiError, api, useAuth } from '@/lib/auth';

let nextKey = 0;
const newKey = () => `new-${++nextKey}`;

/**
 * Stage plan (Phase 3): each stage's share of the job, planned dates and the
 * checks the owner will use to accept it. The whole plan saves in one step,
 * so the shares always total 100%.
 */
export default function StagePlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();

  const [plan, setPlan] = useState<StagePlan | null>(null);
  const [draft, setDraft] = useState<PlanDraftStage[]>([]);
  const [value, setValue] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

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
    setSavedAt(null);
    setDraft((d) => d.map((s) => (s.key === key ? { ...s, ...change } : s)));
  };

  const save = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await withRefresh(() =>
        request(() =>
          api.PUT('/v1/projects/{id}/plan', {
            params: { path: { id }, header: { 'If-Match': `"${plan.revision}"` } },
            body: planDraftToRequest(draft, value),
          }),
        ),
      );
      apply(saved);
      setSavedAt(Date.now());
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) setConflict(true);
      else setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  if (loadFailed)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.background }}>
        <Text muted>{t('common.somethingWrong')}</Text>
        <Button title={t('common.tryAgain')} variant="secondary" onPress={reload} />
      </View>
    );
  if (!plan)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );

  const totalOk = problems.total === 100;
  const tone = status(totalOk ? 'paid' : 'problem');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: spacing.xs }}>
          <Text variant="screenTitle">{t('plan.title')}</Text>
          <Text muted>{t('plan.lead')}</Text>
        </View>

        {!editable && (
          <Card>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Lock size={18} color={colors.inkMuted} style={{ marginTop: 2 }} />
              <Text muted style={{ flex: 1 }}>
                {plan.locked && plan.latestDecision?.decision === 'accepted'
                  ? t('accept.acceptedBanner', {
                      name: plan.latestDecision.decidedByName ?? t('invite.someone'),
                      date: formatDate(locale, plan.latestDecision.decidedAt),
                    })
                  : plan.locked
                    ? t('plan.lockedNote')
                    : t('plan.readOnlyNote')}
              </Text>
            </View>
          </Card>
        )}

        {!plan.locked && plan.latestDecision?.decision === 'changes_requested' && (
          <View style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: status('waiting').soft }}>
            <MessageSquare size={18} color={status('waiting').color} style={{ marginTop: 2 }} />
            <Text style={{ flex: 1 }}>
              {t('accept.askedChanges', {
                name: plan.latestDecision.decidedByName ?? t('invite.someone'),
                note: plan.latestDecision.note ?? '',
              })}
            </Text>
          </View>
        )}

        {editable ? (
          <Card>
            <AmountInput label={t('wizard.valueLabel')} value={value} onChange={setValue} />
            <Text variant="caption" muted style={{ marginTop: spacing.xs }}>
              {value === null ? t('accept.noValue') : t('accept.waitingOwner')}
            </Text>
          </Card>
        ) : (
          <Card>
            <Text variant="label" muted>
              {t('accept.valueLabel')}
            </Text>
            <Text variant="sectionTitle">{plan.contractValue !== null ? formatRwf(plan.contractValue) : t('accept.noValue')}</Text>
          </Card>
        )}

        {editable && (
          <View
            accessibilityLiveRegion="polite"
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: tone.soft }}
          >
            {totalOk ? <Check size={18} color={tone.color} /> : <CircleAlert size={18} color={tone.color} />}
            <Text variant="label" color={tone.color} style={{ flex: 1 }}>
              {totalOk ? t('plan.totalOk') : t('plan.totalOff', { total: problems.total })}
            </Text>
            {!totalOk && draft.length > 0 && <Button title={t('plan.evenOut')} variant="secondary" onPress={() => setDraft(spreadTo100(draft))} />}
          </View>
        )}

        {draft.map((s, i) => (
          <StageCard
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

        {editable && draft.length < MAX_STAGES && (
          <Button
            title={t('wizard.addStage')}
            icon={Plus}
            variant="secondary"
            onPress={() => {
              const key = newKey();
              setDraft([...draft, { key, name: t('wizard.newStageName'), weight: 0, description: '', plannedStart: null, plannedEnd: null, criteria: [] }]);
              setOpen(key);
            }}
          />
        )}

        {conflict && (
          <Card>
            <Text>{t('plan.conflict')}</Text>
            <View style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
              <Button title={t('plan.reload')} variant="secondary" onPress={reload} />
            </View>
          </Card>
        )}
        {error && (
          <Text variant="caption" color={status('problem').color}>
            {error}
          </Text>
        )}
      </ScrollView>

      {editable && (
        <BottomAction>
          <View style={{ gap: spacing.xs }}>
            <Text variant="caption" muted style={{ textAlign: 'center' }}>
              {savedAt && !dirty ? t('plan.saved') : dirty ? t('plan.unsaved') : ' '}
            </Text>
            <Button
              title={busy ? t('plan.saving') : t('plan.save')}
              size="lg"
              block
              loading={busy}
              disabled={!dirty || !problems.ok || conflict}
              onPress={() => void save()}
            />
          </View>
        </BottomAction>
      )}
    </SafeAreaView>
  );
}

function StageCard({
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
  const { colors, status } = useJengaTheme();
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const [criterion, setCriterion] = useState('');
  const fmt = (iso: string) => formatDate(locale, fromIsoDate(iso));
  const dates =
    s.plannedStart || s.plannedEnd ? [s.plannedStart ? fmt(s.plannedStart) : '…', s.plannedEnd ? fmt(s.plannedEnd) : '…'].join(' – ') : t('plan.noDates');
  const input = {
    color: colors.ink,
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  } as const;
  const addCriterion = () => {
    const text = criterion.trim();
    if (text.length < 3 || s.criteria.length >= MAX_CRITERIA) return;
    onChange({ criteria: [...s.criteria, text] });
    setCriterion('');
  };

  return (
    <Card flush>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg }}
      >
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.structureSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="label" color={colors.structure}>
            {index + 1}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {s.name || '…'}
          </Text>
          <Text variant="caption" muted numberOfLines={1}>
            {dates} · {s.criteria.length ? t('plan.criteriaCount', { count: s.criteria.length }) : t('plan.noCriteria')}
          </Text>
        </View>
        <Text variant="bodyStrong">{s.weight}%</Text>
        {open ? <ChevronUp size={18} color={colors.inkSubtle} /> : <ChevronDown size={18} color={colors.inkSubtle} />}
      </Pressable>

      {open && (
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
          {editable && (
            <View style={{ gap: 6 }}>
              <Text variant="label">{t('plan.stageName')}</Text>
              <TextInput accessibilityLabel={t('plan.stageName')} value={s.name} maxLength={80} onChangeText={(name) => onChange({ name })} style={{ ...input, height: 48 }} />
            </View>
          )}

          <View style={{ gap: 6 }}>
            <Text variant="label">{t('plan.share')}</Text>
            {editable ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Stepper icon={Minus} label={t('plan.decrease', { name: s.name })} onPress={() => onChange({ weight: clampWeight(s.weight - 5) })} />
                <TextInput
                  accessibilityLabel={t('plan.share')}
                  keyboardType="number-pad"
                  value={String(s.weight)}
                  onChangeText={(v) => onChange({ weight: clampWeight(Number(v.replace(/\D/g, ''))) })}
                  style={{ ...input, height: 48, width: 72, textAlign: 'center' }}
                />
                <Text variant="bodyStrong">%</Text>
                <Stepper icon={Plus} label={t('plan.increase', { name: s.name })} onPress={() => onChange({ weight: clampWeight(s.weight + 5) })} />
              </View>
            ) : (
              <Text>{t('wizard.stageShare', { weight: s.weight })}</Text>
            )}
          </View>

          <View style={{ gap: 6 }}>
            <Text variant="label">{t('plan.dates')}</Text>
            {editable ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {(['start', 'end'] as const).map((which) => {
                  const value = which === 'start' ? s.plannedStart : s.plannedEnd;
                  return (
                    <Pressable
                      key={which}
                      onPress={() => setPicking(which)}
                      accessibilityRole="button"
                      accessibilityLabel={`${t(which === 'start' ? 'plan.start' : 'plan.end')}: ${value ? fmt(value) : t('plan.pickDate')}`}
                      style={{
                        flex: 1,
                        minHeight: 56,
                        padding: spacing.sm,
                        borderRadius: radius.md,
                        borderWidth: 1.5,
                        borderColor: which === 'end' && badDates ? status('problem').color : colors.borderStrong,
                        backgroundColor: colors.surface,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: spacing.sm,
                      }}
                    >
                      <CalendarDays size={18} color={colors.inkMuted} />
                      <View style={{ flex: 1 }}>
                        <Text variant="caption" muted>
                          {t(which === 'start' ? 'plan.start' : 'plan.end')}
                        </Text>
                        <Text variant="label" color={value ? colors.ink : colors.inkSubtle}>
                          {value ? fmt(value) : t('plan.pickDate')}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text>{dates}</Text>
            )}
            {badDates && (
              <Text variant="caption" color={status('problem').color}>
                {t('plan.endBeforeStart')}
              </Text>
            )}
          </View>

          <View style={{ gap: 6 }}>
            <Text variant="label">{t('plan.description')}</Text>
            {editable ? (
              <TextInput
                accessibilityLabel={t('plan.description')}
                value={s.description}
                onChangeText={(description) => onChange({ description })}
                placeholder={t('plan.descriptionPlaceholder')}
                placeholderTextColor={colors.inkSubtle}
                multiline
                maxLength={500}
                style={{ ...input, minHeight: 72, paddingVertical: spacing.sm, textAlignVertical: 'top' }}
              />
            ) : (
              <Text muted={!s.description}>{s.description || '—'}</Text>
            )}
          </View>

          <View style={{ gap: 6 }}>
            <Text variant="label">{t('plan.criteriaTitle')}</Text>
            {editable && (
              <Text variant="caption" muted>
                {t('plan.criteriaHint')}
              </Text>
            )}
            {s.criteria.length === 0 && !editable && <Text muted>{t('plan.noCriteria')}</Text>}
            {s.criteria.map((c, ci) => (
              <View key={`${ci}-${c}`} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 }}>
                <Check size={16} color={status('paid').color} />
                <Text style={{ flex: 1 }}>{c}</Text>
                {editable && (
                  <Pressable
                    onPress={() => onChange({ criteria: s.criteria.filter((_, j) => j !== ci) })}
                    accessibilityRole="button"
                    accessibilityLabel={t('plan.removeCriterion', { text: c })}
                    hitSlop={8}
                    style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <X size={18} color={colors.inkMuted} />
                  </Pressable>
                )}
              </View>
            ))}
            {editable && s.criteria.length < MAX_CRITERIA && (
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TextInput
                  accessibilityLabel={t('plan.criteriaPlaceholder')}
                  value={criterion}
                  onChangeText={setCriterion}
                  onSubmitEditing={addCriterion}
                  placeholder={t('plan.criteriaPlaceholder')}
                  placeholderTextColor={colors.inkSubtle}
                  maxLength={160}
                  returnKeyType="done"
                  style={{ ...input, flex: 1, minWidth: 0, height: 48 }}
                />
                <Stepper icon={Plus} label={t('plan.addCriterion')} disabled={criterion.trim().length < 3} onPress={addCriterion} />
              </View>
            )}
          </View>

          {editable && (
            <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
              <Stepper icon={ArrowUp} label={t('plan.moveUp', { name: s.name })} disabled={index === 0} onPress={() => onMove(-1)} />
              <Stepper icon={ArrowDown} label={t('plan.moveDown', { name: s.name })} disabled={index === count - 1} onPress={() => onMove(1)} />
              <View style={{ flex: 1 }} />
              {count > 1 && <Button title={t('plan.removeStage')} icon={Trash2} variant="ghost" onPress={onRemove} accessibilityHint={s.name} />}
            </View>
          )}
        </View>
      )}

      <DatePickerSheet
        visible={picking !== null}
        title={t(picking === 'end' ? 'plan.end' : 'plan.start')}
        value={picking === 'end' ? s.plannedEnd : s.plannedStart}
        min={picking === 'end' ? s.plannedStart : null}
        onPick={(iso) => {
          if (picking === 'start') onChange({ plannedStart: iso, ...(s.plannedEnd && s.plannedEnd < iso ? { plannedEnd: null } : {}) });
          else onChange({ plannedEnd: iso });
          setPicking(null);
        }}
        onClear={() => {
          onChange(picking === 'start' ? { plannedStart: null } : { plannedEnd: null });
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </Card>
  );
}

function Stepper({ icon: Icon, label, onPress, disabled }: { icon: typeof Plus; label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useJengaTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
        borderColor: colors.borderStrong,
        backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Icon size={18} color={colors.ink} />
    </Pressable>
  );
}

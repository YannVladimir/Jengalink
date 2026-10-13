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
import { request } from '@jengalink/contracts/client';
import type { MessageKey } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf, radius, spacing } from '@jengalink/ui';
import { AmountInput, Button, Card, Text, useJengaTheme } from '@jengalink/ui/native';
import { router } from 'expo-router';
import {
  Building2,
  Check,
  ChevronRight,
  Construction,
  Hammer,
  House,
  ListChecks,
  type LucideIcon,
  MapPin,
  Plus,
  Search,
  Store,
  UserPlus,
  X,
} from 'lucide-react-native';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomAction } from '@/components/ui';
import { ApiError, api, useAuth } from '@/lib/auth';

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

/**
 * Contractor project wizard (Phase 3): name and type, site location
 * (province → village), contract value in RWF, stages from a template.
 * The project starts as a draft; the owner is invited next.
 */
export default function NewProjectScreen() {
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const { colors, status } = useJengaTheme();

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

  // A company workspace owns the project; ask for one only if the user has none.
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

  // Template stages in the user's language; a new type starts a fresh list.
  const goStages = () => {
    if (stagesFor !== type) {
      setStages(stageTemplates[type].map((s) => ({ name: t(`stageTemplate.${s.key}` as MessageKey), weight: s.weight })));
      setStagesFor(type);
    }
    setStep('stages');
  };

  const next = () => {
    setError(null);
    const to = steps[index + 1];
    if (to === 'stages') goStages();
    else if (to) setStep(to);
  };
  const back = () => {
    setError(null);
    if (index > 0) setStep(steps[index - 1]);
    else router.back();
  };

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

  if (created) return <Done project={created} />;

  if (!orgs)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        <StepBar index={index} total={steps.length} />

        {step === 'company' && (
          <Section title={t('wizard.companyTitle')} lead={t('wizard.companyLead')}>
            <Field label={t('wizard.companyLabel')} value={company} onChange={setCompany} placeholder={t('wizard.companyPlaceholder')} autoFocus />
          </Section>
        )}

        {step === 'basics' && (
          <Section title={t('wizard.basicsTitle')}>
            <Field label={t('wizard.nameLabel')} value={name} onChange={setName} placeholder={t('wizard.namePlaceholder')} />
            <Text variant="label">{t('wizard.typeLabel')}</Text>
            <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
              {projectTypes.map((pt) => (
                <TypeOption key={pt} type={pt} selected={pt === type} onPress={() => setType(pt)} />
              ))}
            </View>
          </Section>
        )}

        {step === 'location' && (
          <Section title={t('wizard.locationTitle')} lead={t('wizard.locationLead')}>
            <LocationPicker value={location} onChange={setLocation} />
          </Section>
        )}

        {step === 'value' && (
          <Section title={t('wizard.valueTitle')} lead={t('wizard.valueLead')}>
            <AmountInput label={t('wizard.valueLabel')} value={value} onChange={setValue} />
            <Button title={t('wizard.valueSkip')} variant="ghost" onPress={() => { setValue(null); next(); }} />
            <Text variant="caption" muted>
              {t('wizard.moneyNote')}
            </Text>
          </Section>
        )}

        {step === 'stages' && (
          <Section title={t('wizard.stagesTitle')} lead={t('wizard.stagesLead')}>
            <StageList stages={stages} onChange={setStages} />
            <Text variant="caption" muted>
              {t('wizard.stagesLater')}
            </Text>
          </Section>
        )}

        {step === 'review' && (
          <Section title={t('wizard.reviewTitle')}>
            <Card flush>
              <ReviewRow label={t('wizard.reviewName')} value={name} onEdit={() => setStep('basics')} />
              <ReviewRow label={t('wizard.reviewType')} value={t(`projectType.${type}`)} onEdit={() => setStep('basics')} />
              <ReviewRow label={t('wizard.reviewLocation')} value={placeText(location, t)} onEdit={() => setStep('location')} />
              <ReviewRow
                label={t('wizard.reviewValue')}
                value={value ? formatRwf(value) : t('wizard.notSet')}
                onEdit={() => setStep('value')}
              />
              <ReviewRow
                label={t('wizard.reviewStages')}
                value={t('wizard.stagesCount', { count: stages.length })}
                onEdit={() => setStep('stages')}
                last
              />
            </Card>
            <Text variant="caption" muted>
              {t('wizard.moneyNote')}
            </Text>
          </Section>
        )}

        {error && (
          <Text variant="caption" color={status('problem').color} alert>
            {error}
          </Text>
        )}
      </ScrollView>

      <BottomAction>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button title={t('common.back')} variant="secondary" size="lg" onPress={back} />
          <View style={{ flex: 1 }}>
            {step === 'review' ? (
              <Button title={busy ? t('wizard.creating') : t('wizard.create')} size="lg" block loading={busy} onPress={create} />
            ) : (
              <Button title={t('common.continue')} size="lg" block disabled={!canContinue} onPress={next} />
            )}
          </View>
        </View>
      </BottomAction>
    </SafeAreaView>
  );
}

/** "Niboye, Kicukiro, Kigali City" from the deepest level up. */
function placeText(loc: ProjectLocation, t: ReturnType<typeof useI18n>['t']) {
  const parts = locationLevels
    .map((l) => (l === 'province' && loc.province ? provinceName(loc.province, t) : loc[l]))
    .filter(Boolean);
  return parts.length ? parts.reverse().join(', ') : t('wizard.notSet');
}

function provinceName(name: string, t: ReturnType<typeof useI18n>['t']) {
  const k = provinceKeys[name];
  return k ? t(`province.${k}`) : name;
}

function StepBar({ index, total }: { index: number; total: number }) {
  const { colors } = useJengaTheme();
  const { t } = useI18n();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="caption" muted>
        {t('wizard.stepOf', { step: index + 1, total })}
      </Text>
      <View style={{ flexDirection: 'row', gap: 4 }} accessibilityElementsHidden>
        {Array.from({ length: total }, (_, i) => (
          <View
            key={i}
            style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= index ? colors.primary : colors.border }}
          />
        ))}
      </View>
    </View>
  );
}

function Section({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ gap: spacing.xs }}>
        <Text variant="screenTitle">{title}</Text>
        {lead && <Text muted>{lead}</Text>}
      </View>
      {children}
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { colors } = useJengaTheme();
  const { t } = useI18n();
  const tooShort = value.length > 0 && value.trim().length < 2;
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.inkSubtle}
        autoFocus={autoFocus}
        maxLength={120}
        style={{
          height: 56,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.md,
          borderWidth: 1.5,
          borderColor: colors.borderStrong,
          backgroundColor: colors.surface,
          color: colors.ink,
          fontSize: 17,
          fontFamily: 'Inter_500Medium',
          outlineWidth: 0,
        }}
      />
      {tooShort && (
        <Text variant="caption" muted>
          {t('wizard.nameTooShort')}
        </Text>
      )}
    </View>
  );
}

function TypeOption({ type, selected, onPress }: { type: ProjectType; selected: boolean; onPress: () => void }) {
  const { colors } = useJengaTheme();
  const { t } = useI18n();
  const Icon = typeIcons[type];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      aria-checked={selected}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: 64,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.md,
        borderWidth: 1.5,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primarySoft : pressed ? colors.surfaceSunken : colors.surface,
      })}
    >
      <Icon size={24} color={selected ? colors.primary : colors.inkMuted} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" color={selected ? colors.primary : colors.ink}>
          {t(`projectType.${type}`)}
        </Text>
        <Text variant="caption" muted>
          {t(`projectTypeHint.${type}`)}
        </Text>
      </View>
      {selected && <Check size={20} color={colors.primary} />}
    </Pressable>
  );
}

/** Province → district → sector → cell → village, each chosen from the official list. */
function LocationPicker({ value, onChange }: { value: ProjectLocation; onChange: (v: ProjectLocation) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<LocationLevel | null>(null);
  const depth = locationLevels.findIndex((l) => !value[l]);
  const reachable = depth === -1 ? locationLevels.length : depth + 1;

  const choose = (level: LocationLevel, option: string) => {
    // Changing a level clears the levels below it.
    const i = locationLevels.indexOf(level);
    const nextValue: ProjectLocation = {};
    locationLevels.slice(0, i).forEach((l) => (nextValue[l] = value[l]));
    nextValue[level] = option;
    onChange(nextValue);
    setOpen(null);
  };

  return (
    <Card flush>
      {locationLevels.map((level, i) => {
        const chosen = value[level];
        const enabled = i < reachable;
        return (
          <PickerRow
            key={level}
            label={t(`location.${level}`)}
            value={chosen ? (level === 'province' ? provinceName(chosen, t) : chosen) : undefined}
            enabled={enabled}
            onPress={() => setOpen(level)}
            last={i === locationLevels.length - 1}
          />
        );
      })}
      {open && (
        <OptionSheet
          level={open}
          parents={Object.fromEntries(locationLevels.slice(0, locationLevels.indexOf(open)).map((l) => [l, value[l]]))}
          onClose={() => setOpen(null)}
          onChoose={(o) => choose(open, o)}
        />
      )}
    </Card>
  );
}

function PickerRow({
  label,
  value,
  enabled,
  onPress,
  last,
}: {
  label: string;
  value?: string;
  enabled: boolean;
  onPress: () => void;
  last?: boolean;
}) {
  const { colors } = useJengaTheme();
  const { t } = useI18n();
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? t('wizard.choose')}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: 60,
        paddingHorizontal: spacing.lg,
        opacity: enabled ? 1 : 0.4,
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      })}
    >
      <MapPin size={18} color={value ? colors.primary : colors.inkMuted} />
      <View style={{ flex: 1 }}>
        <Text variant="caption" muted>
          {label}
        </Text>
        <Text variant="bodyStrong" color={value ? colors.ink : colors.inkSubtle}>
          {value ?? t('wizard.choose')}
        </Text>
      </View>
      <ChevronRight size={18} color={colors.inkMuted} />
    </Pressable>
  );
}

/** Full-screen list with search; options come from the API one level at a time. */
function OptionSheet({
  level,
  parents,
  onClose,
  onChoose,
}: {
  level: LocationLevel;
  parents: Partial<Record<LocationLevel, string>>;
  onClose: () => void;
  onChoose: (option: string) => void;
}) {
  const { colors, status } = useJengaTheme();
  const { t } = useI18n();
  const { withRefresh } = useAuth();
  const [options, setOptions] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void withRefresh(() =>
      request(() =>
        api.GET('/v1/locations/rw', {
          params: { query: { province: parents.province, district: parents.district, sector: parents.sector, cell: parents.cell } },
        }),
      ),
    )
      .then((r) => setOptions(r.options))
      .catch(() => setFailed(true));
  }, [withRefresh, parents.province, parents.district, parents.sector, parents.cell]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (options ?? []).filter((o) => !q || o.toLowerCase().includes(q));
  }, [options, query]);
  const label = (o: string) => (level === 'province' ? provinceName(o, t) : o);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md }}>
          <Text variant="sectionTitle" style={{ flex: 1 }}>
            {t(`location.${level}`)}
          </Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.cancel')} hitSlop={12}>
            <X size={24} color={colors.ink} />
          </Pressable>
        </View>
        {(options?.length ?? 0) > 8 && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              marginHorizontal: spacing.lg,
              marginBottom: spacing.sm,
              paddingHorizontal: spacing.md,
              height: 48,
              borderRadius: radius.md,
              borderWidth: 1.5,
              borderColor: colors.borderStrong,
              backgroundColor: colors.surface,
            }}
          >
            <Search size={18} color={colors.inkMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('wizard.search')}
              placeholderTextColor={colors.inkSubtle}
              autoFocus
              style={{ flex: 1, color: colors.ink, fontSize: 16, outlineWidth: 0 }}
            />
          </View>
        )}
        {failed ? (
          <Text color={status('problem').color} style={{ padding: spacing.lg }}>
            {t('common.noConnection')}
          </Text>
        ) : !options ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : (
          <FlatList
            data={shown}
            keyExtractor={(o) => o}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text muted style={{ padding: spacing.lg }}>
                {t('wizard.noMatches')}
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onChoose(item)}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  minHeight: 52,
                  justifyContent: 'center',
                  paddingHorizontal: spacing.lg,
                  backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                })}
              >
                <Text variant="bodyStrong">{label(item)}</Text>
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

/** Template stages: rename in place, remove, add; shares always total 100%. */
function StageList({ stages, onChange }: { stages: StageDraft[]; onChange: (s: StageDraft[]) => void }) {
  const { colors } = useJengaTheme();
  const { t } = useI18n();
  return (
    <View style={{ gap: spacing.sm }}>
      <Card flush>
        {stages.map((s, i) => (
          <View
            key={i}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              minHeight: 64,
              paddingLeft: spacing.lg,
              paddingRight: spacing.sm,
              borderBottomWidth: i === stages.length - 1 ? 0 : 1,
              borderBottomColor: colors.border,
            }}
          >
            <Text variant="label" muted style={{ width: 22 }}>
              {i + 1}
            </Text>
            <View style={{ flex: 1 }}>
              <TextInput
                accessibilityLabel={`${t('wizard.renameStage')} ${i + 1}`}
                value={s.name}
                onChangeText={(name) => onChange(stages.map((x, j) => (j === i ? { ...x, name } : x)))}
                maxLength={80}
                style={{ color: colors.ink, fontSize: 16, fontFamily: 'Inter_600SemiBold', paddingVertical: 4, outlineWidth: 0 }}
              />
              <Text variant="caption" muted>
                {t('wizard.stageShare', { weight: s.weight })}
              </Text>
            </View>
            {stages.length > 1 && (
              <Pressable
                onPress={() => onChange(withStageRemoved(stages, i))}
                accessibilityRole="button"
                accessibilityLabel={t('wizard.removeStage', { name: s.name })}
                hitSlop={8}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={20} color={colors.inkMuted} />
              </Pressable>
            )}
          </View>
        ))}
      </Card>
      {stages.length < 30 && (
        <Button
          title={t('wizard.addStage')}
          icon={Plus}
          variant="secondary"
          onPress={() => onChange(withStageAdded(stages, t('wizard.newStageName')))}
        />
      )}
    </View>
  );
}

function ReviewRow({ label, value, onEdit, last }: { label: string; value: string; onEdit: () => void; last?: boolean }) {
  const { colors } = useJengaTheme();
  const { t } = useI18n();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: 60,
        paddingLeft: spacing.lg,
        paddingRight: spacing.sm,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text variant="caption" muted>
          {label}
        </Text>
        <Text variant="bodyStrong">{value}</Text>
      </View>
      <Button title={t('wizard.edit')} variant="ghost" onPress={onEdit} accessibilityHint={label} />
    </View>
  );
}

function Done({ project }: { project: ProjectSummary }) {
  const { colors, status } = useJengaTheme();
  const { t } = useI18n();
  const ok = status('paid');
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1, padding: spacing.xl, gap: spacing.lg, justifyContent: 'center' }}>
        <View
          style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: ok.soft }}
        >
          <Check size={32} color={ok.color} />
        </View>
        <Text variant="screenTitle">{t('wizard.doneTitle')}</Text>
        <Text muted>{t('wizard.doneLead', { name: project.name })}</Text>
        <Button
          title={t('invite.inviteOwner')}
          icon={UserPlus}
          size="lg"
          block
          onPress={() => router.replace({ pathname: '/project/[id]/invite', params: { id: project.id } })}
        />
        <Button
          title={t('plan.planStages')}
          icon={ListChecks}
          variant="secondary"
          size="lg"
          block
          onPress={() => router.replace({ pathname: '/project/[id]/plan', params: { id: project.id } })}
        />
        <Button title={t('invite.later')} variant="ghost" size="lg" block onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

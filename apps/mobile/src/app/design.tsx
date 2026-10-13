import { statuses, spacing, type StageBlockInput, type Status } from '@jengalink/ui';
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
  useJengaTheme,
  ProgressRing,
  RingLegend,
  JengaTower,
  MoneyBar,
  ClaimTracker,
  WalletCard,
} from '@jengalink/ui/native';
import { Camera, Check } from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const sampleStages: StageBlockInput[] = [
  { id: 's1', name: 'Foundation', status: 'accepted' },
  { id: 's2', name: 'Ground floor walls', status: 'accepted' },
  { id: 's3', name: 'Ground floor slab', status: 'accepted' },
  { id: 's4', name: 'First floor walls', status: 'ready_for_review' },
  { id: 's5', name: 'Roof structure', status: 'in_progress' },
  { id: 's6', name: 'Roofing sheets', status: 'planned' },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: spacing.md }}>
      <Text variant="sectionTitle">{title}</Text>
      {children}
    </View>
  );
}

/** Component gallery (More → Design system). */
export default function DesignSystemScreen() {
  const { colors } = useJengaTheme();
  const [amount, setAmount] = useState<number | null>(1500000);
  const [updatedAt] = useState(() => new Date(Date.now() - 5 * 60_000));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: 120 }}>
        <View style={{ gap: spacing.xs }}>
          <Text variant="caption" muted>
            JENGALINK · DESIGN SYSTEM
          </Text>
          <Text variant="screenTitle">Components</Text>
        </View>

        <Section title="Status">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {(Object.keys(statuses) as Status[]).map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </View>
        </Section>

        <Section title="Progress">
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
              <ProgressRing accepted={42} reported={14} size={136} />
              <View style={{ flex: 1 }}>
                <RingLegend accepted={42} reported={14} />
              </View>
            </View>
          </Card>
        </Section>

        <Section title="Stages">
          <Card>
            <JengaTower stages={sampleStages} onSelect={() => {}} />
          </Card>
        </Section>

        <Section title="Contract money">
          <Card>
            <MoneyBar contract={48_500_000} paid={18_400_000} approvedUnpaid={6_200_000} />
          </Card>
        </Section>

        <Section title="Claim tracker">
          <Card>
            <ClaimTracker requestedAt="2026-10-01T09:00:00Z" approvedAt="2026-10-03T15:00:00Z" />
          </Card>
        </Section>

        <Section title="Site float">
          <Card>
            <WalletCard expected={420_000} counted={405_000} custodian="Jean" />
          </Card>
        </Section>

        <Section title="Payment claim">
          <Card title="Claim #4" action={<StatusBadge status="waiting" />}>
            <Text variant="label" muted>
              Ground floor slab · Stage 3
            </Text>
            <View style={{ marginTop: spacing.sm, marginBottom: spacing.xs }}>
              <Money amount={6_200_000} variant="moneyLarge" />
            </View>
            <LastUpdated at={updatedAt} />
          </Card>
        </Section>

        <Section title="Buttons">
          <Button title="Approve payment" size="lg" block icon={Check} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Button title="Add photos" variant="secondary" icon={Camera} />
            <Button title="View photos" variant="ghost" />
            <Button title="Sending" loading />
          </View>
        </Section>

        <Section title="Amount">
          <AmountInput
            label="Amount requested"
            value={amount}
            onChange={setAmount}
            hint="Groups digits as you type"
          />
        </Section>

        <Section title="States">
          <OfflineBanner pending={3} />
          <Card>
            <StateView
              kind="empty"
              title="No updates yet"
              message="Updates from the site will appear here with their photos."
            />
          </Card>
          <Card>
            <View style={{ gap: spacing.sm }}>
              <Skeleton width="40%" height={14} />
              <Skeleton width="70%" height={28} />
              <Skeleton height={12} />
            </View>
          </Card>
        </Section>
      </ScrollView>

      {/* One main action per screen, pinned within thumb reach. */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: spacing.lg,
          paddingBottom: spacing.xl,
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <Button title="Review payment claim" size="lg" block />
      </View>
    </SafeAreaView>
  );
}

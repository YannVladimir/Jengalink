import { formatDuration } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf, spacing } from '@jengalink/ui';
import {
  Button,
  Card,
  ClaimTracker,
  Money,
  StateView,
  StatusBadge,
  Text,
  useJengaTheme,
} from '@jengalink/ui/native';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PhotoTile } from '@/components/PhotoTile';
import { SlideToApprove } from '@/components/SlideToApprove';
import { AmountLine, BottomAction } from '@/components/ui';
import { findClaim, findStage } from '@/lib/demo';
import { claimBadge } from '@/lib/labels';
import { useRole } from '@/lib/role';

/**
 * Approval screen (Build Plan, Phase 4): big amount, what it pays for, photos,
 * then a deliberate slide. Approve, ask for changes, or reject.
 */
export default function ClaimScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const claim = findClaim(id);
  const { role } = useRole();
  const { colors, status } = useJengaTheme();
  const { t } = useI18n();
  const [approved, setApproved] = useState(false);

  if (!claim) {
    return (
      <StateView
        kind="no-permission"
        title={t('claim.notFoundTitle')}
        message={t('claim.notFoundMessage')}
        action={<Button title={t('claim.backToMoney')} variant="secondary" onPress={() => router.back()} />}
      />
    );
  }

  const stage = findStage(claim.stageId);
  const canDecide = role === 'owner' && claim.status === 'submitted' && !approved;
  const badge = approved ? claimBadge.approved : claimBadge[claim.status];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: canDecide ? 180 : spacing.xxl }}>
        <View style={{ gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="label" muted>
              {t('claim.fromContractor', { number: claim.number, from: claim.requestedBy })}
            </Text>
            <StatusBadge status={badge.status} label={t(badge.label)} />
          </View>
          <Money amount={claim.amount} variant="display" />
          <Text variant="sectionTitle">{claim.title}</Text>
          <Text muted>
            {t('claim.stageLine', { stage: claim.stageName })}
            {claim.status === 'submitted' && !approved
              ? ` · ${t('common.waiting', { duration: formatDuration(t, claim.requestedAt) })}`
              : ''}
          </Text>
        </View>

        {approved && (
          <Card style={{ backgroundColor: status('approved').soft, borderColor: status('approved').soft }}>
            <Text variant="bodyStrong" color={status('approved').color}>
              {t('claim.approvedNotPaid')}
            </Text>
            <Text variant="label" color={status('approved').color}>
              {t('claim.approvedNext', { from: claim.requestedBy, amount: formatRwf(claim.amount) })}
            </Text>
          </Card>
        )}

        <View style={{ gap: spacing.sm }}>
          <Text variant="sectionTitle">{t('claim.photos')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {claim.photos.map((p) => (
              <View key={p.id} style={{ gap: 4, width: 200 }}>
                <PhotoTile photo={p} width={200} height={150} />
                <Text variant="caption" muted numberOfLines={1}>
                  {p.caption}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>

        <Card title={t('claim.paysFor')}>
          {claim.lineItems.map((l) => (
            <AmountLine key={l.label} label={l.label} amount={l.amount} />
          ))}
          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.sm }} />
          <AmountLine label={t('common.total')} amount={claim.amount} strong />
        </Card>

        <Card title={t('claim.note')}>
          <Text>{claim.note}</Text>
        </Card>

        {stage && (
          <Card title={t('claim.checks')}>
            <View style={{ gap: 6 }}>
              {stage.acceptanceCriteria.map((c) => (
                <Text key={c} muted>
                  • {c}
                </Text>
              ))}
            </View>
            <View style={{ marginTop: spacing.md }}>
              <Button title={t('claim.openStage')} variant="ghost" onPress={() => router.push(`/stage/${stage.id}`)} />
            </View>
          </Card>
        )}

        <Card title={t('claim.progress')}>
          <ClaimTracker
            requestedAt={claim.requestedAt}
            approvedAt={approved ? new Date().toISOString() : claim.approvedAt}
            paidAt={claim.paidAt}
            disputedStep={claim.status === 'disputed' ? 'approved' : null}
          />
        </Card>
      </ScrollView>

      {canDecide && (
        <BottomAction>
          <View style={{ gap: spacing.md }}>
            <SlideToApprove amount={claim.amount} onApprove={() => setApproved(true)} />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button title={t('claim.askChanges')} variant="secondary" block />
              </View>
              <Button title={t('claim.reject')} variant="ghost" />
            </View>
          </View>
        </BottomAction>
      )}
    </SafeAreaView>
  );
}

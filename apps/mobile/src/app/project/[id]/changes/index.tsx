import type { BudgetChangesOverview } from '@jengalink/contracts';
import { request } from '@jengalink/contracts/client';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf, radius, spacing } from '@jengalink/ui';
import { Button, Card, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { api, useAuth } from '@/lib/auth';

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatRwf(Math.abs(n))}`;

/** The budget per package (original → approved changes → current) and every change (Phase 4). */
export default function ChangesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [ov, setOv] = useState<BudgetChangesOverview | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      withRefresh(() => request(() => api.GET('/v1/projects/{id}/changes', { params: { path: { id } } })))
        .then((o) => live && setOv(o))
        .catch(() => live && setFailed(true));
      return () => {
        live = false;
      };
    }, [id, withRefresh]),
  );

  if (failed) return <StateView kind="no-permission" title={t('common.somethingWrong')} />;
  if (!ov)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <Text variant="caption" muted>
        {t('changes.hint')}
      </Text>
      {ov.agreementVersion === null ? (
        <Text muted>{t('changes.noAgreement')}</Text>
      ) : (
        <Card>
          <Text variant="label" muted style={{ marginBottom: spacing.sm }}>
            {t('changes.historyTitle')} · {t('claims.agreementVersion', { version: ov.agreementVersion })}
          </Text>
          {ov.lines.map((l, i) => (
            <View key={l.index} style={{ paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                <Text variant="bodyStrong" style={{ flex: 1 }}>
                  {l.name}
                </Text>
                <Text variant="bodyStrong">{formatRwf(l.current)}</Text>
              </View>
              <Text variant="caption" muted>
                {t('changes.original')} {formatRwf(l.original)}
                {l.changes !== 0 ? ` · ${t('changes.changesCol')} ${signed(l.changes)}` : ''}
              </Text>
            </View>
          ))}
          <Text variant="caption" muted style={{ marginTop: spacing.sm }}>
            {t('changes.totalsLine', { original: formatRwf(ov.original), additions: formatRwf(ov.additions), reductions: formatRwf(Math.abs(ov.reductions)), current: formatRwf(ov.current) })}
          </Text>
        </Card>
      )}
      {ov.agreementVersion !== null && ov.changes.length === 0 && <Text muted>{t('changes.empty')}</Text>}
      {ov.changes.map((c) => {
        const tone = c.status === 'applied' ? status('paid') : c.status === 'rejected' ? status('problem') : { color: colors.inkMuted, soft: colors.surfaceSunken };
        return (
          <Pressable key={c.id} onPress={() => router.push({ pathname: '/project/[id]/changes/[changeId]', params: { id, changeId: c.id } })} accessibilityRole="button">
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text variant="caption" muted style={{ flex: 1 }}>
                  {c.number}
                  {c.appliedVersion ? ` · ${t('claims.agreementVersion', { version: c.appliedVersion })}` : ''}
                </Text>
                <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: tone.soft }}>
                  <Text variant="caption" color={tone.color}>
                    {t(`changes.status_${c.status}`)}
                  </Text>
                </View>
              </View>
              <Text variant="money" style={{ marginTop: 4 }}>
                {signed(c.netDelta)}
              </Text>
              <Text variant="bodyStrong">{t(`changes.category_${c.category}`)}</Text>
            </Card>
          </Pressable>
        );
      })}
      {ov.canPropose && <Button title={t('changes.newChange')} icon={Plus} onPress={() => router.push({ pathname: '/project/[id]/changes/[changeId]', params: { id, changeId: 'new' } })} />}
    </ScrollView>
  );
}

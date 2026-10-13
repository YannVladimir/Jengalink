import type { ProjectSummary, WeeklyReportSummary } from '@jengalink/contracts';
import { ApiError, request } from '@jengalink/contracts/client';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { radius, spacing } from '@jengalink/ui';
import { Button, Card, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Check, Newspaper } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { api, useAuth } from '@/lib/auth';

const REPORTERS = ['contractor', 'supervisor', 'manager'];
const fromIsoDate = (iso: string) => new Date(`${iso}T12:00:00`);

/** Weekly reports (Phase 5): one tap freezes the week from records. */
export default function ReportsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [list, setList] = useState<WeeklyReportSummary[] | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      Promise.all([
        withRefresh(() => request(() => api.GET('/v1/projects/{id}/reports', { params: { path: { id } } }))),
        withRefresh(() => request(() => api.GET('/v1/projects/{id}', { params: { path: { id } } }))),
      ])
        .then(([l, p]) => {
          if (!live) return;
          setList(l);
          setProject(p);
        })
        .catch(() => live && setFailed(true));
      return () => {
        live = false;
      };
    }, [id, withRefresh]),
  );

  if (failed) return <StateView kind="no-permission" title={t('common.somethingWrong')} />;
  if (!list || !project)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  const reporter = project.myRoles.some((r) => REPORTERS.includes(r));
  const fmt = (iso: string) => formatDate(locale, fromIsoDate(iso));

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await withRefresh(() => request(() => api.POST('/v1/projects/{id}/reports', { params: { path: { id } }, body: {} })));
      router.push({ pathname: '/project/[id]/reports/[reportId]', params: { id, reportId: r.id } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <Text variant="caption" muted>
        {t('report.oneTapHint')}
      </Text>
      {reporter && <Button title={t('report.generate')} icon={Newspaper} loading={busy} onPress={generate} />}
      {error && (
        <Text variant="caption" color={status('problem').color} alert>
          {error}
        </Text>
      )}
      {list.length === 0 && <Text muted>{t('report.empty')}</Text>}
      {list.map((r) => (
        <Pressable key={r.id} onPress={() => router.push({ pathname: '/project/[id]/reports/[reportId]', params: { id, reportId: r.id } })} accessibilityRole="button">
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{t('report.weekLine', { start: fmt(r.weekStart), end: fmt(r.weekEnd) })}</Text>
                <Text variant="caption" muted>
                  {t('report.generatedLine', { name: r.generatedByName ?? t('claims.someone'), date: formatDate(locale, r.generatedAt) })}
                  {r.revisionNo > 1 ? ` · ${t('report.revisionTag', { n: r.revisionNo })}` : ''}
                </Text>
              </View>
              <Text variant="money">{r.acceptedPercent}%</Text>
            </View>
            <View
              style={{
                alignSelf: 'flex-start',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                marginTop: spacing.sm,
                paddingHorizontal: 10,
                paddingVertical: 3,
                borderRadius: radius.pill,
                backgroundColor: r.acknowledgedAt ? status('paid').soft : colors.surfaceSunken,
              }}
            >
              {r.acknowledgedAt && <Check size={14} color={status('paid').color} />}
              <Text variant="caption" color={r.acknowledgedAt ? status('paid').color : colors.inkMuted}>
                {r.acknowledgedAt ? t('report.acknowledged', { name: r.acknowledgedByName ?? t('claims.someone'), date: formatDate(locale, r.acknowledgedAt) }) : t('report.notReviewed')}
              </Text>
            </View>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}

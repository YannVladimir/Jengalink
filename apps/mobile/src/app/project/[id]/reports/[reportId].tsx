import type { WeeklyReportView } from '@jengalink/contracts';
import { ApiError, request } from '@jengalink/contracts/client';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { radius, spacing } from '@jengalink/ui';
import { Button, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Check, FileText, Share2 } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, View } from 'react-native';
import { ReportBody } from '@/components/report';
import { api, useAuth } from '@/lib/auth';

const fromIsoDate = (iso: string) => new Date(`${iso}T12:00:00`);

/** One weekly report: ring, tower, money, the week, photos, decisions, what comes next. */
export default function ReportScreen() {
  const { id, reportId } = useLocalSearchParams<{ id: string; reportId: string }>();
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [r, setR] = useState<WeeklyReportView | null>(null);
  const [busy, setBusy] = useState<'pdf' | 'ack' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      withRefresh(() => request(() => api.GET('/v1/projects/{id}/reports/{reportId}', { params: { path: { id, reportId } } })))
        .then((v) => live && setR(v))
        .catch(() => live && setFailed(true));
      return () => {
        live = false;
      };
    }, [id, reportId, withRefresh]),
  );

  if (failed) return <StateView kind="no-permission" title={t('common.somethingWrong')} />;
  if (!r)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  const d = r.data;
  const fmt = (iso: string) => formatDate(locale, fromIsoDate(iso));

  const run = async (kind: 'pdf' | 'ack') => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'pdf') {
        const link = await withRefresh(() => request(() => api.POST('/v1/projects/{id}/reports/{reportId}/pdf', { params: { path: { id, reportId } } })));
        await Linking.openURL(link.url);
      } else {
        setR(await withRefresh(() => request(() => api.POST('/v1/projects/{id}/reports/{reportId}/acknowledge', { params: { path: { id, reportId } } }))));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <View>
        <Text variant="caption" muted>
          {d.projectName}
        </Text>
        <Text variant="sectionTitle">{t('report.weekLine', { start: fmt(r.weekStart), end: fmt(r.weekEnd) })}</Text>
        <Text variant="caption" muted>
          {t('report.generatedLine', { name: r.generatedByName ?? t('claims.someone'), date: formatDate(locale, r.generatedAt) })}
          {r.revisionNo > 1 ? ` · ${t('report.revisionTag', { n: r.revisionNo })}` : ''}
        </Text>
      </View>
      {r.acknowledgedAt && (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', padding: spacing.md, borderRadius: radius.md, backgroundColor: status('paid').soft }}>
          <Check size={16} color={status('paid').color} />
          <Text variant="caption" color={status('paid').color} style={{ flex: 1 }}>
            {t('report.acknowledged', { name: r.acknowledgedByName ?? t('claims.someone'), date: formatDate(locale, r.acknowledgedAt) })}
          </Text>
        </View>
      )}

      <ReportBody data={d} photos={r.photos} />

      {error && (
        <Text variant="caption" color={status('problem').color} alert>
          {error}
        </Text>
      )}
      <Button title={t('report.openPdf')} icon={FileText} variant="secondary" loading={busy === 'pdf'} onPress={() => run('pdf')} />
      {r.canShare && <Button title={t('share.button')} icon={Share2} variant="secondary" onPress={() => router.push({ pathname: '/project/[id]/reports/share', params: { id, reportId } })} />}
      {r.canAcknowledge && <Button title={t('report.acknowledge')} icon={Check} loading={busy === 'ack'} onPress={() => run('ack')} />}
    </ScrollView>
  );
}

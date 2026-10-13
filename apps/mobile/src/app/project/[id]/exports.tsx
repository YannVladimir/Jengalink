import type { ExportFormat, ExportKind, ExportList } from '@jengalink/contracts';
import { ApiError, request } from '@jengalink/contracts/client';
import { formatDateTime } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { spacing } from '@jengalink/ui';
import { Button, Card, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Download, FileSpreadsheet, FileText } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, View } from 'react-native';
import { api, useAuth } from '@/lib/auth';

const KINDS: ExportKind[] = ['project_summary', 'money_history'];

/** Exports (spec §12): ask, the file is made in the background, then open it (only you can). */
export default function ExportsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [list, setList] = useState<ExportList | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => withRefresh(() => request(() => api.GET('/v1/projects/{id}/exports', { params: { path: { id } } }))).then(setList), [id, withRefresh]);
  useFocusEffect(
    useCallback(() => {
      void load().catch(() => setFailed(true));
    }, [load]),
  );
  // While something is being made, look again every 2 seconds.
  const making = list?.items.some((x) => x.status === 'queued');
  useEffect(() => {
    if (!making) return;
    const timer = setInterval(() => void load().catch(() => undefined), 2000);
    return () => clearInterval(timer);
  }, [making, load]);

  if (failed) return <StateView kind="no-permission" title={t('common.somethingWrong')} />;
  if (!list)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(null);
    }
  };
  const ask = (kind: ExportKind, format: ExportFormat) =>
    run(`${kind}-${format}`, async () => {
      await withRefresh(() => request(() => api.POST('/v1/projects/{id}/exports', { params: { path: { id } }, body: { kind, format } })));
      await load();
    });

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <Text variant="caption" muted>
        {t('exports.hint')}
      </Text>
      {KINDS.filter((k) => k === 'project_summary' || list.canExportMoney).map((k) => (
        <Card key={k} title={t(`exports.kind_${k}`)}>
          <Text variant="caption" muted>
            {t(`exports.kindHint_${k}`)}
          </Text>
          {k === 'project_summary' && !list.canExportMoney && (
            <Text variant="caption" muted style={{ marginTop: 4 }}>
              {t('exports.noMoney')}
            </Text>
          )}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <Button title="PDF" icon={FileText} variant="secondary" loading={busy === `${k}-pdf`} onPress={() => void ask(k, 'pdf')} />
            <Button title="CSV" icon={FileSpreadsheet} variant="secondary" loading={busy === `${k}-csv`} onPress={() => void ask(k, 'csv')} />
          </View>
        </Card>
      ))}
      {error && (
        <Text variant="caption" color={status('problem').color}>
          {error}
        </Text>
      )}
      {list.items.length === 0 && <Text muted>{t('exports.empty')}</Text>}
      {list.items.map((x) => {
        const tone = x.status === 'ready' ? status('paid').color : x.status === 'failed' ? status('problem').color : colors.inkMuted;
        return (
          <Card key={x.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {t(`exports.kind_${x.kind}`)} · {x.format.toUpperCase()}
              </Text>
              <Text variant="caption" color={tone}>
                {t(`exports.status_${x.status}`)}
              </Text>
            </View>
            <Text variant="caption" muted>
              {t('exports.madeOn', { date: formatDateTime(locale, x.createdAt) })}
            </Text>
            {x.status === 'ready' && (
              <View style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
                <Button
                  title={t('exports.download')}
                  icon={Download}
                  loading={busy === x.id}
                  onPress={() =>
                    void run(x.id, async () => {
                      const link = await withRefresh(() => request(() => api.POST('/v1/projects/{id}/exports/{exportId}/download', { params: { path: { id, exportId: x.id } } })));
                      await Linking.openURL(link.url);
                    })
                  }
                />
              </View>
            )}
          </Card>
        );
      })}
    </ScrollView>
  );
}

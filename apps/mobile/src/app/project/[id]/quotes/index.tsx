import type { AgreementView, ProjectSummary, QuoteSummary } from '@jengalink/contracts';
import { request } from '@jengalink/contracts/client';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf, spacing } from '@jengalink/ui';
import { Button, Card, StateView, Text, useJengaTheme } from '@jengalink/ui/native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { FilePlus2 } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { fromIsoDate } from '@/components/DatePickerSheet';
import { QuoteStatusChip as StatusChip } from '@/components/quote';
import { api, useAuth } from '@/lib/auth';

const EDITORS = ['contractor', 'manager'];

/** The project's quotes (Phase 4). Owners see only quotes that were sent to them. */
export default function QuotesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { colors } = useJengaTheme();
  const { withRefresh } = useAuth();
  const [list, setList] = useState<QuoteSummary[] | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [agreements, setAgreements] = useState<AgreementView[]>([]);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      Promise.all([
        withRefresh(() => request(() => api.GET('/v1/projects/{id}/quotes', { params: { path: { id } } }))),
        withRefresh(() => request(() => api.GET('/v1/projects/{id}', { params: { path: { id } } }))),
        withRefresh(() => request(() => api.GET('/v1/projects/{id}/agreements', { params: { path: { id } } }))),
      ])
        .then(([q, p, a]) => {
          if (!live) return;
          setList(q);
          setProject(p);
          setAgreements(a);
        })
        .catch(() => live && setFailed(true));
      return () => {
        live = false;
      };
    }, [id, withRefresh]),
  );

  if (failed) return <StateView kind="offline" title={t('common.somethingWrong')} />;
  if (!list || !project)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  const editor = project.myRoles.some((r) => EDITORS.includes(r));

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <Text variant="caption" muted>
        {project.name}
      </Text>
      {agreements.length > 0 && (
        <Card>
          <Text variant="label" muted>
            {t('agreement.current')} · {t('agreement.version', { n: agreements[0].version })}
          </Text>
          <Text variant="moneyLarge">{formatRwf(agreements[0].contractValue)}</Text>
          {agreements.map((a) => (
            <Text key={a.id} variant="caption" muted style={{ marginTop: 2 }}>
              {t('agreement.version', { n: a.version })}: {formatRwf(a.contractValue)} ·{' '}
              {a.changeNumber
                ? t('agreement.historyChange', { change: a.changeNumber, name: a.acceptedByName ?? t('invite.someone'), date: formatDate(locale, a.acceptedAt) })
                : t('agreement.historyRow', { quote: a.quoteNumber, revision: a.quoteRevision, name: a.acceptedByName ?? t('invite.someone'), date: formatDate(locale, a.acceptedAt) })}
            </Text>
          ))}
        </Card>
      )}
      {list.length === 0 && <Text muted>{editor ? t('quote.empty') : t('quote.emptyOwner')}</Text>}
      {list.map((q) => (
        <Pressable key={q.id} onPress={() => router.push({ pathname: '/project/[id]/quotes/[quoteId]', params: { id, quoteId: q.id } })} accessibilityRole="button">
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text variant="caption" muted style={{ flex: 1 }}>
                {q.number} · {t('quote.revision', { n: q.currentRevision })}
              </Text>
              <StatusChip status={q.status} />
            </View>
            <Text variant="bodyStrong" style={{ marginTop: 4 }}>
              {q.title}
            </Text>
            <Text variant="money" style={{ marginTop: 2 }}>
              {formatRwf(q.total)}
            </Text>
            <Text variant="caption" muted>
              {t('quote.validLine', { date: formatDate(locale, fromIsoDate(q.validUntil)) })}
            </Text>
          </Card>
        </Pressable>
      ))}
      {editor && <Button title={t('quote.newQuote')} icon={FilePlus2} onPress={() => router.push({ pathname: '/project/[id]/quotes/[quoteId]', params: { id, quoteId: 'new' } })} />}
    </ScrollView>
  );
}

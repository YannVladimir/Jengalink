import type { ReportPhoto, ShareSection, WeeklyReportData } from '@jengalink/contracts';
import { formatDate } from '@jengalink/i18n';
import { useI18n } from '@jengalink/i18n/react';
import { formatRwf, radius, spacing } from '@jengalink/ui';
import { Card, JengaTower, MoneyBar, ProgressRing, Text, useJengaTheme } from '@jengalink/ui/native';
import { TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { Image, Linking, Pressable, View } from 'react-native';

const fromIsoDate = (iso: string) => new Date(`${iso}T12:00:00`);

/**
 * A weekly report's content: ring, tower, money, the week, photos, decisions, what comes next.
 * `sections` set = a shared copy: only those optional parts are drawn (progress and the tower always are).
 */
export function ReportBody({ data: d, photos, sections }: { data: WeeklyReportData; photos: ReportPhoto[]; sections?: readonly ShareSection[] }) {
  const { t, locale } = useI18n();
  const { colors, status } = useJengaTheme();
  const [now] = useState(() => Date.now());
  const show = (s: ShareSection) => !sections || sections.includes(s);
  const fmt = (iso: string) => formatDate(locale, fromIsoDate(iso));
  const days = (since: string) => Math.floor((now - new Date(since).getTime()) / 86_400_000);
  const heading = (s: string) => (
    <Text variant="label" muted style={{ marginBottom: spacing.sm }}>
      {s}
    </Text>
  );

  return (
    <>
      <Card>
        {heading(t('report.progressTitle'))}
        <View style={{ alignItems: 'center' }}>
          <ProgressRing accepted={d.progress.accepted} reported={d.progress.reported} size={150} />
        </View>
        <Text variant="caption" muted style={{ textAlign: 'center', marginTop: spacing.sm }}>
          {d.progress.acceptedChange === null ? t('report.firstReport') : d.progress.acceptedChange > 0 ? t('report.acceptedChange', { points: d.progress.acceptedChange }) : t('report.acceptedSame')}
        </Text>
      </Card>

      <Card>
        {heading(t('report.towerTitle'))}
        <JengaTower stages={d.stages.map((s, i) => ({ id: String(i), name: s.name, status: s.status }))} compact />
      </Card>

      {d.money && (
        <Card>
          {heading(t('report.moneyTitle'))}
          <MoneyBar contract={d.money.contract} paid={d.money.paid} approvedUnpaid={d.money.approvedUnpaid} />
          <Text variant="caption" muted style={{ marginTop: spacing.sm }}>
            {t('money.waitingForDecision')}: {formatRwf(d.money.awaitingDecision)}
            {d.money.pendingVerification > 0 ? ` · ${t('money.pendingVerification')}: ${formatRwf(d.money.pendingVerification)}` : ''}
          </Text>
        </Card>
      )}

      {show('work') && (
        <Card>
          {heading(t('report.thisWeek'))}
          {d.work.updates === 0 ? (
            <Text muted>{t('report.noWork')}</Text>
          ) : (
            <>
              <Text variant="bodyStrong">{t('report.updatesLine', { updates: d.work.updates, photos: d.work.photos })}</Text>
              {d.work.authors.length > 0 && (
                <Text variant="caption" muted>
                  {t('report.byLine', { names: d.work.authors.join(', ') })}
                </Text>
              )}
              {d.work.stagesWorked.length > 0 && (
                <Text variant="caption" muted>
                  {t('report.stagesWorked', { stages: d.work.stagesWorked.join(', ') })}
                </Text>
              )}
            </>
          )}
          {d.work.blockers.map((b) => (
            <View key={b.stage} style={{ flexDirection: 'row', gap: 6, marginTop: spacing.sm }}>
              <TriangleAlert size={16} color={status('problem').color} />
              <Text variant="caption" color={status('problem').color} style={{ flex: 1 }}>
                {b.stage}: {b.text}
              </Text>
            </View>
          ))}
        </Card>
      )}

      {show('photos') && (
        <Card>
          {heading(t('report.photosTitle'))}
          {photos.length === 0 ? (
            <Text muted>{t('report.noPhotos')}</Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {photos.map((p) => (
                <Pressable key={p.id} disabled={!p.url} onPress={() => p.url && Linking.openURL(p.url)} style={{ width: '48%' }} accessibilityRole="button" accessibilityLabel={t('feed.openOriginal')}>
                  {p.thumbUrl && <Image source={{ uri: p.thumbUrl }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.sm }} />}
                </Pressable>
              ))}
            </View>
          )}
        </Card>
      )}

      {show('decisions') && (
        <Card>
          {heading(t('report.decisionsTitle'))}
          {d.decisions.length === 0 ? (
            <Text muted>{t('report.noDecisions')}</Text>
          ) : (
            d.decisions.map((x, i) => (
              <View key={i} style={{ paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                <Text variant="bodyStrong">{t(`report.decision_${x.kind}`)}</Text>
                <Text>{x.title}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                  <Text variant="caption" muted>
                    {days(x.since) < 1 ? t('report.waitingToday') : t('report.waitingDays', { days: days(x.since) })}
                  </Text>
                  {x.amount !== null && <Text variant="bodyStrong">{formatRwf(x.amount)}</Text>}
                </View>
              </View>
            ))
          )}
        </Card>
      )}

      {d.next.length > 0 && (
        <Card>
          {heading(t('report.nextTitle'))}
          {d.next.map((n) => (
            <Text key={n.stage}>{n.plannedStart ? t('report.nextLine', { stage: n.stage, date: fmt(n.plannedStart) }) : n.stage}</Text>
          ))}
        </Card>
      )}
    </>
  );
}
